#!/usr/bin/env node
/*
 * G11: repeated page renders cost no additional choo serialisation.
 *
 * The work: pages.js used to call routes() (building a fresh choo router) and
 * then toString() (serialising the whole DOM) on every single request. Both are
 * now memoised, keyed on everything except the per-request CSP nonce.
 *
 * This counts choo serialisations directly by wrapping the router's toString,
 * so it measures the work rather than inferring it from a timing.
 *
 * The control: the first render of a key must be counted. If nothing were ever
 * counted, "the second render costs nothing" would be trivially true.
 */

process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'error';

import { assert, measured, ok, require, shutdown } from './lib.mjs';

function makeState(nonce, locale = 'en-US') {
  return {
    archive: { numFiles: 0 },
    locale,
    capabilities: { account: false },
    translate: id => id,
    title: 'verify',
    description: 'verify',
    baseUrl: 'http://127.0.0.1',
    ui: {
      colors: { primary: '#000000', accent: '#111111' },
      assets: { custom_css: '' }
    },
    storage: { files: [] },
    fileInfo: {},
    cspNonce: nonce,
    user: { avatar: '', loggedIn: false },
    robots: 'all',
    authConfig: null,
    prefs: {},
    layout: require('../../server/layout')
  };
}

async function main() {
  const pages = require('../../server/routes/pages');
  const internals = pages._internals;
  internals.reset();

  const router = internals.getRouter();
  const originalToString = router.toString.bind(router);
  let serialisations = 0;
  router.toString = function counted(...args) {
    serialisations++;
    return originalToString(...args);
  };

  /* First render of a key must be counted. */
  serialisations = 0;
  const first = internals.renderPage('/blank', makeState('nonce-a'));
  measured('serialisations for the first render', serialisations);
  assert.equal(
    serialisations,
    1,
    'the first render must serialise exactly once'
  );
  assert.ok(first.includes('nonce-a'), 'the first render must carry its nonce');

  /* Further renders under the same key must not serialise again. */
  for (let i = 0; i < 25; i++) {
    internals.renderPage('/blank', makeState(`nonce-${i}`));
  }
  measured('serialisations after 25 further renders', serialisations);
  assert.equal(
    serialisations,
    1,
    `25 further renders triggered ${serialisations - 1} extra serialisations`
  );

  /* Each response must still carry its own nonce. */
  let mismatch = null;
  for (let i = 0; i < 25; i++) {
    const nonce = `nonce-${i}`;
    const html = internals.renderPage('/blank', makeState(nonce));
    if (!html.includes(nonce)) {
      mismatch = nonce;
      break;
    }
  }
  assert.equal(
    mismatch,
    null,
    `render for ${mismatch} did not carry its own nonce`
  );
  measured('nonce isolation across 25 cached renders', 'ok');

  /* A different key must serialise again: caching must not be a blanket skip. */
  serialisations = 0;
  internals.renderPage('/blank', makeState('nonce-a', 'de'));
  measured('serialisations for a new locale', serialisations);
  assert.equal(
    serialisations,
    1,
    'a different locale is a different document and must be rendered'
  );

  const entries = internals.cache.size;
  measured('cache entries after all renders', entries);
  assert.ok(
    entries >= 2,
    `expected distinct documents per key, cache holds ${entries}`
  );

  await shutdown(null);
  ok('RENDER MEMOISATION VERIFIED');
}

main().catch(err => {
  process.stderr.write(`  ${(err && err.stack) || err}\n`);
  process.exit(1);
});
