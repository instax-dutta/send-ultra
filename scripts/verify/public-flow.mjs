#!/usr/bin/env node
/*
 * Proves the deployed instance works as a user would use it, over the public
 * internet, using the real client crypto. Nothing is stubbed and nothing runs
 * in-process: it speaks the same protocol the browser does.
 *
 *   1. encrypt a file with app/keychain.js
 *   2. upload it over the websocket route
 *   3. open the returned download link and read the nonce out of the page
 *   4. download and decrypt it
 *   5. compare against the original bytes
 *
 * Usage: node scripts/verify/public-flow.mjs <origin>
 */

import { createRequire } from 'node:module';
import { measured, registerAppModules, require as req } from './lib.mjs';

const origin = process.argv[2];
if (!origin) {
  process.stderr.write('usage: public-flow.mjs <origin>\n');
  process.exit(2);
}

registerAppModules();

const WebSocket = req('ws');
const Keychain = req('../../app/keychain').default;
const { arrayToB64 } = req('../../app/utils');
const crypto = req('crypto');

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

function bufferToStream(buf) {
  return new ReadableStream({
    start(c) {
      for (let i = 0; i < buf.length; i += 65536) {
        c.enqueue(new Uint8Array(buf.subarray(i, i + 65536)));
      }
      c.close();
    }
  });
}

async function streamToBuffer(stream) {
  const r = stream.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) {
      break;
    }
    parts.push(Buffer.from(value));
    n += value.length;
  }
  return Buffer.concat(parts, n);
}

function fail(msg) {
  process.stderr.write(`  ${msg}\n`);
  process.exit(1);
}

const original = crypto.randomBytes(300 * 1024); // spans several ECE records
const sender = new Keychain();
const metadata = await sender.encryptMetadata({
  name: 'deployed-check.bin',
  size: original.length,
  type: 'application/octet-stream'
});

const ws = new WebSocket(origin.replace(/^http/, 'ws') + '/api/ws');
await new Promise((resolve, reject) => {
  ws.once('open', resolve);
  ws.once('error', reject);
});
measured('websocket connected to', origin.replace(/^http/, 'ws') + '/api/ws');

const infoPromise = nextMessage(ws);
ws.send(
  JSON.stringify({
    fileMetadata: arrayToB64(new Uint8Array(metadata)),
    authorization: `send-v1 ${await sender.authKeyB64()}`,
    timeLimit: 3600,
    dlimit: 3
  })
);
const info = await infoPromise;
measured('upload accepted, id', info.id);

const encrypted = await streamToBuffer(
  sender.encryptStream(bufferToStream(original))
);
measured('plaintext bytes', original.length);
measured('ciphertext bytes', encrypted.length);

const donePromise = nextMessage(ws);
for (let i = 0; i < encrypted.length; i += 65536) {
  ws.send(encrypted.subarray(i, i + 65536));
}
ws.send(new Uint8Array([0]));
const done = await donePromise;
if (done.ok !== true) {
  fail('upload did not complete: ' + JSON.stringify(done));
}
measured('upload completed', 'ok');

/* Open the download link exactly as a browser would and take the nonce from
 * the rendered page. */
const link = new URL(info.url);
const page = await fetch(link.toString());
if (page.status !== 200) {
  fail(`download page returned ${page.status}`);
}
const html = await page.text();
const nonceMatch =
  html.match(/downloadMetadata\s*=\s*(\{[^<]*\})/) ||
  html.match(/"nonce"\s*:\s*"([^"]+)"/);
measured('download page status', page.status);
if (!nonceMatch) {
  fail('could not find download metadata in the rendered page');
}
const pageNonce = JSON.parse(
  nonceMatch[1].startsWith('{') ? nonceMatch[1] : `{"nonce":"${nonceMatch[1]}"}`
).nonce;
measured('nonce read from the page', pageNonce ? 'present' : 'missing');

/* A receiver that knows only the secret from the link fragment and the nonce
 * from the page, which is the whole zero-knowledge design: the server never
 * sees the secret. Constructing the Keychain with both matters, because it
 * derives its keys from the secret at construction time. */
const secret = arrayToB64(sender.rawSecret);
const receiver = new Keychain(secret, pageNonce);
const header = await receiver.authHeader();
const response = await fetch(info.url.replace('/download/', '/api/download/'), {
  headers: { Authorization: header }
});
measured('api download status', response.status);
if (response.status !== 200) {
  fail(`download returned ${response.status}`);
}
const ciphertext = await response.arrayBuffer();
const decrypted = await streamToBuffer(
  receiver.decryptStream(bufferToStream(Buffer.from(ciphertext)))
);
measured('decrypted bytes', decrypted.length);

if (decrypted.length !== original.length) {
  fail(`length mismatch: ${decrypted.length} vs ${original.length}`);
}
if (!decrypted.equals(original)) {
  fail('DECRYPTED BYTES DIFFER FROM THE ORIGINAL');
}
if (ws.readyState === WebSocket.OPEN) {
  ws.close();
}
measured('round trip', 'byte for byte identical');
process.stdout.write('PUBLIC USER FLOW VERIFIED\n');
