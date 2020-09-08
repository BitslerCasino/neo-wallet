import { rpc } from '@cityofzion/neon-js';
import helpers from './utils';
import providerNodes from './mainnet.json'
const rpcProvider = {}
const PING_TIMEOUT_OVERRIDE = 5000
const rpcNodes = providerNodes.sites.filter(n => n.type == "RPC")
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
    const providers = await pingNodes(rpcNodes);
    const p = providers.filter(node => node).sort((a,b) => a.latency - b.latency).sort((a,b) => b.blockCount - a.blockCount)[helpers.rand()]
    if(!p) {
      throw new Error("No available provider")
    }
    rpcProvider.url = p.url;
    rpcProvider.expiry = helpers.now() + 600000
    return rpcProvider.url;
  }