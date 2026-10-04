#!/usr/bin/env node
/*
 * G6: no request writes to stdout.
 *
 * The bug: routes/index.js logged the computed CSP connect-src inside the
 * directive function helmet calls on every single request, so every response in
 * production wrote a synchronous line to stdout. routes/limiter.js did the same
 * on every rejected upload.
 *
 * Counting: stdout writes are captured only while requests are in flight, so
 * startup and shutdown logging cannot mask a request-path write.
 *
 * The control: the same detector is pointed at a request that is known to log,
 * and must observe the write. Without that, "zero writes" could just mean a
 * broken counter.
 */

process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'error';

import { assert, measured, ok, require, shutdown } from './lib.mjs';

const realWrite = process.stdout.write.bind(process.stdout);
let capturing = false;
let captured = [];

process.stdout.write = (chunk, ...rest) => {
  if (capturing) {
    captured.push(String(chunk));
  }
  return realWrite(chunk, ...rest);
};

function captureDuring(fn) {
  captured = [];
  capturing = true;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      capturing = false;
      return new Promise(resolve => setTimeout(resolve, 150));
    });
}

async function get(origin, path, headers = {}) {
  const res = await fetch(origin + path, { headers });
  await res.text();
  return res;
}

async function main() {
  const { server } = require('../../server/app').createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  await get(origin, '/');

  /* Positive control first: prove the detector can see a stdout write at all.
   * Every absence check below is worthless unless this holds. */
  await captureDuring(async () => {
    process.stdout.write('CONTROL-MARKER\n');
  });
  measured('control writes captured', captured.length);
  assert.equal(
    captured.length,
    1,
    'the stdout detector failed its own control, so a zero count below would ' +
      'prove nothing'
  );
  assert.ok(
    captured[0].includes('CONTROL-MARKER'),
    'the detector captured the wrong output'
  );

  await captureDuring(async () => {
    await get(origin, '/');
    await get(origin, '/');
    await get(origin, '/config');
    await get(origin, '/definitely-not-a-route');
    await get(origin, '/api/exists/abcdef1234567890');
  });

  const noise = captured.filter(line => {
    try {
      JSON.parse(line);
      return false;
    } catch (e) {
      return true;
    }
  });
  measured('stdout writes while serving 5 requests', captured.length);
  measured('non-JSON stdout writes', noise.length);
  for (const line of noise.slice(0, 3)) {
    process.stderr.write(`    unexpected: ${line.slice(0, 120)}\n`);
  }

  assert.equal(
    captured.length,
    0,
    `serving requests wrote ${captured.length} lines to stdout`
  );

  /* A rejected upload is the other place that used to log. */
  const Limiter = require('../../server/limiter');
  const limiter = new Limiter(4);
  const failed = new Promise(resolve => limiter.on('error', resolve));
  limiter.write(Buffer.alloc(64));
  const err = await failed;
  measured('control limiter error message', err.message);
  assert.equal(err.message, 'limit');
  assert.equal(
    captured.length,
    0,
    'the rejected upload must be answered without writing to stdout either'
  );

  await shutdown(server);
  ok('NO REQUEST STDOUT VERIFIED');
}

main().catch(err => {
  capturing = false;
  process.stderr.write(`  ${(err && err.stack) || err}\n`);
  process.exit(1);
});
