import TronGrid from 'trongrid';
import TronWeb from 'tronweb';
import get from 'lodash/get';
import flatMap from 'lodash/flatMap';
import find from 'lodash/find';
import orderBy from 'lodash/orderBy';
import reduce from 'lodash/reduce';
import txCache from './Transactions/store';
import { getSettings, setSettings } from './store.js'
import notifier from './notify';
import logger from './logger';
import helpers from './utils';
import config from '../config/production';

export default class Tron {
  static save() {
    txCache.save();
  }
  constructor(addressManager) {
    this.txCache = txCache;
    this.address = addressManager;
    this.txCache.load();
    this.tronWeb = new TronWeb({
      fullNode: config.HOST,
      solidityNode: config.HOST,
      eventServer: config.HOST
    });
    this.tronWeb.setDefaultBlock('earliest');
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

  async transferToMaster(from, sweep = false) {
    const { address } = await this.address.getMaster();
    const privateKey = await this.address.getPriv(from);
    const {balance} = await this.getBalance(from);
    const amount = this.tronWeb.fromSun(balance) - 0.1;
    if(address == from) return false;
    if(sweep || amount > 0.0001) {
      logger.info('Transferring', amount, 'to Master address', address, 'from', from)
      const result = await this.sendTrx(address, this.tronWeb.toSun(amount), from, privateKey);
      return result
    }else {
      logger.info('Not enough balance(balance-0.1) to transfer', amount);
      logger.info('Manually sweep the balance if you want to transfer');
      return false
    }
  }

  async sendTrx(to, amount, from, privateKey) {
    try {
      const unsignedTx = await this.tronWeb.transactionBuilder.sendTrx(to, amount, from);
      const signedTx = await this.tronWeb.trx.sign(unsignedTx, privateKey);
      const result = await this.tronWeb.trx.sendRawTransaction(signedTx);
      return result;
    } catch (e) {
      logger.error(e)
    }
  }
  toSun(amt) {
    return this.tronWeb.toSun(amt);
  }
  async send(to, amount) {
    try {
      const { privateKey, address } = await this.address.getMaster();
      const balance = await this.getMasterBalance() - amount;
      if (balance <= 0) {
        return [false]
      }
      amount = this.tronWeb.toSun(amount);
      if (balance > config.FREEZE) {
        this.checkResources(address);
      }
      if(address === to) {
        return [false]
      }
      const r = await this.sendTrx(to, amount, address, privateKey);
      if (r && r.result) {
        await this.waitFor(3000);
        return [true, { transaction_id: r.transaction.txID }];
      }else {
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
      const r = await this.tronWeb.trx.getTransaction(txid);
      const ret = get(r, 'ret[0].contractRet')
      return [ret === 'SUCCESS'];
    } catch (e) {
      if (e == 'Transaction not found') {
        return [false, 'not_found']
      }
    }
  }

  notify(from, to, txid, amount) {
    logger.info('Transaction found', txid, amount, 'from', from)
    this.txCache.add(txid);
    const payload = {}
    payload.hash = txid;
    payload.amount = amount;
    payload.token = 'TRX';
    payload.from = from;
    payload.to = to;
    notifier(payload);
  }
  extractTxFields(tx) {

    const contractParam = get(tx, 'raw_data.contract[0].parameter.value')
    const txType = get(tx, 'raw_data.contract[0].type');
    if (txType !== 'TransferContract') return;
    if (!(contractParam && typeof contractParam.amount === 'number')) {
      throw new Error('Unable to get transaction')
    }

    const amountSun = contractParam.amount || 0
    const amountTrx = this.tronWeb.fromSun(amountSun)
    const toAddress = this.tronWeb.address.fromHex(contractParam.to_address)
    const fromAddress = this.tronWeb.address.fromHex(contractParam.owner_address)
    return {
      txid: tx.txID,
      amountTrx,
      amountSun,
      toAddress,
      fromAddress,
    }
  }

  async processTx(txInfo,retry = 0) {
    if (txInfo && !this.txCache.has(txInfo.txid)) {
      try {
        logger.info('Processing transaction...')
        setTimeout(async() => {
          const r = await this.transferToMaster(txInfo.toAddress);
          if (r && r.transaction) {
            this.notify(txInfo.fromAddress, txInfo.toAddress, txInfo.txid, txInfo.amountTrx)
            logger.info('Successfully sent:', r.transaction.txID)
          }else {
            logger.info('Transfer to master failed... retrying in 60 seconds');
            retry++;
            if(retry <= 10) {
              await this.waitFor(60000)
              this.processTx(txInfo,retry)
            }else {
              this.notify(txInfo.fromAddress, txInfo.toAddress, txInfo.txid, txInfo.amountTrx)
            }
          }
        },15000)
      } catch (e) {
        logger.error(e)
        this.txCache.add(txInfo.txid);
      }
    }
  }
  checkAccountFormat(address) {
    return this.tronWeb.isAddress(address);
  }
  async voteSr() {
    const { address, privateKey } = await this.address.getMaster();
    const voteCount = await this.getTotalFrozenBal(address)
    if (voteCount.total === 0) return;
    let sr = await this.tronWeb.trx.listSuperRepresentatives()
    sr = orderBy(sr, ['voteCount'], ['desc']).slice(0, 5);
    let m = find(sr, ['url', 'https://www.bitguild.com']) || find(sr, ['url', 'http://tronone.com']) || sr[0];
    const unsignedTx = await this.tronWeb.transactionBuilder.vote({ [m.address]: this.tronWeb.fromSun(voteCount.total) }, this.tronWeb.address.toHex(address), 1);
    const signedTx = await this.tronWeb.trx.sign(unsignedTx, privateKey);
    await this.tronWeb.trx.sendRawTransaction(signedTx);
    logger.info('Voted ', this.tronWeb.fromSun(voteCount.total), 'POWER for', find(sr, ['address', m.address]).url);
  }
  async getTotalFrozenBal(address) {
    const accInfo = await this.tronWeb.trx.getAccount(address);
    if (!accInfo) return;
    let currentVote = 0;
    if (accInfo.votes && accInfo.votes.length) {
      for (const v of accInfo.votes) {
        currentVote += this.tronWeb.toSun(v.vote_count)
      }
    }
    const delegated = get(accInfo, 'delegated_frozen_balance_for_bandwidth') || 0
    const frozen = get(accInfo, 'frozen[0].frozen_balance') || 0
    const totalFrozen = delegated + frozen;
    const total = (totalFrozen - currentVote) > 0 ? totalFrozen : 0;
    return { total, expire: get(accInfo, 'frozen[0].expire_time') || 0 };
  }
  async checkAndUnfreezeBalance(address) {
    const accInfo = await this.getTotalFrozenBal(address)
    if (!accInfo) return;
    if (accInfo.total == 0) return 0;
    if (accInfo.expire && new Date(accInfo.expire) < new Date()) {
      const unsignedTx = await this.tronWeb.transactionBuilder.unfreezeBalance('BANDWIDTH', address, address, 1);
      const signedTx = await this.tronWeb.trx.sign(unsignedTx, this.address.getPriv(address));
      await this.tronWeb.trx.sendRawTransaction(signedTx);
      return accInfo.total;
    }
    return 0;
  }
  async freeze(amt) {
    const { address, privateKey } = await this.address.getMaster();
    const balance = await this.getMasterBalance()
    if (balance < amt) return false;
    const unsignedTx = await this.tronWeb.transactionBuilder.freezeBalance(this.tronWeb.toSun(amt), 3, "BANDWIDTH", address, address, 1);
    const signedTx = await this.tronWeb.trx.sign(unsignedTx, privateKey);
    const res = await this.tronWeb.trx.sendRawTransaction(signedTx);
    logger.info('Froze', amt, 'TRX');
    return res.transaction.txID;
  }
  async unFreeze() {
    const { address, privateKey } = await this.address.getMaster();
    const { expire, total } = await this.getTotalFrozenBal(address)
     if (new Date(expire) > new Date() ) return Promise.reject(new Error('Frozen expiry not yet met'));
    if(!total) return Promise.reject(new Error('No frozen balance'));
    const unsignedTx = await this.tronWeb.transactionBuilder.unfreezeBalance('BANDWIDTH', address, address, 1);
    const signedTx = await this.tronWeb.trx.sign(unsignedTx, privateKey);
    const res =await this.tronWeb.trx.sendRawTransaction(signedTx);
    logger.info('unFroze', total, 'TRX');
    return res.transaction.txID;
  }
  async checkResources() {
    const { address, privateKey } = await this.address.getMaster();
    const bandwidth = await this.tronWeb.trx.getBandwidth(address);
    let amountFreeze = config.FREEZE
    if (bandwidth < 500) {
      const avail = await this.checkAndUnfreezeBalance(address);
      if (avail && avail >= amountFreeze) {
        amountFreeze = avail
      }
      this.freeze(amountFreeze);
      await this.waitFor(60000)
      await this.voteSr()
    }
  }
  async getMasterBalance() {
    try {
      const { address } = await this.address.getMaster();
      const result = await this.getBalance(address);
      return this.tronWeb.fromSun(result.balance);
    } catch (e) {
      logger.error(e)
      return 0;
    }
  }
  async getBalance(address) {
    const res = await this.tronWeb.trx.getAccount(address);
    if (!res) return { balance: 0 };
    if (!get(res, 'address') || !get(res, 'balance')) return { balance: 0 };
    return { address, balance: res.balance, timestamp: res.latest_opration_time }
  }
  async getNewAddress() {
    const res = await this.address.create();
    return res;
  }

  async getLatestBlockNumber() {
    const currentBlock = await this.tronWeb.trx.getCurrentBlock()
    return get(currentBlock.block_header, 'raw_data.number')
  }
  async getAllAddress({ withBalance }) {
    try {
      const size = await this.address.lastIndex()
      let addresses = [];
      for (let i = 0; i <= size; i++) {
        const address = await this.address.getAddress(i)
        const pl = { address };
        if (withBalance) {
          const { balance } = await this.getBalance(address);
          pl.balance = this.tronWeb.fromSun(balance)
        }
        addresses.push(pl)
      }
      return addresses;
    } catch (e) {
      logger.error(e)
    }
  }
  async start() {
    try {
    let block = getSettings('block');
    const latestBlock = await this.getLatestBlockNumber();
    if (!block) {
      logger.info('Starting at the latest block', latestBlock - 5);
      block = latestBlock - 5
    }
    if (latestBlock > block && (latestBlock - block) > 2) {
      logger.info('syncing', block, '-', latestBlock);
      const blockArr = await this.tronWeb.trx.getBlockRange(block + 1, latestBlock);
      setSettings('block', latestBlock);
      let transactions = flatMap(blockArr, (n) => n.transactions)
      transactions = await reduce(transactions, async (result, value) => {
        result = await Promise.resolve(result);
        value = this.extractTxFields(value);
        if (value && await this.address.verify(value.toAddress)) {
          result.push(value);
        }
        return result;
      }, [])
      for (const txInfo of transactions) {
        this.processTx(txInfo)
      }
    }
    await this.waitFor(8000)
    this.start();
    }catch(e) {
      logger.error(e);
      this.start();
    }
  }
}
