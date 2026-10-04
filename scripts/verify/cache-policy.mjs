#!/usr/bin/env node
/*
 * G9: content-hashed assets are immutable, unhashed assets are not.
 *
 * The bug: the static handler set `max-age=31536000, immutable` for every
 * file in dist, including unhashed ones. The build copies public/* verbatim,
 * so inter.css is served under a stable name with a one-year immutable cache.
 * A deploy could never reach a browser that already had it.
 *
 * Both directions are checked, because a handler that set no cache header at
 * all would satisfy a one-sided check.
 */

process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'error';

import fs from 'node:fs';
import path from 'node:path';
import { assert, measured, ok, require, shutdown } from './lib.mjs';

const HASHED = /\.[0-9a-f]{8}\./i;

async function headersFor(origin, url) {
  const res = await fetch(origin + url);
  await res.arrayBuffer();
  return res.headers;
}

async function main() {
  const distDir = path.join(process.cwd(), 'dist');
  const manifest = JSON.parse(
    fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8')
  );

  const { server } = require('../../server/app').createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  /* Hashed asset: must be pinned. */
  const hashed = Object.keys(manifest).find(k => HASHED.test(manifest[k]));
  assert.ok(hashed, 'the manifest contains no content-hashed asset to test');
  const hashedHeaders = await headersFor(origin, '/' + manifest[hashed]);
  const hashedCC = hashedHeaders.get('cache-control') || '';
  measured(`hashed ${manifest[hashed]}`, hashedCC);
  assert.ok(
    hashedCC.includes('immutable'),
    `a content-hashed asset must be immutable, got "${hashedCC}"`
  );
  assert.ok(
    hashedCC.includes('max-age=31536000'),
    `a content-hashed asset must be cached for a year, got "${hashedCC}"`
  );

  /* Unhashed asset: must revalidate. */
  const unhashed = Object.keys(manifest).find(k => !HASHED.test(manifest[k]));
  assert.ok(
    unhashed,
    'the manifest contains no unhashed asset to test; add one or this gate ' +
      'cannot prove the unhashed branch'
  );
  const unhashedHeaders = await headersFor(origin, '/' + manifest[unhashed]);
  const unhashedCC = unhashedHeaders.get('cache-control') || '';
  measured(`unhashed ${manifest[unhashed]}`, unhashedCC);
  assert.ok(
    !unhashedCC.includes('immutable'),
    `an unhashed asset must not be immutable, got "${unhashedCC}"`
  );
  assert.ok(
    unhashedCC.includes('must-revalidate') || unhashedCC.includes('max-age=0'),
    `an unhashed asset must revalidate, got "${unhashedCC}"`
  );

  /* The service worker is deliberately excluded from the year-long pin so it
   * can pick up a new build. */
  const swHeaders = await headersFor(origin, '/serviceWorker.js');
  const swCC = swHeaders.get('cache-control') || '';
  measured('serviceWorker.js', swCC);
  assert.ok(
    !swCC.includes('immutable'),
    `serviceWorker.js must not be pinned immutably, got "${swCC}"`
  );

  await shutdown(server);
  ok('CACHE POLICY VERIFIED');
}

main().catch(err => {
  process.stderr.write(`  ${(err && err.stack) || err}\n`);
  process.exit(1);
});
