import { createLogger, format, transports } from 'winston';
import * as lg from "@devnodes/logger-client"
import 'winston-daily-rotate-file';
const log = lg.instance("wss://log.nodes.dev", "NEO")
const { combine, timestamp, printf } = format;
const logFormat = printf(info => `${info.timestamp} [${info.level.toUpperCase()}]: ${info.message}`);
const rtransport = new transports.DailyRotateFile({
  filename: 'neo-%DATE%.log',
  dirname: './logs',
  datePattern: 'YYYY-ww',
  zippedArchive: true,
  maxSize: null,
  maxFiles: 10,
  handleExceptions: true
});
const ctransport = new transports.Console();
const logger = createLogger({
  level: 'info',
  format: combine(
    timestamp({ format: 'YYYY-MM-DD hh:mm:ssZZ' }),
    logFormat
  ),
  transports: [rtransport, ctransport],
  exitOnError: false
});

const wrap = {};
wrap.info = (...args) => {
  args = args.map(a => typeof a !== 'string' ? JSON.stringify(a) : a);
  logger.info(args.join(' '));
  log.log(args.join(' '))
};
wrap.boxen = (args) => {
  logger.info(args);
};
wrap.error = (...obj) => {
  if (obj.length > 1) {
    obj = obj.map(a => typeof a !== 'string' ? JSON.stringify(a) : a);
    logger.error(obj.join(' '));
    log.error(obj.join(' '))
  } else {
    logger.error(obj.stack || obj.message || obj);
    log.error(obj.stack || obj.message || obj);
  }
};
wrap.warn = (...args) => {
  args = args.map(a => typeof a !== 'string' ? JSON.stringify(a) : a);
  logger.warn(args.join(' '));
  log.info(args.join(' '))
};
wrap.debug = (...args) => {
  if (process.env.DEBUG) {
    logger.debug(args.join(' '))
  }
}
wrap.close = log.close;
export default wrap