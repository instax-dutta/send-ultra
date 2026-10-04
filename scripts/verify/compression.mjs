#!/usr/bin/env node
/*
 * G8: static assets are served compressed, and compression actually shrinks them.
 *
 * The measurement is taken from the wire, not from a file on disk, and the
 * ratio is computed here rather than asserted from a known figure.
 *
 * Two properties, both needed:
 *   1. a client offering br or gzip receives a Content-Encoding
 *   2. the encoded body is materially smaller than the raw file
 *
 * And one exclusion, because it is the easy way to break the product:
 * /api/download serves already-encrypted octet-stream ciphertext and must never
 * be re-encoded.
 */

process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'error';

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { assert, measured, ok, require, shutdown } from './lib.mjs';

const MIN_RATIO = 1.5; // must be at least 1.5x smaller

/*
 * fetch (undici) transparently decodes Content-Encoding, so a fetch-based
 * measurement would compare decoded bytes against the file and find no
 * difference at all. The body is therefore read with node:http, which does not
 * decode, so the number is the real wire size.
 */
function getRaw(origin, url, acceptEncoding) {
  const target = new URL(url, origin);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path: target.pathname,
        method: 'GET',
        headers: { 'Accept-Encoding': acceptEncoding }
      },
      res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode,
            encoding: res.headers['content-encoding'] || null,
            buf: Buffer.concat(chunks)
          })
        );
      }
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const distDir = path.join(process.cwd(), 'dist');
  const manifestPath = path.join(distDir, 'manifest.json');
  assert.ok(
    fs.existsSync(manifestPath),
    'dist/manifest.json is missing; run the build before this check'
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const appJs = manifest['app.js'];
  assert.ok(appJs, 'manifest.json has no app.js entry');

  const { server } = require('../../server/app').createApp();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  const rawSize = fs.statSync(path.join(distDir, appJs)).size;
  measured('app.js on disk', `${rawSize} bytes`);

  /* Baseline: no Accept-Encoding must come back uncompressed and complete. */
  const plain = await getRaw(origin, '/' + appJs, 'identity');
  measured('identity response', `${plain.buf.length} bytes, encoding=${plain.encoding || 'none'}`);
  assert.equal(plain.status, 200);
  assert.equal(
    plain.buf.length,
    rawSize,
    'an identity request must return the file unchanged'
  );

  for (const [label, encoding] of [
    ['gzip', 'gzip'],
    ['br', 'br, gzip']
  ]) {
    const got = await getRaw(origin, '/' + appJs, encoding);
    const applied = got.encoding;
    measured(
      `${label} response`,
      `${got.buf.length} bytes, encoding=${applied || 'none'}`
    );
    assert.ok(
      applied,
      `${label} was offered but no Content-Encoding came back`
    );
    assert.ok(
      ['gzip', 'br', 'deflate'].includes(applied),
      `${label} produced an unexpected encoding: ${applied}`
    );
    const ratio = plain.buf.length / got.buf.length;
    measured(`${label} ratio vs raw`, `${ratio.toFixed(2)}x smaller`);
    assert.ok(
      ratio >= MIN_RATIO,
      `${label} only reached ${ratio.toFixed(
        2
      )}x, expected at least ${MIN_RATIO}x`
    );
  }

  /* Exclusion: encrypted payloads must not be re-encoded. */
  const { shouldCompress } = require('../../server/app');
  assert.equal(
    shouldCompress({}, { getHeader: () => 'application/octet-stream' }),
    false,
    'octet-stream ciphertext must never be compressed'
  );
  assert.equal(
    shouldCompress({}, { getHeader: () => 'text/html; charset=utf-8' }),
    true,
    'html must be compressible'
  );
  measured('octet-stream excluded / html included', 'ok');

  await shutdown(server);
  ok('COMPRESSION VERIFIED');
}

main().catch(err => {
  process.stderr.write(`  ${(err && err.stack) || err}\n`);
  process.exit(1);
});
