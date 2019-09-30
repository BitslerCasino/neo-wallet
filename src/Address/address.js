import Address from '@bitsler/tron-address'
import AddressStore from './database/addressDatabase'

export const generateMnemonic = Address.generateMnemonic;
export class AddressManager {
  constructor() {
    this.loaded = false
  }
  async init() {
    this.db = await AddressStore();
  }
  async load(mnemonic) {
    if (!mnemonic) {
      throw new Error('Invalid/Missing mnemonic')
    }
    const index = await this.db.getLastIndex();
    this.address = new Address(mnemonic, index);
    await this.db.storeMaster(this.address.masterInfo)
    this.loaded = true;
  }
  async create() {
    const addr = await this.address.createAddress();
    await this.db.addAddress(addr.address, addr);
    return addr.address;
  }
  async setBalance(address, balance) {
    this.db.updateAddressBalance(address, balance)
  }

  async verify(address) {
    try {
      return await this.db.getAddress(address);
    } catch (e) {
      return false;
    }
  }
  async getPriv(address) {
    const addrInfo = await this.verify(address);
    if (addrInfo) {
      const index = addrInfo.index;
      return await this.address.getAddressInfo(index).privateKey;
    }
  }
  async getMaster() {
    return await this.db.getMaster();
  }
  async getAddressInfo(address) {
    const addrInfo = await this.verify(address);
    if (addrInfo) {
      const index = addrInfo.index;
      return await this.address.getAddressInfo(index);
    }
  }
  async getAddress(index, withBalance = false) {
    const address = await this.address.getAddress(index);
    if (withBalance) {
      const res = await this.db.getAddress(address);
      if (res.balance) {
        return { address, balance: res.balance }
      }
    }
      return { address }

  }
  async lastIndex() {
    return await this.db.getLastIndex();
  }
  async mnemonicLoaded() {
    try {
      const r = await this.getMaster();
      if (!r) {
        return false;
      }
      return r;
    } catch (e) {
      console.error(e)
      return false;
    }
  }


}