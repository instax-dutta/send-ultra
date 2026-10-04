#!/usr/bin/env node
/*
 * G7: serving a page performs no Redis or storage work.
 *
 * Why this matters: the page routes used to call fs.existsSync per request and
 * build the asset map per request, and any future storage call added to the
 * page path would add a network round trip to the hot path. This pins the
 * property rather than the implementation.
 *
 * The control is essential: "zero calls" is only evidence if the instrument can
 * see calls at all. So the same instrument is pointed at a route that must talk
 * to Redis, and it is required to observe the traffic.
 */

process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'error';

import { assert, measured, ok, require, shutdown } from './lib.mjs';

function instrument(storage) {
  const redisCalls = [];
  const storageCalls = [];

  const redisMethods = [
    'hget',
    'hgetall',
    'hset',
    'hincrby',
    'ttl',
    'del',
    'expire',
    'get',
    'set',
    'mget'
  ];
  const originals = {};
  for (const name of redisMethods) {
    if (typeof storage.redis[name] !== 'function') {
      continue;
    }
    originals[name] = storage.redis[name];
    storage.redis[name] = function counted(...args) {
      redisCalls.push(name);
      return originals[name].apply(this, args);
    };
  }

  const storageApi = [
    'get',
    'length',
    'set',
    'del',
    'metadata',
    'ttl',
    'setField'
  ];
  const storageOriginals = {};
  for (const name of storageApi) {
    if (typeof storage[name] !== 'function') {
      continue;
    }
    storageOriginals[name] = storage[name];
    storage[name] = function counted(...args) {
      storageCalls.push(name);
      return storageOriginals[name].apply(this, args);
    };
  }

  return {
    reset() {
      redisCalls.length = 0;
      storageCalls.length = 0;
    },
    redisCalls,
    storageCalls,
    restore() {
      for (const [name, fn] of Object.entries(originals)) {
        storage.redis[name] = fn;
      }
      for (const [name, fn] of Object.entries(storageOriginals)) {
        storage[name] = fn;
      }
    }
  };
}

async function get(origin, path) {
  const res = await fetch(origin + path);
  await res.text();
  return res;
}

async function main() {
  const { server } = require('../../server/app').createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const storage = require('../../server/storage');
  const probe = instrument(storage);

  // Warm any first-request lazy state before measuring.
  await get(origin, '/');
  probe.reset();

  for (const path of ['/', '/blank', '/config', '/definitely-not-a-route']) {
    await get(origin, path);
  }

  measured(
    'redis commands while serving 4 page requests',
    probe.redisCalls.length
  );
  measured(
    'storage calls while serving 4 page requests',
    probe.storageCalls.length
  );
  assert.equal(
    probe.redisCalls.length,
    0,
    `page requests issued redis commands: ${probe.redisCalls.join(', ')}`
  );
  assert.equal(
    probe.storageCalls.length,
    0,
    `page requests issued storage calls: ${probe.storageCalls.join(', ')}`
  );

  /* Positive control: a route that legitimately needs Redis must be seen. */
  probe.reset();
  const exists = await get(origin, '/api/exists/abcdef1234567890');
  void exists;
  measured(
    'control /api/exists calls observed',
    probe.redisCalls.length + probe.storageCalls.length
  );
  assert.ok(
    probe.redisCalls.length + probe.storageCalls.length > 0,
    'the instrument saw no traffic on a route that must query Redis, so the ' +
      'zero count for page requests is not trustworthy'
  );

  probe.restore();
  await shutdown(server);
  ok('PAGE REQUEST STORAGE-FREE VERIFIED');
}

main().catch(err => {
  process.stderr.write(`  ${(err && err.stack) || err}\n`);
  process.exit(1);
});
