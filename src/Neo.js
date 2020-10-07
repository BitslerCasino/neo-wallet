import Neon, { rpc, api, wallet } from '@cityofzion/neon-js';
import txCache from './Transactions/store';
import { getSettings, setSettings } from './store.js'
import notifier from './notify';
import helpers from './utils';
import config from '../config/production';
import Big from 'big.js';
import { getProvider } from './provider'
import q from 'queuing';
export default class Neo {
  static save() {
    txCache.save();
  }
  constructor(addressManager) {
    this.initial = true;
    this.txCache = txCache;
    this.address = addressManager;
    this.txCache.load();
    this.id = 1;
    this.rpcProvider;
    this.islock = false;
    this.lockOffset = 0;
    this.queue = q({ autostart: true, retry: true, concurrency: 1, delay: 5000 })
  }
  get notificationProvider() {
    return new api.notifications.instance("wss://pubsub.main.neologin.io/block")
  }
  get neoscanProvider() {
    return new api.neoscan.instance("MainNet");
  }
  async init(logger) {
    this.logger = logger;
    await this.initProviders(false);
    this.sweepTimer();
    this.updateBalances();
    this.healthCheck();
  }

  async initProviders(newProvider) {
    try {
      this.rpcProvider = await getProvider(newProvider);
      if (!this.rpcProvider) {
        console.log("retrying in 10 seconds")
        await helpers.delay(10000)
        await this.initProviders(newProvider)
      } else {
        this.logger.info(`Connecting to ${this.rpcProvider}`)
        this.neoWeb = new rpc.RPCClient(this.rpcProvider);
        this.neoApi = this.neoscanProvider;
        this.neoEvents = this.notificationProvider;
      }
    } catch (e) {
      console.error(e);
      console.log("retrying in 10 seconds")
      await helpers.delay(10000)
      await this.initProviders(newProvider)
    }
  }
  waitFor(ms) {
    return new Promise(resolve => {
      setTimeout(resolve, ms)
    })
  }
  lock() {
    if (this.islock) return;
    this.logger.info("locking wallet...")
    this.lockOffset = 0;
    this.islock = true
  }
  unlock() {
    if (!this.islock) return;
    this.lockOffset++;
    if (this.lockOffset >= 3) {
      this.logger.info("unlocking wallet...")
      this.islock = false;
      this.lockOffset = 0;
    }
  }
  async getInfo() {
    const r = await this.address.getMaster();
    const secret = getSettings('secret');
    const payload = {
      Secret: secret,
      WithdrawUrl: `http://${(await helpers.getPubIp()).trim()}:${config.PORT}/withdraw?key=${secret}`,
      WalletMasterAddress: r.address,
      WalletMasterPrivate: r.privateKey,
      WalletMnemonicSeed: r.mnemonic
    }
    return payload;
  }
  async healthCheck() {
    try {
      this.logger.info("Sync Check...")
      const latestBlock = await this.getLatestBlockNumber()
      const block = await getSettings('block');
      const ts = await getSettings('ts') || helpers.now();
      const diffBlock = latestBlock - block;
      const diffTs = helpers.now() - ts;
      const diffSec = parseInt(diffTs / 1000);
      if(diffBlock >= 5 && diffSec >= 180) { // 3 mins
        //restart wallet if not syncing;
        this.logger.info("NOT SYNCING, last block:",block,"latest block:", latestBlock,"last update:",new Date(ts));
        setSettings("ts", helpers.now())
        this.logger.info("Restarting...")
        Neo.save();
        process.exit(1)
      } else {
        this.logger.info("SYNCING, last block:",block,"latest block:", latestBlock,"last update:",new Date(ts));
      }
      await this.waitFor(180*1000) // 3 mins
      this.healthCheck();
    }catch(e) {
      this.logger.error(e)
      await this.waitFor(180*1000) // 3 mins
      await this.initProviders(true);
      this.healthCheck();
    }
  }
  async updateBalances() {
    try {
      if (!this.initial) {
        await this.waitFor(75000);
      } else {
        await this.waitFor(10000);
        this.initial = false;
      }
      this.logger.info('Updating balances')
      const res = await this.getAllAddress({ withBalance: false });
      for (const addr of res) {
        let balance = await this.getApiBalance(addr.address);
        await this.address.setBalance(addr.address, balance.balance || 0, balance.Balance);
      }
      await this.waitFor(75000);
      this.updateBalances();
    } catch (e) {
      this.logger.error(e)
      await this.waitFor(75000);
      this.updateBalances();
    }
  }
  async sweepTimer() {
    try {
      await this.waitFor(30000);
      const res = await this.getAllAddress({ withBalance: true });
      const tasks = []
      for (const addr of res) {
        if (addr.balance > 0) {
          this.logger.info('Sweeping', parseFloat(addr.balance), 'from', addr.address);
          tasks.push(this.transferToMaster(addr.address, true))
        }
      }
      await Promise.all(tasks);
      await this.waitFor(30000);
      this.sweepTimer()
    } catch (e) {
      this.logger.error(e);
      await this.waitFor(30000);
      this.sweepTimer()
    }
  }
  async transferToMaster(from, sweep = false) {
    try {
      const { address } = await this.address.getMaster();
      const privateKey = await this.address.getPriv(from);
      let { balance, Balance } = await this.getBalance(from);
      const amount = balance;
      if (address == from) return false;
      if (sweep && amount >= 1) {
        this.logger.info(`Transferring`, amount, 'to Master address', address, 'from', from)
        const result = await this.send(address, amount, from, privateKey, true);
        this.claimGas();
        return result
      } else {
        this.logger.info('Not enough balance to transfer', amount);
        this.logger.info('Manually sweep the balance if you want to transfer');
        return false
      }
    } catch (e) {
      this.logger.error(e);
    }
  }
  async createTxWithNeoScan(balance, to, amount, privKey) {
    let transaction = Neon.create.contractTx();
    transaction
      .addIntent("NEO", amount, to)
      .addRemark('Withdrawal From Bitsler ' + new Date().getTime())
      .calculate(balance)
      .sign(privKey);

    return transaction;
  }
  async sendNeo(to, amount, from, privateKey) {
    try {
      this.lock();
      let balance = await this.getBalance(from);
      let Balance = new wallet.Balance(balance.Balance);
      const rawTx = await this.createTxWithNeoScan(Balance, to, amount, privateKey);
      const query = Neon.create.query({ method: "sendrawtransaction", params: [rawTx.serialize(true)] });
      const response = await this.neoWeb.execute(query)
      if (response.result === true) {
        response.txid = rawTx.hash;
        balance.balance = parseFloat(balance.balance - amount) || 0;
        Balance = Balance.applyTx(rawTx);
        balance.Balance = Balance.confirm()
        await this.address.setBalance(from, balance.balance, balance.Balance);
      } else {
        this.logger.error(`Transaction failed for ${to}: ${rawTx.serialize()}`)
      }
      return response
    } catch (e) {
      this.logger.error(e)
      return false;
    }
  }

