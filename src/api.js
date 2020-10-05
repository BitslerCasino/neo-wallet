import Koa from 'koa';
import Router from 'koa-router';
import bouncer from 'koa-bouncer';
import bodyParser from 'koa-bodyparser';
import logger from './logger';
import { getSettings, setSettings } from './store.js'
import helpers from './utils';
import config from '../config/production';

function apiStart(neo) {
  const secret = getSettings('secret');
  if (!secret) {
    setSettings('secret', helpers.genKey());
  }
  const app = new Koa();
  const router = new Router();
  app.use(
    bodyParser({
      extendTypes: {
        json: ['text/plain']
      },
      enableTypes: ['json']
    })
  );
  app.use(bouncer.middleware());
  app.use(async (ctx, next) => {
    try {
      await next();
    } catch (err) {
      logger.error(err.stack || err.message || err);
      if (err instanceof bouncer.ValidationError) {
        ctx.status = err.message === 'Forbidden' ? 403 : 400;
        ctx.body = { success: false, error: err.message };
        return;
      } else {
        ctx.status = err.status || 400;
        if (err.json) {
          err.message = err.json.message
        }
        ctx.body = { success: false, error: err.message };
        return;
      }
    }
  });

  router.use(async (ctx, next) => {
    const secretKey = getSettings('secret');
    ctx.validateQuery('key').required('Missing key').isString().trim();
    ctx.check(secretKey === ctx.vals.key, 'Forbidden')
    ctx.request.query.key = helpers.hideKey(ctx.request.query.key)
    delete ctx.vals.key
    await next();
  });
  router.get('/getinfo', async ctx => {
    logger.info('RPC /getinfo was called');
    const payload = await neo.getInfo();
    ctx.body = { success: true, data: payload };
  })
  router.get('/getnewaddress', async ctx => {
    logger.info('RPC /getnewaddress was called');
    const payload = await neo.getNewAddress();
    ctx.body = { success: true, data: payload };
  })
  router.get('/getblocknumber', async ctx => {
    logger.info('RPC /getblocknumber was called');
    const payload = neo.getBlockNumber();
    ctx.body = { success: true, data: payload };
  })
  router.get('/balance', async ctx => {
    logger.info('RPC /balance was called', ctx.request.query);
    const bal = await neo.getMasterBalance();
    ctx.body = { success: true, balance: { value: bal, currency: 'NEO' } };
  });
  router.get('/validate', async ctx => {
    logger.info('RPC /validate was called:', ctx.request.query);
    ctx.validateQuery('address').required('Missing address').isString().trim();
    ctx.check(neo.checkAccountFormat(ctx.vals.address), 'invalid format')
    ctx.body = { success: true }
  });
  router.get('/sweep', async ctx => {
    logger.info('RPC /sweep was called:', ctx.request.query);
    ctx.validateQuery('address').required('Missing address').isString().trim();
    let { balance } = await neo.getBalance(ctx.vals.address);
    let payload = { success: true }
    if (balance > 0.1) {
      const res = await neo.transferToMaster(ctx.vals.address, true)
      payload.data = res.transaction
    } else {
      payload.success = false
      payload.error = 'not enough balance'
    }
    ctx.body = payload
  });
  router.get('/sweepall', async ctx => {
    logger.info('RPC /sweepall was called:', ctx.request.query);
    const res = await neo.getAllAddress({ withBalance: true });
    let payload = { success: true }
    const tasks = []
    for (const addr of res) {
      if (addr.balance > 0.1) {
        tasks.push(neo.transferToMaster(addr.address, true))
      }
    }
    await Promise.all(tasks);
    ctx.body = payload
  });

  router.get('/getalladdress', async ctx => {
    logger.info('RPC /getalladdress was called:', ctx.request.query);
    ctx.validateQuery('balance').optional().toInt();
    let options = { withBalance: false };
    if (ctx.vals.balance && ctx.vals.balance === 1) {
      options.withBalance = true
    }
    const res = await neo.getAllAddress(options);
    if (res) {
      ctx.body = { success: true, addresses: res };
    }
  })
  router.get('/claimgas', async ctx => {
    logger.info('RPC /claimgas was called:', ctx.request.query);

    const res = await neo.claimGas();
    if (res) {
      ctx.body = { success: true, result: res };
    }else {
      ctx.body = {success: false}
    }
  })
  router.post('/withdraw', async (ctx) => {
    logger.info('RPC /withdraw was called:', ctx.request.query, ctx.request.body);
    ctx.validateBody('amount').required('Missing amount').toDecimal('Invalid amount').tap(n => helpers.truncateTwo(n))
    ctx.validateBody('address').required('Missing address').isString().trim();
    ctx.check(ctx.vals.amount && ctx.vals.amount >= 0.01, 'Invalid amount');
    ctx.check(ctx.vals.address, 'Invalid address');
    const formatAddress = await neo.checkAccountFormat(ctx.vals.address);
    ctx.check(formatAddress, 'Invalid address format');
    const [success, result] = await neo.send(ctx.vals.address, ctx.vals.amount, null, null, true);
    if (!success || !result || !result.transaction_id) {
      return ctx.throw(400, 'not_found');
    }
    if (result && result.transaction_id) {
      let retry = 3;
      let r;
      for (let i = 0; i < retry; i++) {
        r = await neo.verifyTransaction(result.transaction_id);
        if(!r) continue;
        if (r[0] == true) break;
      }
      if (!r[0] && r[1] && r[1] == 'not_found') {
        return ctx.throw(400, 'not_found');
      } else if (!r[0] && !r[1]) {
        ctx.body = { success, txid: result.transaction_id };
      }
      ctx.body = { success, txid: result.transaction_id };
      logger.info('txid:', result.transaction_id)
    }
  });
  app.use(router.routes());
  app.use(router.allowedMethods());

  app.listen(config.PORT, '0.0.0.0', () => {
    logger.info('API Listening on port', config.PORT)
  })

}
export default apiStart;
