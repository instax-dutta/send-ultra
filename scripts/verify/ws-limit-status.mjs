#!/usr/bin/env node
/*
 * G4: an oversized websocket upload is answered 413, not 500.
 *
 * The bug: ws.js compared the caught error to the string 'limit'
 * (`e === 'limit'`), but the limiter rejects with `new Error('limit')`, so the
 * comparison was always false and an over-limit upload reported 500.
 *
 * The control matters: a route that always answered 413, or always answered
 * 500, would satisfy a one-sided check. So this drives two uploads over the
 * real socket, one inside the limit and one past it, and requires different and
 * correct answers.
 *
 * No client crypto is needed: the route only checks that the metadata and
 * authorization headers are present, so the payload is opaque bytes.
 */

process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'error';
process.env.MAX_FILE_SIZE = '4096';

import { assert, measured, ok, require, shutdown } from './lib.mjs';

const WebSocket = require('ws');

function nextMessage(ws) {
  return new Promise((resolve, reject) => {
    const onMessage = data => {
      cleanup();
      try {
        resolve(JSON.parse(data.toString()));
      } catch (e) {
        reject(e);
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error('socket closed before responding'));
    };
    function cleanup() {
      ws.removeListener('message', onMessage);
      ws.removeListener('close', onClose);
    }
    ws.on('message', onMessage);
    ws.on('close', onClose);
  });
}

async function uploadBytes(origin, byteCount) {
  const ws = new WebSocket(origin.replace(/^http/, 'ws') + '/api/ws');
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  const infoPromise = nextMessage(ws);
  ws.send(
    JSON.stringify({
      fileMetadata: 'AAAA',
      authorization: 'send-v1 AAAA',
      timeLimit: 3600,
      dlimit: 1
    })
  );
  const info = await infoPromise;
  assert.ok(info.id, 'the route must allocate an id before streaming');

  const verdictPromise = nextMessage(ws);
  ws.send(Buffer.alloc(byteCount, 0x41));
  ws.send(new Uint8Array([0]));
  const verdict = await verdictPromise.catch(e => ({
    error: `no-response: ${e.message}`
  }));
  if (ws.readyState === WebSocket.OPEN) {
    ws.close();
  }
  return verdict;
}

async function main() {
  const { server } = require('../../server/app').createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const under = await uploadBytes(origin, 512);
  measured('512 byte upload  -> server replied', JSON.stringify(under));
  assert.equal(
    under.ok,
    true,
    'an upload inside the limit must be accepted, got ' + JSON.stringify(under)
  );

  // MAX_FILE_SIZE is 4096, so 256KiB is far past the cap.
  const over = await uploadBytes(origin, 256 * 1024);
  measured('256KiB upload    -> server replied', JSON.stringify(over));
  assert.equal(
    over.error,
    413,
    'an over-limit upload must report 413, got ' + JSON.stringify(over)
  );

  server.closeAllConnections();
  await shutdown(server);
  ok('WS LIMIT STATUS VERIFIED');
}

main().catch(err => {
  process.stderr.write(`  ${(err && err.stack) || err}\n`);
  process.exit(1);
});
