const request = require('../bin/request');
const fs = require('fs-extra');
const path = require('path')
const mainnet = path.resolve(__dirname, 'mainnet.json');
let timer = 0;

async function getUpdatedProviders() {
  try {
    const result = await request.getter('https://dora.coz.io/api/v1/neo2/mainnet/get_all_nodes');
    if (result.body.length) {
      await fs.outputFile(mainnet, JSON.stringify(result.body));
      console.log("Providers updated!");
    }
  } catch (_) {
    console.log("Provider update Failed, Retrying in 15 mins")
  }
  clearTimeout(timer);
  timer = setTimeout(getUpdatedProviders, process.env.RESTART * 60 * 1000)
}
getUpdatedProviders()