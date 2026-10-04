const express = require('express');
const compression = require('compression');
const path = require('path');
const Sentry = require('@sentry/node');
const config = require('./config');
const routes = require('./routes');
const pages = require('./routes/pages');
const expressWs = require('./ws');

let sentryInitialised = false;

/*
 * Compressible responses only. /api/download serves application/octet-stream,
 * which is already-compressed ciphertext, so it must never be re-encoded.
 */
function shouldCompress(req, res) {
  const type = res.getHeader('Content-Type');
  if (
    typeof type === 'string' &&
    type.indexOf('application/octet-stream') === 0
  ) {
    return false;
  }
  return compression.filter(req, res);
}

/*
 * Only content-addressed filenames may be cached immutably. The build also
 * copies a few unhashed files (inter.css), and pinning those for a year meant
 * a deploy could never reach a browser that already had them.
 */
function setStaticCacheHeaders(res, filePath) {
  const base = path.basename(filePath);
  const isHashed = /\.[0-9a-f]{8}\./i.test(base);
  if (isHashed && base !== 'serviceWorker.js') {
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
  }
  res.removeHeader('Pragma');
}

/*
 * Assembles the production application. Kept separate from server/bin/prod.js
 * so the end-to-end tests can boot the exact same stack on an ephemeral port
 * instead of a hand-rolled copy that could drift.
 *
 * Returns the http server because the WebSocket upgrade handler hangs off it.
 */
function createApp() {
  if (config.sentry_dsn && !sentryInitialised) {
    Sentry.init({ dsn: config.sentry_dsn });
    sentryInitialised = true;
  }

  const app = express();
  const { server } = expressWs(app, { perMessageDeflate: false });

  // Registered before the routes so it wraps both rendered pages and the
  // static asset handler.
  app.use(compression({ filter: shouldCompress, threshold: 1024 }));

  routes(app);
  app.ws('/api/ws', require('./routes/ws'));

  app.use(
    express.static(path.resolve(__dirname, '../dist/'), {
      setHeaders: setStaticCacheHeaders
    })
  );

  app.use(pages.notfound);

  return { app, server };
}

module.exports = { createApp, shouldCompress, setStaticCacheHeaders };
