import queue from 'queuing';
import logger from './logger';
import config from '../config/production';
import p from 'phin';
const q = queue({ autostart: true, retry: true, concurrency: 1, delay: 5000 });
import pkgjson from '../package.json';
const got = async (method, uri, payload) => {
  const opts = {
    url: uri,
    method,
    data: payload,
    headers: {
      'User-Agent': `${pkgjson.name.charAt(0).toUpperCase() + pkgjson.name.substr(1)}/${pkgjson.version} (Node.js ${process.version})`,
      'Content-Type': 'application/json'
    }
  };
  try {
    const r = await p(opts);
    if (r.statusCode !== 200) {
      if (opts.url !== 'https://canihazip.com/s') {
        logger.error(`error sending notification statusCode: ${r.statusCode}. retrying...`);
       }
      return false;
    }
    return r.body || true;
  } catch (e) {
    if (opts.url !== 'https://canihazip.com/s') {
      logger.error(`error sending notification ${e.message || e.stack}. retrying...`);
    }
    return false;
  }
};
const notify = async (txobj,id) => {
  q.push(async retry => {
    const notifyUrl = config.NOTIFY_URL
    const r = await got('POST', notifyUrl, txobj);
    if (r) {
      logger.info(`[${id}]Notification sent with txid`, txobj.hash, txobj.amount);
    }
    retry(!r);
  });
};
export default notify;