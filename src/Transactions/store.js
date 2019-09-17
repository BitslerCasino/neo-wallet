import CBuffer from '@unibtc/circularqueue';
import { resolve, join } from 'path';
import { pathExists, readJson } from 'fs-extra';
import logger from '../logger';
const Transactions = new CBuffer(50)

async function ifExists(filepath) {
  const exists = await pathExists(filepath);
  if (exists) {
    return filepath;
  }
  return false;
}

const save = () => {
  Transactions.save('transactions');
  logger.info('saving transactions cache')
};

const load = async () => {
  const TxPath = resolve(process.cwd(), '.cache');
  if (!await pathExists(TxPath)) return;
  const exists = await ifExists(join(TxPath, `transactions.json`))
  if (exists) {
    logger.info('loading transactions cache')
    const arr = await readJson(exists);
    if (arr && arr.length) {
      Transactions.push(...arr);
    }
  }
}

const add = (txid) => {
  Transactions.push(txid);
}
const has = (txid) => {
  return Transactions.indexOf(txid) >= 0;
}

export default { add, has, load, save }