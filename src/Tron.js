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

const tronWeb = new TronWeb({
  fullNode: config.HOST,
  solidityNode: config.HOST,
  eventServer: config.HOST
});
tronWeb.setDefaultBlock('earliest');
export default class Tron {
  static save() {
    txCache.save();
  }
  constructor(addressManager) {
    this.txCache = txCache;
    this.address = addressManager;
    this.txCache.load();
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

  async transferToMaster(addr, amount) {
    const { address } = await this.address.getMaster()
    logger.info('Transferring', amount, 'to Master address', address, 'from', addr)
    const result = await this.transferTrx(addr, address, amount);
    return result
 }
  async sweepToMaster(addr) {
    const { balance } = await this.getBalance(addr);
    const r = await this.transferToMaster(addr, balance)
    return r
  }
  async send(to, amount) {
    try {
      const { privateKey, address } = await this.address.getMaster();
      const balance = await this.getMasterBalance() - amount;
      if (balance <= 0) {
        return [false]
      }
      amount = tronWeb.toSun(amount);
      if (balance > config.FREEZE) {
        this.checkResources(address);
      }
      if (privateKey) {
        const r = await tronWeb.trx.sendTransaction(to, amount, privateKey)
        if (r.result) {
          await this.waitFor(3000);
          return [true, { transaction_id: r.transaction.txID }];
        }
      }
    } catch (e) {
      logger.error(e);
      return [false]
    }
  }
  async verifyTransaction(txid) {
    try {
      await this.waitFor(3000);
      const r = await tronWeb.trx.getTransaction(txid);
      const ret = get(r, 'ret[0].contractRet')
      return [ret === 'SUCCESS'];
    } catch (e) {
      if (e == 'Transaction not found') {
        return [false, 'not_found']
      }
    }
  }
  async transferTrx(from, to, amount) {
    const priv = await this.address.getPriv(from);
    if (priv) {
      const r = await tronWeb.trx.sendTransaction(to, amount, priv)
      if (r.result) {
        return { txid: r.transaction.txID };
      }
    }
  }
  notify(from, to, txid, amount) {
    logger.info('Transaction found', txid, amount, 'from', from)
    this.txCache.add(txid);
    const payload = {}
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
    const amountTrx = tronWeb.fromSun(amountSun)
    const toAddress = tronWeb.address.fromHex(contractParam.to_address)
    const fromAddress = tronWeb.address.fromHex(contractParam.owner_address)
    return {
      txid: tx.txID,
      amountTrx,
      amountSun,
      toAddress,
      fromAddress,
    }
  }

  async processTx(txInfo) {
    if (txInfo && !this.txCache.has(txInfo.txid)) {
      try {
        await this.waitFor(10000)
        this.notify(txInfo.fromAddress, txInfo.toAddress, txInfo.txid, txInfo.amountTrx)
        const r = await this.transferToMaster(txInfo.toAddress, txInfo.amountSun);
        if(r && r.txid) {
            logger.info('Successfully sent:', r.txid)
        }
      } catch (e) {
        logger.error(e)
        this.txCache.add(txInfo.txid);
      }
    }
  }
  checkAccountFormat(address) {
    return tronWeb.isAddress(address);
  }
  async voteSr() {
    const { address, privateKey } = await this.address.getMaster();
    const voteCount = await this.getTotalFrozenBal(address)
    if (voteCount.total === 0) return;
    let sr = await tronWeb.trx.listSuperRepresentatives()
    sr = orderBy(sr, ['voteCount'], ['desc']).slice(0, 5);
    let m = find(sr, ['url', 'https://www.bitguild.com']) || find(sr, ['url', 'http://tronone.com']) || sr[0];
    const unsignedTx = await tronWeb.transactionBuilder.vote({ [m.address]: tronWeb.fromSun(voteCount.total) }, tronWeb.address.toHex(address), 1);
    const signedTx = await tronWeb.trx.sign(unsignedTx, privateKey);
    await tronWeb.trx.sendRawTransaction(signedTx);
    logger.info('Voted ', tronWeb.fromSun(voteCount.total), 'POWER for', find(sr, ['address', m.address]).url);
  }
  async getTotalFrozenBal(address) {
    const accInfo = await tronWeb.trx.getAccount(address);
    if (!accInfo) return;
    let currentVote = 0;
    if (accInfo.votes && accInfo.votes.length) {
      for (const v of accInfo.votes) {
        currentVote += tronWeb.toSun(v.vote_count)
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
      const unsignedTx = await tronWeb.transactionBuilder.unfreezeBalance('BANDWIDTH', address, address, 1);
      const signedTx = await tronWeb.trx.sign(unsignedTx, this.address.getPriv(address));
      await tronWeb.trx.sendRawTransaction(signedTx);
      return accInfo.total;
    }
    return 0;
  }
  async freeze(amt) {
    const { address, privateKey } = await this.address.getMaster();
    const balance = await this.getMasterBalance()
    if (balance < amt) return false;
    const unsignedTx = await tronWeb.transactionBuilder.freezeBalance(tronWeb.toSun(amt), 3, "BANDWIDTH", address, address, 1);
    const signedTx = await tronWeb.trx.sign(unsignedTx, privateKey);
    await tronWeb.trx.sendRawTransaction(signedTx);
    logger.info('Froze', amt, 'TRX');
  }
  async unFreeze(amt) {
    const { address, privateKey } = await this.address.getMaster();
    const { expiry } = await this.getTotalFrozenBal()
    if (new Date(expiry) > new Date()) return false;
    const unsignedTx = await tronWeb.transactionBuilder.unfreezeBalance('BANDWIDTH', address, address, 1);
    const signedTx = await tronWeb.trx.sign(unsignedTx, privateKey);
    await tronWeb.trx.sendRawTransaction(signedTx);
    logger.info('unFroze', amt, 'TRX');
  }
  async checkResources() {
    const { address, privateKey } = await this.address.getMaster();
    const bandwidth = await tronWeb.trx.getBandwidth(address);
    let amountFreeze = config.FREEZE
    if (bandwidth < 500) {
      const avail = await this.checkAndUnfreezeBalance(address);
      if (avail && avail >= amountFreeze) {
        amountFreeze = avail
      }
      const unsignedTx = await tronWeb.transactionBuilder.freezeBalance(tronWeb.toSun(amountFreeze), 3, "BANDWIDTH", address, address, 1);
      const signedTx = await tronWeb.trx.sign(unsignedTx, privateKey);
      await tronWeb.trx.sendRawTransaction(signedTx);
      logger.info('Froze', amountFreeze, 'TRX');
      await this.waitFor(60000)
      await this.voteSr()
    }
  }
  async getMasterBalance() {
    try {
      const { address } = await this.address.getMaster();
      const result = await this.getBalance(address);
      return tronWeb.fromSun(result.balance);
    } catch (e) {
      logger.error(e)
    }
  }
  async getBalance(address) {
    const res = await tronWeb.trx.getAccount(address);
    if (!res) return { balance: 0 };
    if (!get(res, 'address') || !get(res, 'balance')) return { balance: 0 };
    return { address, balance: res.balance, timestamp: res.latest_opration_time }
  }
  async getNewAddress() {
    const res = await this.address.create();
    return res;
  }

  async getLatestBlockNumber() {
    const currentBlock = await tronWeb.trx.getCurrentBlock()
    return get(currentBlock.block_header, 'raw_data.number')
  }

  async start() {
    let block = getSettings('block');
    const latestBlock = await this.getLatestBlockNumber();
    if (!block) {
      logger.info('Starting at the latest block', latestBlock - 5);
      block = latestBlock - 5
    }
    if (latestBlock > block && (latestBlock - block) > 2) {
      logger.info('syncing', block, '-', latestBlock);
      const blockArr = await tronWeb.trx.getBlockRange(block + 1, latestBlock);
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
  }
}
