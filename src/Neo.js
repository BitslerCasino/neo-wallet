import Neon, { rpc, api, wallet } from '@cityofzion/neon-js';
import reduce from 'lodash/reduce';
import txCache from './Transactions/store';
import { getSettings, setSettings } from './store.js'
import notifier from './notify';
import logger from './logger';
import helpers from './utils';
import config from '../config/production';
import Big from 'big.js';
import { getProvider } from './provider'

export default class Neo {
  static save() {
    txCache.save();
  }
  constructor(addressManager) {
    this.state = 'ready'
    this.frozenState = 'ready'
    this.resourcesState = 'ready'
    this.initial = true;
    this.txCache = txCache;
    this.address = addressManager;
    this.txCache.load();
    this.id = 1;
    this.rpcProvider;

  }
  get neoscanProvider() {
    return new api.neoscan.instance("MainNet");
  }
  async init() {
    await this.initProviders(false);
    this.sweepTimer();
    this.updateBalances();
  }

  async initProviders(newProvider) {
    try {
      this.rpcProvider = await getProvider(newProvider);
      if (!this.rpcProvider) {
        console.log("retrying in 10 seconds")
        await helpers.delay(10000)
        await this.initProviders(newProvider)
      } else {
        logger.info(`Connecting to ${this.rpcProvider}`)
        this.neoWeb = new rpc.RPCClient(this.rpcProvider);
        this.neoApi = this.neoscanProvider;
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
  async updateBalances() {
    try {
      if (!this.initial) {
        await this.waitFor(75000);
      } else {
        await this.waitFor(10000);
        this.initial = false;
      }
      logger.info('Updating balances')
      this.state = 'updating';
      const res = await this.getAllAddress({ withBalance: false });
      for (const addr of res) {
        let { balance } = await this.getBalance(addr.address);
        await this.address.setBalance(addr.address, balance || 0);
      }
      this.state = 'ready';
      await this.waitFor(75000);
      this.updateBalances();
    } catch (e) {
      logger.error(e)
      this.state = 'ready';
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
          logger.info('Sweeping', parseFloat(addr.balance), 'from', addr.address);
          tasks.push(this.transferToMaster(addr.address, true))
        }
      }
      await Promise.all(tasks);
      await this.waitFor(30000);
      this.sweepTimer()
    } catch (e) {
      logger.error(e);
      await this.waitFor(30000);
      this.sweepTimer()
    }
  }
  async transferToMaster(from, sweep = false) {
    try {
      const { address } = await this.address.getMaster();
      const privateKey = await this.address.getPriv(from);
      let { balance } = await this.getBalance(from);
      const amount = balance;
      if (address == from) return false;
      if (sweep && amount > 0.0001) {
        logger.info(`Transferring`, amount, 'to Master address', address, 'from', from)
        const result = await this.sendNeo(address, amount, from, privateKey);
        await this.address.setBalance(from, parseFloat(Big(balance).minus(amount)))
        this.claimGas();
        return result
      } else {
        logger.info('Not enough balance to transfer', amount);
        logger.info('Manually sweep the balance if you want to transfer');
        return false
      }
    } catch (e) {
      logger.error(e);
    }
  }

  async sendNeo(to, amount, from, privateKey) {
    try {
      const intents = api.makeIntent({ NEO: amount }, to);
      const account = new wallet.Account(privateKey);
      const result = await Neon.sendAsset({ api: this.neoApi, account, intents });
      this.claimGas();
      return result.response;
    } catch (e) {
      logger.error(e)
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
        logger.info("No claims found")
      } else {
        logger.error(e)
      }

    }
  }

  async send(to, amount, force = false) {
    try {
      const { privateKey, address } = await this.address.getMaster();
      const balance = parseFloat(Big(await this.getMasterBalance()).minus(amount));
      if (!force && balance <= 0) {
        return [false]
      }
      if (address === to) {
        return [false]
      }
      amount = Math.round(amount);
      const r = await this.sendNeo(to, amount, address, privateKey);
      if (r && r.result) {
        await this.waitFor(3000);
        return [true, { transaction_id: r.txid }];
      } else {
        return [false]
      }
    } catch (e) {
      logger.error(e);
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
    logger.info(`[${id}]Transaction found`, txid, amount)
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
    if (this.state !== 'ready') {
      await this.waitFor(5000);
      return this.processTx(txInfo, id, retry)
    }
    if (txInfo && !this.txCache.has(txInfo.txid)) {
      try {
        logger.info('Processing transaction...')
        const [success] = await this.verifyTransaction(txInfo.txid);
        if (success) {
          await this.waitFor(5000)
          const bal = await this.getBalance(txInfo.toAddress)
          await this.address.setBalance(txInfo.toAddress, bal.balance);
          this.notify(txInfo.toAddress, txInfo.txid, txInfo.amount, id)
        } else {
          retry++;
          if (retry <= 10) {
            logger.info(`[${id}]Txid not found, rechecking in 10 seconds`);
            await this.waitFor(10000)
            this.processTx(txInfo, id, retry)
          }
        }

      } catch (e) {
        logger.error(e)
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
      const result = await this.getBalance(address);
      return result.balance;
    } catch (e) {
      logger.error(e)
      return 0;
    }
  }
  async getBalance(address) {
    const res = await this.neoApi.getBalance(address);
    if (!res.assets.NEO) return { balance: 0 };
    const balance = res.assets.NEO.balance.toNumber();
    return { address, balance, timestamp: Date.now() }
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
        const { address, balance } = await this.address.getAddress(i, withBalance)
        const pl = { address };
        if (withBalance) {
          if (balance) {
            pl.balance = balance
            addresses.push(pl)
          }
        } else {
          addresses.push(pl)
        }
      }
      return addresses;
    } catch (e) {
      logger.error(e)
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
    }else {
      let batchTask = []
      for (var i = 0; i <= (to - from); i++) {
        batchTask.push(this.neoWeb.getBlock(from + i))
        if((i+1) % 10 == 0) {
          console.log("Fast Sync 10 blocks up to", from + i)
          const rr = await Promise.all(batchTask);
          batchTask = [];
          r.push(...rr)
        }
      }
      if(batchTask.length) {
        const rr = await Promise.all(batchTask);
        batchTask = [];
        r.push(...rr)
      }
    }
    r = r.map(blk => blk.tx.filter(tx => tx.type === 'ContractTransaction'));
    return r.flat();
  }
  async start() {
    try {
      let block = getSettings('block');
      let latestBlock = await this.getLatestBlockNumber();
      let synced = true;
      if (!block) {
        logger.info('Starting at the latest block', latestBlock - 5);
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
        logger.info('syncing', block, '-', latestBlock);
        const txArr = await this.getBlockRange(block + 1, latestBlock, isFast);
        setSettings('block', latestBlock);
        const transactions = await reduce(txArr, async (result, value) => {
          value = this.extractTxFields(value);
          if (value) {
            for (let x = 0; x < value.txs.length; x++) {
              if (await this.address.verify(value.txs[x].toAddress)) {
                value.toAddress = value.txs[x].toAddress
                value.amount = value.txs[x].amount
                value.txid = value.txid.substr(2)
                if(Array.isArray(result)){
                  result.push(value);
                }else {
                  result = [value]
                }
              }
            }
          }

          return result;
        }, [])
        for (const txInfo of transactions) {
          this.processTx(txInfo, this.id)
          this.id++;
        }
      }
      if (synced) {
        await this.waitFor(5000)
      }
      this.start();
    } catch (e) {
      logger.error(e);
      await this.initProviders(true);
      this.start();
    }
  }
}
