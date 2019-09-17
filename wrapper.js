

import { AddressManager, generateMnemonic } from './src/Address/address'
import Tron from './src/Tron';
import api from './src/api';
import logger from './src/logger'
const address = new AddressManager();
const tron = new Tron(address);

async function run() {
  logger.info('Checking wallet...')
  let mnemonic = '';
  await address.init();
  const r = await address.mnemonicLoaded();
  if (!r) {
    mnemonic = generateMnemonic()
  } else {
    mnemonic = r.mnemonic;
  }
  logger.info('Loading wallet...')
  await address.load(mnemonic);
  api(tron);
  tron.start();

}
function save() {
  Tron.save();
}
export default { run, save };