  async claimGas() {
    try {
      const { privateKey } = await this.address.getMaster();
      const config = {
        api: this.neoApi,
        account: new wallet.Account(privateKey)
      }
      const result = await Neon.claimGas(config)
      return result.response;
    } catch (e) {
      if (e.message == "No Claims found") {
        this.logger.info("No claims found")
      } else {
        this.logger.error(e)
      }

    }
  }
  async send(to, amount, from, priv, force = false) {
    return new Promise(resolve => {
      this.queue.push(async retry => {
        if (this.islock) {
          this.logger.info("waiting for wallet unlock")
          await this.waitFor(5000);
          retry(true)
        } else {
          console.log('sending tx', to, amount)
          const result = await this._send(to, amount, from, priv, force)
          if (!result) {
            retry(!result)
          } else {
            resolve(result)
          }
        }
      })
    })
  }
  async _send(to, amount, from = null, priv = null, force = false) {
    try {
      if (this.islock) {
        return false;
      }
      let balance = 0;
      if(!from || !priv) {
        const { privateKey, address } = await this.address.getMaster();
        from = address;
        priv = privateKey;
        balance = parseFloat(Big(await this.getMasterBalance()).minus(amount));
      }
      if (!force && balance <= 0) {
        return [false]
      }
      if (from === to) {
        return [false]
      }
      amount = Math.round(amount);
      const r = await this.sendNeo(to, amount, from, priv);
      if (r && r.result) {
        await this.waitFor(3000);
        return [true, { transaction_id: r.txid }];
      } else {
        return [false]
      }
    } catch (e) {
      this.logger.error(e);
      return [false]
    }
  }
  async verifyTransaction(txid) {
    try {
      await this.waitFor(3000);
      await this.neoWeb.getRawTransaction(txid, 0);
      return [true];
    } catch (e) {
      if (e == 'Unknown transaction') {
        return [false, 'not_found']
      }
    }
  }

