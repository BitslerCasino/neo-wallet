import Koa from 'koa';
import Router from 'koa-router';
import bouncer from 'koa-bouncer';
import bodyParser from 'koa-bodyparser';
import logger from './logger';
import { getSettings, setSettings } from './store.js'
import helpers from './utils';
import config from '../config/production';

function apiStart(tron) {
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
      logger.error(err.stack || err.message);
      if (err instanceof bouncer.ValidationError) {
        ctx.status = err.message === 'Forbidden' ? 403 : 400;
        ctx.body = { success: false, error: err.message };
        return;
      } else {
        ctx.status = err.status || 400;
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
    const payload = await tron.getInfo();
    ctx.body = { success: true, data: payload };
  })
  router.get('/getnewaddress', async ctx => {
    logger.info('RPC /getnewaddress was called');
    const payload = await tron.getNewAddress();
    ctx.body = { success: true, data: payload };
  })
  router.get('/balance', async ctx => {
    logger.info('RPC /balance was called', ctx.request.query);
    const bal = await tron.getMasterBalance();
    ctx.body = { success: true, balance: { value: bal, currency: 'TRX' } };
  });
  router.get('/validate', async ctx => {
    logger.info('RPC /validate was called:', ctx.request.query);
    ctx.validateQuery('address').required('Missing address').isString().trim();
    ctx.check(tron.checkAccountFormat(ctx.vals.address), 'invalid format')
    ctx.body = { success: true }
  });
  router.get('/sweep', async ctx => {
    logger.info('RPC /sweep was called:', ctx.request.query);
    ctx.validateQuery('address').required('Missing address').isString().trim();
    let { balance } = await tron.getBalance(ctx.vals.address);
    let payload = { success: true }
    if (balance > 0) {
      const res = await tron.transferToMaster(ctx.vals.address, true)
      payload.data = res.transaction
    } else {
      payload.success = false
      payload.error = 'not enough balance'
    }
    ctx.body = payload
  });
  router.post('/freezebandwidth', async ctx => {
    logger.info('RPC /freezebandwidth was called:', ctx.request.query);
    ctx.validateBody('amount').required('Missing amount').toDecimal('Invalid amount').tap(n => helpers.truncateTwo(n))
    const res = await tron.freeze(ctx.vals.amount)
    ctx.body = { success: true, txid: res }
    tron.waitFor(60000).then(() => {
      tron.voteSr()
    })
  });
  router.post('/unfreezebandwidth', async ctx => {
    logger.info('RPC /unfreezebandwidth was called:', ctx.request.query);
    const res = await tron.unFreeze()
    ctx.body = { success: true, txid: res }
  });
  router.get('/getalladdress', async ctx => {
    logger.info('RPC /getalladdress was called:', ctx.request.query);
    ctx.validateQuery('balance').optional().toInt();
    let options = { withBalance: false };
    if (ctx.vals.balance && ctx.vals.balance === 1) {
      options.withBalance = true
    }
    const res = await tron.getAllAddress(options);
    if (res) {
      ctx.body = { success: true, addresses: res };
    }
  })
  router.post('/withdraw', async (ctx) => {
    logger.info('RPC /withdraw was called:', ctx.request.query, ctx.request.body);
    ctx.validateBody('amount').required('Missing amount').toDecimal('Invalid amount').tap(n => helpers.truncateTwo(n))
    ctx.validateBody('address').required('Missing address').isString().trim();
    ctx.check(ctx.vals.amount && ctx.vals.amount >= 0.01, 'Invalid amount');
    ctx.check(ctx.vals.address, 'Invalid address');
    const formatAddress = await tron.checkAccountFormat(ctx.vals.address);
    ctx.check(formatAddress, 'Invalid address format');
    const [success, result] = await tron.send(ctx.vals.address, ctx.vals.amount);
    if (!success || !result || !result.transaction_id) {
      return ctx.throw(400, 'not_found');
    }
    if (result && result.transaction_id) {
      let retry = 3;
      let r;
      for (var i = 0; i < retry; i++) {
        r = await tron.verifyTransaction(result.transaction_id);
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