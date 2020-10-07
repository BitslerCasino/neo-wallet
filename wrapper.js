
import {systemCheck} from './src/systemCheck';
import { AddressManager, generateMnemonic } from './src/Address/address'
import Neo from './src/Neo';
import api from './src/api';
import * as loggerInit from './src/logger';
import * as logInstance from './src/lg';


const address = new AddressManager();
const neo = new Neo(address);

async function run() {
  const log = await logInstance.default()
  const logger = loggerInit.default(log);
  await neo.init(logger);
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
  api(neo, logger);
  systemCheck()
  neo.start();
}
function save() {
  Neo.save();
}
export default { run, save };