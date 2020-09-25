import { rpc } from '@cityofzion/neon-js';
import helpers from './utils';
import path from 'path';
import fs from 'fs-extra';
const mainnet = path.resolve(__dirname,"mainnet.json")
const rpcProvider = {}
const PING_TIMEOUT_OVERRIDE = 5000
const rpcNodes = async () => {
  const nodes = await fs.readJSON(mainnet);
  return nodes.sites.filter(n => n.type == "RPC");
}

const pingNode = ({ protocol,url,port }) =>
  new Promise(resolve => {
    url = `${protocol}://${url}:${port}`;
    const client = new rpc.RPCClient(url)
    client.ping().then(latency => {
      if (client.lastSeenHeight !== 0) {
        resolve({
          url,
          blockCount: client.lastSeenHeight,
          latency,
        })
      }
    })
  })

  const pingNodes = (nodes) =>
  helpers.raceAll(nodes.map(pingNode), PING_TIMEOUT_OVERRIDE)

  export const getProvider = async (newProvider = false)=> {
    if(!newProvider && rpcProvider.url && rpcProvider.expiry && rpcProvider.expiry > helpers.now()) {
      return rpcProvider.url;
    }
    const rNodes = await rpcNodes();
    const providers = await pingNodes(rNodes);
    const p = providers.filter(node => node).sort((a,b) => a.latency - b.latency).sort((a,b) => b.blockCount - a.blockCount)[helpers.rand()]
    if(!p) {
      console.log("No available provider");
      return false;
    }
    rpcProvider.url = p.url;
    rpcProvider.expiry = helpers.now() + 600000
    return rpcProvider.url;
  }