const request = require('../bin/request');
const fs = require('fs-extra');
const path = require('path')
const mainnet = path.resolve(__dirname,'mainnet.json');
let timer = 0;

async function getUpdatedProviders() {
  try {
    const result = await request.getter('https://monitor.cityofzion.io/mainnet.json');
    if(result.body.sites.length) {
      await fs.outputJson(mainnet, result.body)
      console.log("Providers updated!")
    }
  }catch(_) {
    console.log("Provider update Failed, Retrying in 15 mins")
  }
  clearTimeout(timer);
  timer = setTimeout(getUpdatedProviders, process.env.RESTART * 60 * 1000)
}
getUpdatedProviders()