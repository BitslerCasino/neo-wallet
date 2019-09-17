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
const notify = async txobj => {
  q.push(async retry => {
    const notifyUrl = process.env.NODE_ENV === production ? config.NOTIFY_URL:config.NOTIFY_URL_DEV
    console.log(notifyUrl)
    const r = await got('POST', notifyUrl, txobj);
    console.log(r)
    if (r) {
      logger.info('Notification sent with txid', txobj.hash);
    }
    retry(!r);
  });
};
export default notify;