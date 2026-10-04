#!/usr/bin/env node
/*
 * G12: page render CPU per request stays inside a measured budget.
 *
 * The budget is not copied from a benchmark. This script measures the uncached
 * render (the cost the process pays when a document is new) and the cached
 * render (the cost for every repeat request), then requires the cached path to
 * be a large multiple cheaper. Both numbers are produced here.
 *
 * The bar exists because a cache that is only marginally faster is not worth its
 * correctness risk, so the gate demands a real multiple rather than "some".
 */

process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'error';

import { performance } from 'node:perf_hooks';
import { assert, measured, ok, require, shutdown } from './lib.mjs';

const REQUIRED_SPEEDUP = 5;

function makeState(nonce) {
  return {
    archive: { numFiles: 0 },
    locale: 'en-US',
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

function timeIt(label, iterations, body) {
  for (let i = 0; i < 5; i++) {
    body(i);
  }
  const started = performance.now();
  for (let i = 0; i < iterations; i++) {
    body(i);
  }
  const perOp = (performance.now() - started) / iterations;
  measured(label, `${perOp.toFixed(4)} ms`);
  return perOp;
}

async function main() {
  const internals = require('../../server/routes/pages')._internals;
  internals.reset();

  const UNIQUE = 200;
  const uncached = timeIt(
    'uncached render (new document each time)',
    UNIQUE,
    i => internals.renderPage(`/blank#${i}`, makeState(`n${i}`))
  );

  // The cached path: one key, many nonces.
  internals.reset();
  internals.renderPage('/blank', makeState('warm'));
  const CACHED = 2000;
  const cached = timeIt('cached render (repeat document)', CACHED, i =>
    internals.renderPage('/blank', makeState(`n${i}`))
  );

  const speedup = uncached / cached;
  measured('speedup on the repeat path', `${speedup.toFixed(1)}x`);

  assert.ok(
    uncached > cached,
    `a cache hit (${cached.toFixed(
      4
    )} ms) must be cheaper than a fresh render ` + `(${uncached.toFixed(4)} ms)`
  );
  assert.ok(
    speedup >= REQUIRED_SPEEDUP,
    `the cached path is only ${speedup.toFixed(1)}x cheaper, which does not ` +
      `justify the caching; ${REQUIRED_SPEEDUP}x is required`
  );

  /* A hard ceiling as well, so a future regression in the cached path is
   * caught even if the uncached path gets slower too. */
  const CEILING_MS = 0.05;
  measured('cached render ceiling', `${CEILING_MS} ms`);
  assert.ok(
    cached <= CEILING_MS,
    `a cached render costs ${cached.toFixed(
      4
    )} ms, over the ${CEILING_MS} ms ceiling`
  );

  await shutdown(null);
  ok('RENDER BUDGET VERIFIED');
}

main().catch(err => {
  process.stderr.write(`  ${(err && err.stack) || err}\n`);
  process.exit(1);
});
