import level from 'level';
import fs from 'fs-extra';
import path from 'path';
let ClassHolder = null;
const root = path.resolve(__dirname, '../../../')
fs.ensureDirSync(path.join(root, 'datas'));
class AddressStore {
  constructor(dbname = 'address') {
    this.dbname = `datas/${dbname}`;
    this.storeLoaded = false;
  }
  async loadStore() {
    this.db = await level(this.dbname, { createIfMissing: true, keyEncoding: 'utf8', valueEncoding: 'json' });
    this.storeLoaded = true;
  }
  async close() {
    await this.db.close()
    this.storeLoaded = false;
  }
  async put(...args) {
    if (!this.storeLoaded) {
      await this.loadStore();
    }
    await this.db.put(...args);
  }
  async fetch(...args) {
    try {
      if (!this.storeLoaded) {
        await this.loadStore();
      }
      const r = await this.db.get(...args);
      return r;
    } catch (e) {
      return false;
    }
  }
  async addAddress(address, obj) {
    if (obj.index) {
      await this.storeLastIndex(obj.index);
    }
    await this.put(address, obj);
  }
  async updateAddressBalance(address,balance) {
    const obj = await this.getAddress(address);
    obj.balance = parseFloat(balance);
    return await this.put(address,obj);
  }
  async getAddress(address) {
    return await this.fetch(address);
  }

  async storeMaster(masterObj) {
    return await this.put('master', masterObj);
  }
  async getMaster() {
    return await this.fetch('master');
  }
  async storeLastIndex(index) {
    return await this.put('index', { index })
  }
  async getLastIndex() {
    try {
      return (await this.fetch('index')).index;
    } catch (e) {
      return 0;
    }
  }
}

export default async function AddrStore() {
  if (!ClassHolder) {
    ClassHolder = new AddressStore();
    await ClassHolder.loadStore()
  }
  return ClassHolder;
}