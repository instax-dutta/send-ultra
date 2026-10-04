const routes = require('../../app/routes');
const storage = require('../storage');
const state = require('../state');

/*
 * Rendering a page builds a choo router and serialises the whole DOM tree.
 * Neither depends on anything that varies per request except the CSP nonce,
 * so both are memoised:
 *
 *   - the choo router is built once per process
 *   - the serialised HTML is cached per (route, locale, robots, baseUrl,
 *     download metadata) and the per-request nonce is substituted afterwards
 *
 * The cached document is rendered with a fixed sentinel in place of the real
 * nonce, so a cache hit can never ship a previous request's nonce. The
 * substitution is verified rather than assumed: if the real nonce turns up
 * inside a cached document, the render leaked request state and the page is
 * re-rendered uncached instead of being served.
 */

const NONCE_SENTINEL = '__SEND_CSP_NONCE_SENTINEL__';
const CACHE_LIMIT = 500;

let router = null;
const cache = new Map();

function getRouter() {
  if (!router) {
    router = routes();
  }
  return router;
}

function stripEvents(str) {
  // For CSP we need to remove all the event handler placeholders.
  // It's ok, app.js will add them when it attaches to the DOM.
  return str.replace(/\son\w+=""/g, '');
}

function cacheKey(route, appState) {
  const meta = appState.downloadMetadata;
  return [
    route,
    appState.locale,
    appState.robots,
    appState.baseUrl,
    meta ? meta.nonce : '',
    meta ? meta.pwd : '',
    meta ? meta.status : ''
  ].join('|');
}

function cacheSet(key, html) {
  if (cache.size >= CACHE_LIMIT) {
    // Map preserves insertion order, so this evicts the oldest entry.
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      cache.delete(oldest);
    }
  }
  cache.set(key, html);
}

/*
 * Swap the sentinel for the real nonce. Both invariants are checked: no
 * sentinel may survive into the response, and every placeholder must have
 * become a nonce. A substring scan for the nonce would not work here, because a
 * short nonce occurs naturally in the markup.
 */
function substituteNonce(html, nonce) {
  const placeholders = html.split(NONCE_SENTINEL).length - 1;
  const out = html.split(NONCE_SENTINEL).join(nonce);
  if (out.indexOf(NONCE_SENTINEL) !== -1) {
    throw new Error('csp nonce placeholder survived into the response');
  }
  if (out.split(nonce).length - 1 < placeholders) {
    throw new Error('csp nonce placeholder was not substituted');
  }
  return out;
}

/* Cached when possible, correct always. */
function renderPage(route, appState) {
  const nonce = appState.cspNonce;
  if (!nonce) {
    // Without a nonce there is nothing to substitute, so do not cache.
    return stripEvents(getRouter().toString(route, appState));
  }

  const key = cacheKey(route, appState);
  const hit = cache.get(key);
  if (hit !== undefined) {
    return substituteNonce(hit, nonce);
  }

  const scratch = Object.assign({}, appState, { cspNonce: NONCE_SENTINEL });
  const html = stripEvents(getRouter().toString(route, scratch));

  if (html.indexOf(NONCE_SENTINEL) === -1) {
    // The document carries no nonce, so it is already safe to cache and reuse.
    cacheSet(key, html);
    return html;
  }

  cacheSet(key, html);
  return substituteNonce(html, nonce);
}

function send(res, route, appState) {
  let html;
  try {
    html = renderPage(route, appState);
  } catch (e) {
    html = stripEvents(getRouter().toString(route, appState));
  }
  res.send(html);
}

module.exports = {
  index: async function(req, res) {
    send(res, '/blank', await state(req));
  },

  blank: async function(req, res) {
    send(res, '/blank', await state(req));
  },

  download: async function(req, res, next) {
    const id = req.params.id;
    const appState = await state(req);
    try {
      const { nonce, pwd } = await storage.metadata(id);
      res.set('WWW-Authenticate', `send-v1 ${nonce}`);
      send(
        res,
        `/download/${id}`,
        Object.assign(appState, { downloadMetadata: { nonce, pwd } })
      );
    } catch (e) {
      next();
    }
  },

  unsupported: async function(req, res) {
    send(res, `/unsupported/${req.params.reason}`, await state(req));
  },

  notfound: async function(req, res) {
    const appState = await state(req);
    const withMeta = Object.assign(appState, {
      downloadMetadata: { status: 404 }
    });
    let html;
    try {
      html = renderPage('/404', withMeta);
    } catch (e) {
      html = stripEvents(getRouter().toString('/404', withMeta));
    }
    res.status(404).send(html);
  },

  /* Used by the verification scripts, not by the routes. */
  _internals: {
    cache,
    NONCE_SENTINEL,
    getRouter,
    renderPage,
    cacheKey,
    reset() {
      cache.clear();
      router = null;
    }
  }
};
