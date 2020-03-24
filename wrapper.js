

import { AddressManager, generateMnemonic } from './src/Address/address'
import Neo from './src/Neo';
import api from './src/api';
import logger from './src/logger'
const address = new AddressManager();
const neo = new Neo(address);

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
  api(neo);
  neo.start();

}
function save() {
  Neo.save();
}
export default { run, save };