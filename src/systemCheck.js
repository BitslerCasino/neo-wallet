
import { api } from '@cityofzion/neon-js';
import helpers from "./utils"
import loggerInit from './logger';
import { AddressManager } from './Address/address'
const address = new AddressManager();
const logger = loggerInit();
async function systemCheck() {
  const neoscan = new api.neoscan.instance("MainNet");
  await address.init();
  const r = await address.mnemonicLoaded()
  await address.load(r.mnemonic);
  const lastIndex = await address.lastIndex()
  logger.info("syncing all address balances.. this might take awhile, please wait...")
  let batchArray = []
  for (let x = 0; x <= lastIndex; x++) {
    // regenerate each address and check balance
    let _address = await address.getAddress(x, false)
    const res = await neoscan.getBalance(_address.address);
    let balance;
    if (!res.assets.NEO) {
      balance = 0
    } else {
      balance = res.assets.NEO.balance.toNumber()
    }
    const payload = { index: x, address: _address.address, balance: balance }
    logger.debug("Updating", _address.address, payload);
    batchArray.push({type: "put", key:_address.address, value: payload })
    if(batchArray.length >= 50) {
      await address.updateBatch(batchArray)
      batchArray = []
    }
    await helpers.delay(300)
  }
  if(batchArray.length) {
    await address.updateBatch(batchArray)
    batchArray = []
  }
  logger.info(`Successfully synced ${lastIndex} addresses`)

}
export {systemCheck};