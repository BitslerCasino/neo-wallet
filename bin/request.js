const phin = require('phin');
const querystring = require('querystring');
const p = phin.defaults({
  'timeout': 150000
});

const parseResponse = r => {
  if (r.body && Buffer.isBuffer(r.body)) {
    r.body = r.body.toString('utf8');
  }
  if (typeof r.body == 'string') {
    try {
      r.body = JSON.parse(r.body.trim());
    } catch (e) {
      console.error(e.message, 'Non json parseable response', r.body);
      return false;
    }
  }
  return r;
};

exports.getter = async function(url, query = {}, json = true) {
  if (typeof query !== 'object') {
    throw new Error('query option must be of type Object if present.');
  }
  query = querystring.stringify(query);
  query = query.length ? `?${query}` : query;
  url += query;
  try {
    const r = await p({
      url,
      method: 'GET'
    });
    return json ? parseResponse(r) : r;
  } catch (e) {
    console.error(url, e.stack || e.message);
    return false;
  }
}

exports.poster = async function(url, query, data, form = false) {
  try {
    query = querystring.stringify(query);
    query = query.length ? `?${query}` : query;
    url += query;
    const payload = {
      url,
      method: 'POST'
    };
    if (!form) {
      payload.headers = {
        'content-type': 'application/json; charset=UTF-8'
      };
      payload.data = data;
    } else {
      payload.form = data;
    }
    const r = await p(payload);
    return parseResponse(r);
  } catch (e) {
    console.error(url, e.stack || e.message);
    return false;
  }
}