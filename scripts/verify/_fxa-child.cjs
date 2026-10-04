#!/usr/bin/env node
/*
 * Child process for fxa-required.mjs. Boots the real app and performs one
 * unauthenticated upload, reporting the outcome on a single RESULT line.
 *
 * Must stay a separate process: server/config.js resolves the environment once
 * at require time, so FXA_REQUIRED cannot be varied inside one interpreter.
 */

process.env.LOG_LEVEL = 'error';

const http = require('http');
const { createApp } = require('../../server/app');

function finish(payload) {
  process.stdout.write(`RESULT ${JSON.stringify(payload)}\n`);
  process.exit(0);
}

async function main() {
  const config = require('../../server/config');
  const { server } = createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  // Plain unauthenticated POST: exactly what an anonymous client can send.
  const status = await new Promise(resolve => {
    const body = JSON.stringify({ owner_token: 'x' });
    const req = http.request(
      `${origin}/api/upload`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-File-Metadata': 'AAAA',
          Authorization: 'send-v1 AAAA'
        }
      },
      res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }
    );
    req.on('error', () => resolve(0));
    req.end(body);
  });

  finish({ configValue: config.fxa_required, status });
}

main().catch(err => {
  finish({ configValue: undefined, status: 0, error: String(err) });
});