#!/usr/bin/env node
/*
 * Shared helpers for the verification scripts.
 *
 * Each verifier asserts one outcome, prints a success-only marker as its last
 * line, and exits nonzero on any failure. They are run on the remote host by
 * scripts/verify/remote-run.mjs.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

/* The server is CommonJS; this module is ESM. */
const require = createRequire(import.meta.url);

export { assert, require };

let appModulesRegistered = false;

/*
 * Makes the browser modules (app/ece.js, app/keychain.js, app/zip.js) loadable
 * from Node so a verifier can drive the real client crypto rather than a stand
 * in. They are ES modules with extensionless imports, which webpack resolves
 * and Node does not.
 */
export function registerAppModules() {
  if (appModulesRegistered) {
    return;
  }
  const babelRegister = require.resolve('@babel/register');
  require(babelRegister)({
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    plugins: [['@babel/plugin-proposal-class-properties', { loose: false }]],
    only: [
      filename => /[\\/](app|common)[\\/]/.test(filename),
      filename => /[\\/]node_modules[\\/]crc[\\/]/.test(filename)
    ]
  });

  if (typeof globalThis.FileReader === 'undefined') {
    globalThis.FileReader = class FileReader {
      readAsArrayBuffer(blob) {
        blob.arrayBuffer().then(
          buffer => {
            this.result = buffer;
            if (this.onload) {
              this.onload();
            }
          },
          err => this.onerror && this.onerror(err)
        );
      }
    };
  }
  appModulesRegistered = true;
}

export function ok(token) {
  process.stdout.write(`${token}\n`);
}

export function fail(err) {
  process.stderr.write(`  ${(err && err.stack) || err}\n`);
  process.exit(1);
}

export function measured(label, value) {
  process.stdout.write(`  ${label}: ${value}\n`);
}

/* Runs a command, resolving with its exit code and combined output. */
export function exec(cmd, args, opts = {}) {
  return new Promise(resolve => {
    const child = spawn(cmd, args, {
      ...opts,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    const done = code =>
      resolve({
        code: code === null ? 1 : code,
        stdout,
        stderr,
        out: stdout + stderr
      });
    child.on('error', e => done(1));
    child.on('close', done);
  });
}

/* Resolves once the process has listened, returning its origin. */
export function listen(server, host = '127.0.0.1') {
  return new Promise(resolve => {
    server.listen(0, host, () =>
      resolve(`http://${host}:${server.address().port}`)
    );
  });
}

export async function closeServer(server) {
  if (!server) {
    return;
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(() => resolve()));
}

export async function quitRedis(storage) {
  const client = storage && storage.redis;
  if (!client || typeof client.quit !== 'function') {
    return;
  }
  await new Promise(resolve => {
    let settled = false;
    const done = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    client.once('end', done);
    try {
      client.quit(() => done());
    } catch (e) {
      done();
    }
    setTimeout(done, 2000);
  });
}

export function loadApp() {
  const { createApp } = require('../../server/app');
  return createApp();
}

/*
 * Release everything the app holds open.
 *
 * The storage singleton keeps a Redis client alive, and an open client keeps
 * the event loop alive, so a verifier that forgets this never exits and the
 * gate fails on a timeout instead of on its assertions. Verifiers call this
 * before printing their marker.
 */
export async function shutdown(server) {
  await closeServer(server);
  try {
    await quitRedis(require('../../server/storage'));
  } catch (e) {
    // The storage module may never have been loaded.
  }
}
