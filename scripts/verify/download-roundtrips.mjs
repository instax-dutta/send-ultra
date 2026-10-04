#!/usr/bin/env node
/*
 * G10: a download resolves its metadata in one Redis command, not two.
 *
 * The waste this removes: auth.hmac already fetched the whole metadata hash,
 * which carries the storage prefix, but download.js threw that away and called
 * storage.length() and storage.get(), each of which re-read the prefix from
 * Redis. A download therefore issued three metadata reads where one suffices.
 *
 * The count is observed, not assumed: the redis client is instrumented and the
 * commands are tallied over a real upload and a real authenticated download.
 * The HGETALL that authentication performs is the baseline of exactly one.
 */

process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'error';

import {
  assert,
  measured,
  ok,
  registerAppModules,
  require,
  shutdown
} from './lib.mjs';

registerAppModules();

const WebSocket = require('ws');

function nextMessage(ws) {
  return new Promise((resolve, reject) => {
    const onMessage = data => {
      cleanup();
      resolve(JSON.parse(data.toString()));
    };
    const onClose = () => {
      cleanup();
      reject(new Error('closed before responding'));
    };
    function cleanup() {
      ws.removeListener('message', onMessage);
      ws.removeListener('close', onClose);
    }
    ws.on('message', onMessage);
    ws.on('close', onClose);
  });
}

function instrumentRedis(storage) {
  const counts = new Map();
  const originals = {};
  /*
   * storage/redis.js attaches promisified helpers (hgetallAsync, hgetAsync,
   * ttlAsync) to the client, and those are what the routes actually call. They
   * captured the original command functions at attach time, so wrapping only the
   * base names would observe nothing. Both forms are instrumented.
   */
  for (const base of [
    'hget',
    'hgetall',
    'ttl',
    'hlen',
    'exists',
    'hincrby',
    'del'
  ]) {
    for (const name of [base, `${base}Async`]) {
      if (typeof storage.redis[name] !== 'function') {
        continue;
      }
      originals[name] = storage.redis[name];
      storage.redis[name] = function counted(...args) {
        counts.set(base, (counts.get(base) || 0) + 1);
        return originals[name].apply(this, args);
      };
    }
  }
  return {
    counts,
    reset: () => counts.clear(),
    total: () => [...counts.values()].reduce((a, b) => a + b, 0),
    describe: () =>
      [...counts.entries()].map(([k, v]) => `${k}=${v}`).join(' ') || 'none',
    restore: () => {
      for (const [name, fn] of Object.entries(originals)) {
        storage.redis[name] = fn;
      }
    }
  };
}

async function main() {
  const Keychain = require('../../app/keychain').default;
  const { arrayToB64 } = require('../../app/utils');
  const storage = require('../../server/storage');
  const { server } = require('../../server/app').createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  // Upload a real encrypted payload through the real websocket route.
  const sender = new Keychain();
  const metadata = await sender.encryptMetadata({
    name: 'rt.bin',
    size: 32,
    type: 'application/octet-stream'
  });
  const ws = new WebSocket(origin.replace(/^http/, 'ws') + '/api/ws');
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  const infoPromise = nextMessage(ws);
  ws.send(
    JSON.stringify({
      fileMetadata: arrayToB64(new Uint8Array(metadata)),
      authorization: `send-v1 ${await sender.authKeyB64()}`,
      timeLimit: 3600,
      dlimit: 5
    })
  );
  const info = await infoPromise;
  const donePromise = nextMessage(ws);
  ws.send(Buffer.alloc(64, 0x42));
  ws.send(new Uint8Array([0]));
  await donePromise;
  if (ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  measured('uploaded id', info.id);

  const probe = instrumentRedis(storage);

  // A fresh receiver, exactly like a browser opening the link: it must learn
  // the current nonce from the first response before it can authenticate.
  const receiver = new Keychain(arrayToB64(sender.rawSecret));

  /* Warm-up request. It is expected to fail authentication, and it performs its
   * own metadata read, so it is counted separately rather than folded into the
   * measurement of the real download. */
  const warm = await fetch(`${origin}/api/download/${info.id}`, {
    headers: { Authorization: await receiver.authHeader() }
  });
  await warm.arrayBuffer();
  const warmHeader = warm.headers.get('WWW-Authenticate');
  measured('warm-up request status', warm.status);
  if (warmHeader) {
    receiver.nonce = warmHeader.split(' ')[1];
  }

  /* The measured request: one authenticated download. */
  probe.reset();
  const response = await fetch(`${origin}/api/download/${info.id}`, {
    headers: { Authorization: await receiver.authHeader() }
  });
  await response.arrayBuffer();
  measured('download status', response.status);
  assert.equal(
    response.status,
    200,
    'the authenticated download must succeed, got ' + response.status
  );

  measured('redis commands during the download', probe.describe());
  measured('total redis commands', probe.total());

  const hgetall = probe.counts.get('hgetall') || 0;
  const hget = probe.counts.get('hget') || 0;

  /* Only metadata reads are constrained. The hincrby that records the download
   * against the limit is required bookkeeping, not waste. */
  const METADATA_READS = ['hgetall', 'hget', 'hlen', 'exists', 'ttl'];
  const metadataReads = METADATA_READS.reduce(
    (sum, key) => sum + (probe.counts.get(key) || 0),
    0
  );

  assert.equal(
    hgetall,
    1,
    `a download must resolve its metadata with exactly one hash read, saw ${probe.describe()}`
  );
  assert.equal(
    hget,
    0,
    `the download must not re-read the storage prefix from Redis, saw ${hget} hget calls`
  );
  assert.equal(
    metadataReads,
    1,
    `a download must issue exactly one metadata read in total, saw ${probe.describe()}`
  );

  probe.restore();
  await shutdown(server);
  ok('DOWNLOAD ROUNDTRIP COUNT VERIFIED');
}

main().catch(err => {
  process.stderr.write(`  ${(err && err.stack) || err}\n`);
  process.exit(1);
});