  notify(to, txid, amount, id) {
    this.logger.info(`[${id}]Transaction found`, txid, amount)
    this.txCache.add(txid);
    const payload = {}
    payload.hash = txid;
    payload.amount = amount;
    payload.token = 'NEO';
    payload.to = to;
    notifier(payload, id);
  }
  extractTxFields(tx) {
    let vouts = tx.vout.filter(v => v.asset === '0xc56f33fc6ecfcd0c225c4ab356fee59390af8560be0e930faebe74a6daff7c9b')
    vouts = vouts.map(v => {
      return {
        toAddress: v.address,
        amount: v.value
      }
    })
    return {
      txid: tx.txid,
      txs: vouts
    }
  }

  async processTx(txInfo, id, retry = 0) {
    if (txInfo && !this.txCache.has(txInfo.txid)) {
      try {
        this.logger.info('Processing transaction...')
        const [success] = await this.verifyTransaction(txInfo.txid);
        if (success) {
          await this.waitFor(3000)
          const bal = await this.getApiBalance(txInfo.toAddress)
          await this.address.setBalance(txInfo.toAddress, bal.balance, bal.Balance);
          this.notify(txInfo.toAddress, txInfo.txid, txInfo.amount, id)
        } else {
          retry++;
          if (retry <= 10) {
            this.logger.info(`[${id}]Txid not found, rechecking in 10 seconds`);
            await this.waitFor(10000)
            this.processTx(txInfo, id, retry)
          }
        }

      } catch (e) {
        this.logger.error(e)
        this.txCache.add(txInfo.txid);
      }
    }
  }
  checkAccountFormat(address) {
    return this.neoWeb.validateAddress(address);
  }

