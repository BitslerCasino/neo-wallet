import { getter } from './request';
import crypto from 'crypto';

const truncateTwo = (num = 0) => {
  const str = parseFloat(num).toFixed(12);
  return Number(str.substr(0, str.indexOf('.') + 3));
};
const hideKey = (key) => {
  return `${key.substr(0, 3)}******${key.substr(key.length - 3, key.length)}`;
}
const shortid = (size = 4) => {
    return crypto.randomBytes(size).toString('hex')
}
const getPubIp = async () => {
  const { body } = await getter('https://ipv4.icanhazip.com/', {}, false);
  if (!body) {
    return 'localhost';
  }
  return body.toString();
};
const genKey = () => {
  return crypto.randomBytes(8).toString('hex');
}
const delay = t =>
  new Promise(resolve => {
    setTimeout(resolve, t)
  })

const raceAll = (promises, timeoutTime) =>
  Promise.all(promises.map(p => Promise.race([p, delay(timeoutTime)])))

const rand = () => Math.floor(Math.random() * 10);
const now = () => new Date().getTime();
const getFromObj = (nestedObj, ...args) => {
  return args.reduce(
    (obj, key) => (obj && obj[key] !== 'undefined' ? obj[key] : null), nestedObj)
}

export default {
    truncateTwo,
    hideKey,
    getPubIp,
    genKey,
    shortid,
    raceAll,
    rand,
    now,
    getFromObj,
    delay
}
