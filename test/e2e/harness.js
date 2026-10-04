/*
 * End-to-end harness for the core transfer path.
 *
 * Everything exercised here is the real code: the real client crypto
 * (app/ece.js, app/keychain.js, app/zip.js), the real WebSocket upload route
 * and the real HTTP download route, assembled by server/app.js. Nothing is
 * stubbed, so a byte-level mismatch means the transfer path genuinely broke.
 *
 * A real Redis is required, not redis-mock. redis-mock silently never calls
 * back for `hset` with an object or for `multi`/`pipeline`, so a suite built on
 * it would report storage behaviour the production server does not have.
 *
 * Redis is resolved in this order:
 *   1. REDIS_HOST/REDIS_PORT from the environment, used in CI and on the
 *      verification host where a server is already running
 *   2. a redis-server binary found on PATH, started by this harness on a free
 *      port with a throwaway directory, stopped again during teardown
 *   3. otherwise the suite fails with instructions
 *
 * Step 2 is what keeps `npm test` working on a developer machine that has no
 * Redis installed and no configuration.
 *
 * The app modules are ES modules with extensionless imports, so they are
 * transpiled on require rather than pulled from a webpack bundle.
 */

process.env.NODE_ENV = process.env.NODE_ENV || 'production';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'error';

let spawnedRedis = null;

function findRedisServer() {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) {
      continue;
    }
    const candidate = path.join(dir, 'redis-server');
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (e) {
      // keep looking
    }
  }
  return null;
}

function freePort() {
  const net = require('net');
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function waitForRedis(port) {
  const net = require('net');
  return new Promise(resolve => {
    let attempts = 0;
    const tryConnect = () => {
      const sock = net.connect(port, '127.0.0.1');
      sock.on('connect', () => {
        sock.destroy();
        resolve(true);
      });
      sock.on('error', () => {
        sock.destroy();
        if (++attempts > 60) {
          resolve(false);
        } else {
          setTimeout(tryConnect, 100);
        }
      });
    };
    tryConnect();
  });
}

/* Must run before the storage singleton is first required. */
async function ensureRedis() {
  if (process.env.REDIS_HOST && process.env.REDIS_PORT) {
    return;
  }
  const binary = findRedisServer();
  if (!binary) {
    throw new Error(
      'the end-to-end suite needs Redis. Install redis-server, or point ' +
        'REDIS_HOST and REDIS_PORT at a running instance. redis-mock is not ' +
        'used because it does not implement the storage commands this suite ' +
        'exercises.'
    );
  }
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'send-e2e-redis-'));
  spawnedRedis = {
    proc: require('child_process').spawn(
      binary,
      [
        '--port',
        String(port),
        '--bind',
        '127.0.0.1',
        '--dir',
        dir,
        '--save',
        '',
        '--appendonly',
        'no'
      ],
      { stdio: 'ignore' }
    ),
    dir
  };
  const ready = await waitForRedis(port);
  if (!ready) {
    throw new Error(
      `started ${binary} on port ${port} but it never accepted connections`
    );
  }
  process.env.REDIS_HOST = '127.0.0.1';
  process.env.REDIS_PORT = String(port);
}

require('@babel/register')({
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  plugins: [['@babel/plugin-proposal-class-properties', { loose: false }]],
  only: [
    // app/ and common/ are ES modules with extensionless imports.
    filename => /[\\/](app|common)[\\/]/.test(filename),
    // crc@3 is pure ESM using extensionless internal imports. Webpack resolves
    // those fine; Node's ESM resolver does not, so transpile it too.
    filename => /[\\/]node_modules[\\/]crc[\\/]/.test(filename)
  ]
});

// app/streams.js reads Blob slices with FileReader, which Node does not expose.
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

const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const ownsFileDir = !process.env.FILE_DIR;
const fileDir =
  process.env.FILE_DIR ||
  (process.env.FILE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'send-e2e-')));

const Keychain = require('../../app/keychain').default;
const Archive = require('../../app/archive').default;
const Zip = require('../../app/zip').default;
const { arrayToB64, b64ToArray } = require('../../app/utils');

let server = null;
let origin = null;

async function startServer() {
  // Redis first: server/config.js reads the environment when it is required,
  // so it has to be resolved before anything touches the storage singleton.
  await ensureRedis();

  const storage = require('../../server/storage');
  try {
    await storage.ping();
  } catch (err) {
    throw new Error(
      `the end-to-end suite could not reach Redis at ` +
        `${process.env.REDIS_HOST}:${process.env.REDIS_PORT} (${err.message})`
    );
  }

  const { createApp } = require('../../server/app');
  const created = createApp();
  server = created.server;
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      origin = `http://127.0.0.1:${server.address().port}`;
      resolve(origin);
    });
  });
}

async function stopServer() {
  if (ownsFileDir) {
    try {
      fs.rmSync(fileDir, { recursive: true, force: true });
    } catch (e) {
      // best effort
    }
  }

  // The storage singleton keeps a Redis client open, and an open client keeps
  // the event loop alive, so the test process would never exit on its own.
  try {
    const storage = require('../../server/storage');
    if (storage && storage.redis && typeof storage.redis.quit === 'function') {
      await new Promise(resolve => {
        const done = () => resolve();
        storage.redis.once('end', done);
        storage.redis.quit(() => resolve());
        setTimeout(done, 2000);
      });
    }
  } catch (e) {
    // best effort
  }

  if (spawnedRedis) {
    try {
      spawnedRedis.proc.kill();
    } catch (e) {
      // best effort
    }
    try {
      fs.rmSync(spawnedRedis.dir, { recursive: true, force: true });
    } catch (e) {
      // best effort
    }
    spawnedRedis = null;
  }

  if (!server) {
    return;
  }
  return new Promise(resolve => {
    server.closeAllConnections();
    server.close(() => {
      server = null;
      resolve();
    });
  });
}