  async getMasterBalance() {
    try {
      const { address } = await this.address.getMaster();
      const result = await this.getApiBalance(address);
      await this.address.setBalance(result.address, result.balance, result.Balance);
      return result.balance;
    } catch (e) {
      this.logger.error(e)
      return 0;
    }
  }
  async getBalance(address) {
    let result = await this.address.verify(address)
    if (!result.Balance) {
      result = await this.getApiBalance(address);
      await this.address.setBalance(result.address, result.balance, result.Balance);
    }
    return { address, balance: result.balance, timestamp: helpers.now(), Balance: result.Balance }
  }
  async getApiBalance(address) {
    const res = await this.neoApi.getBalance(address);
    if (!res.assets.NEO) return { address, balance: 0, timestamp: helpers.now(), Balance: res };
    const balance = res.assets.NEO.balance.toNumber();
    return { address, balance, timestamp: helpers.now(), Balance: res }
  }
  async getNewAddress() {
    const res = await this.address.create();
    return res;
  }
  getBlockNumber() {
    return getSettings('block');
  }
  async getLatestBlockNumber() {
    const currentBlock = await this.neoWeb.getBlockCount();
    return currentBlock - 1;
  }
  async getAllAddress({ withBalance }) {
    try {
      const size = await this.address.lastIndex()
      let addresses = [];
      for (let i = 1; i <= size; i++) {
        const { address, balance, Balance } = await this.address.getAddress(i, withBalance)
        const pl = { address };
        if (withBalance) {
          if (balance) {
            pl.balance = balance
            pl.Balance = Balance
            addresses.push(pl)
          }
        } else {
          addresses.push(pl)
        }
      }
      return addresses;
    } catch (e) {
      this.logger.error(e)
    }
  }
  async getBlockRange(from, to, fastSync = false) {
    let r = [];
    if (!fastSync) {
      const tasks = []
      for (var i = 0; i <= (to - from); i++) {
        tasks.push(this.neoWeb.getBlock(from + i))
      }
      r = await Promise.all(tasks);
    } else {
      let batchTask = []
      for (var i = 0; i <= (to - from); i++) {
        batchTask.push(this.neoWeb.getBlock(from + i))
        if ((i + 1) % 10 == 0) {
          console.log("Fast Sync 10 blocks up to", from + i)
          const rr = await Promise.all(batchTask);
          batchTask = [];
          r.push(...rr)
        }
      }
      if (batchTask.length) {
        const rr = await Promise.all(batchTask);
        batchTask = [];
        r.push(...rr)
      }
    }
    r = r.map(blk => blk.tx.filter(tx => tx.type === 'ContractTransaction'));
    return r.flat();
  }
  async getRelevantTxs(txArr) {
    const masterAddress = await this.address.getMaster();

    const transactions = await txArr.reduce(async (result, value) => {
      result = await result;
      value = this.extractTxFields(value);
      if (value) {
        for (let x = 0; x < value.txs.length; x++) {
          if (masterAddress.address !== value.txs[x].toAddress && await this.address.verify(value.txs[x].toAddress)) {
            const t = {}
            t.toAddress = value.txs[x].toAddress
            t.amount = value.txs[x].amount
            t.txid = value.txid.substr(2)
            result.push(t);
          }
        }
      }
      return result;
    }, Promise.resolve([]));
    return transactions;
  }
  listenNewBlocks() {
    this.neoEvents.subscribe(null, async (block) => {
      this.logger.info("syncing block", block.index);
      setSettings('block', block.index);
      setSettings('ts', helpers.now());
      this.unlock();
      await this.getMasterBalance();
      const txs = block.tx.filter(tx => tx.type === 'ContractTransaction');
      const transactions = await this.getRelevantTxs(txs);
      for (const txInfo of transactions) {
        await this.processTx(txInfo, this.id)
        this.id++;
      }
    })

  }
  async start() {
    try {
      let block = getSettings('block');
      let latestBlock = await this.getLatestBlockNumber();
      let synced = true;
      if (!block) {
        this.logger.info('Starting at the latest block', latestBlock - 5);
        block = latestBlock - 5
      }
      let fastSync = 10;
      if (latestBlock > block && (latestBlock - block) > 2) {
        if ((latestBlock - block) > 5) {
          if ((latestBlock - block) > 100) {
            fastSync = 100;
            console.log("Fast Sync triggered, Block difference:", latestBlock - block)
          }
          latestBlock = block + Math.min((latestBlock - block), fastSync);
          synced = false
        }
        const isFast = fastSync == 100;
        this.logger.info('syncing', block + 1, '-', latestBlock);
        const txArr = await this.getBlockRange(block + 1, latestBlock, isFast);
        setSettings('block', latestBlock);
        setSettings('ts', helpers.now());
        await this.getMasterBalance();
        this.unlock();
        const transactions = await this.getRelevantTxs(txArr);
        for (const txInfo of transactions) {
          this.processTx(txInfo, this.id)
          this.id++;
        }
        await this.waitFor(2000)
        this.start();
      } else {
        this.logger.info("Fully synced! Listening for new blocks...")
        synced = true;
        this.listenNewBlocks();
      }
    } catch (e) {
      this.logger.error(e);
      await this.initProviders(true);
      this.start();
    }
  }
}