function randomBytes(size) {
  return crypto.randomBytes(size);
}

function bufferToStream(buf, chunkSize = 64 * 1024) {
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < buf.length; i += chunkSize) {
        controller.enqueue(new Uint8Array(buf.subarray(i, i + chunkSize)));
      }
      controller.close();
    }
  });
}

async function streamToBuffer(stream) {
  const reader = stream.getReader();
  const parts = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    parts.push(Buffer.from(value));
    length += value.length;
  }
  return Buffer.concat(parts, length);
}

function once(emitter, event) {
  return new Promise((resolve, reject) => {
    const onEvent = (...args) => {
      emitter.removeListener(event, onEvent);
      resolve(args.length > 1 ? args : args[0]);
    };
    const onError = err => {
      emitter.removeListener(event, onEvent);
      reject(err);
    };
    if (event !== 'error') {
      emitter.once('error', onError);
    }
    emitter.once(event, onEvent);
  });
}

function listenForResponse(ws) {
  return new Promise((resolve, reject) => {
    const onClose = () => {
      ws.removeListener('message', onMessage);
      reject(new Error('socket closed before a response arrived'));
    };
    const onMessage = data => {
      ws.removeListener('close', onClose);
      const parsed = JSON.parse(data.toString());
      if (parsed.error) {
        reject(new Error(`server error ${parsed.error}`));
      } else {
        resolve(parsed);
      }
    };
    ws.on('close', onClose);
    ws.on('message', onMessage);
  });
}

/* Mirrors upload() in app/api.js. */
async function upload(options) {
  const {
    encrypted,
    metadata,
    authKeyB64,
    timeLimit = 86400,
    dlimit = 1
  } = options;

  const wsUrl = origin.replace(/^http/, 'ws') + '/api/ws';
  const ws = new WebSocket(wsUrl);
  await once(ws, 'open');

  try {
    const infoResponse = listenForResponse(ws);
    ws.send(
      JSON.stringify({
        fileMetadata: metadata,
        authorization: `send-v1 ${authKeyB64}`,
        bearer: options.bearer,
        timeLimit,
        dlimit
      })
    );
    const info = await infoResponse;

    const doneResponse = listenForResponse(ws);
    const reader = encrypted.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (ws.readyState !== WebSocket.OPEN) {
        break;
      }
      ws.send(value);
      while (
        ws.bufferedAmount > 128 * 1024 &&
        ws.readyState === WebSocket.OPEN
      ) {
        await new Promise(r => setTimeout(r, 10));
      }
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(new Uint8Array([0]));
    }
    await doneResponse;
    return info;
  } finally {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }
}

/* Mirrors downloadS()/fetchWithAuthAndRetry() in app/api.js. */
async function downloadStream(id, keychain) {
  const url = `${origin}/api/download/${id}`;
  let response = await fetch(url, {
    headers: { Authorization: await keychain.authHeader() }
  });
  let authHeader = response.headers.get('WWW-Authenticate');
  if (authHeader) {
    keychain.nonce = authHeader.split(' ')[1];
  }
  if (response.status === 401) {
    // The nonce rotates, so retry once with a freshly signed header.
    response = await fetch(url, {
      headers: { Authorization: await keychain.authHeader() }
    });
  }
  return response;
}

/* Full sender-side + receiver-side round trip over the real server. */
async function roundTrip(plaintext, options = {}) {
  const name = options.name || 'roundtrip.bin';
  const type = options.type || 'application/octet-stream';

  const sender = new Keychain();
  const secretKey = arrayToB64(sender.rawSecret);
  const metadata = await sender.encryptMetadata({
    name,
    size: plaintext.length,
    type
  });
  const authKeyB64 = await sender.authKeyB64();

  const info = await upload({
    encrypted: sender.encryptStream(bufferToStream(plaintext)),
    metadata: arrayToB64(new Uint8Array(metadata)),
    authKeyB64,
    timeLimit: options.timeLimit || 86400,
    dlimit: options.dlimit || 1,
    password: options.password
  });

  const receiver = new Keychain(secretKey);
  if (options.password) {
    receiver.setPassword(options.password, info.url);
  }
  const response = await downloadStream(info.id, receiver);
  if (response.status !== 200) {
    throw new Error(`download failed with status ${response.status}`);
  }
  const ciphertext = await streamToBuffer(response.body);

  return {
    id: info.id,
    ownerToken: info.ownerToken,
    url: info.url,
    receiver,
    secretKey,
    ciphertext,
    plaintext: await streamToBuffer(
      receiver.decryptStream(bufferToStream(ciphertext))
    )
  };
}

module.exports = {
  Archive,
  Keychain,
  WebSocket,
  Zip,
  arrayToB64,
  b64ToArray,
  bufferToStream,
  downloadStream,
  origin: () => origin,
  randomBytes,
  roundTrip,
  startServer,
  stopServer,
  streamToBuffer,
  upload
};
