#!/usr/bin/env node
/*
 * Proves the reaper removes expired ciphertext and, more importantly, that it
 * leaves everything else alone.
 *
 * The second half is the point. storage.set() writes no Redis key until the
 * upload finishes, so an in-flight transfer is on disk with no key at all. A
 * reaper that trusted key absence alone would delete live uploads and look
 * healthy while doing it. These cases pin the guards that prevent it.
 *
 * Usage: node scripts/verify/reaper.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

const failures = [];

function measured(label, value) {
  process.stdout.write(`  ${label}: ${value}\n`);
}

function check(label, ok, detail = '') {
  if (ok) {
    measured(label, 'ok');
  } else {
    failures.push(label + (detail ? ` (${detail})` : ''));
    process.stdout.write(`  ${label}: FAIL${detail ? ` (${detail})` : ''}\n`);
  }
}

const REAPER = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '../reap-expired.mjs'
);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reap-'));

/* Older than max_expire_seconds plus the margin, so it is reapable. */
const OLD = Date.now() - 40 * 24 * 60 * 60 * 1000;

function write(name, mtimeMs) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, 'x'.repeat(1024));
  const when = new Date(mtimeMs);
  fs.utimesSync(p, when, when);
}

const EXPIRED = '7-aaaaaaaaaaaaaaaa'; // old, no key      -> reap
const LIVE = '7-bbbbbbbbbbbbbbbb'; // old, live key    -> keep
const INFLIGHT = '7-cccccccccccccccc'; // fresh, no key    -> keep
const RECENT = '1-dddddddddddddddd'; // fresh, no key    -> keep
const MALFORMED = 'not-a-prefixed-name'; // never considered
const OTHER_LIVE = '7-eeeeeeeeeeeeeeee'; // old, live key    -> keep

for (const [name, when] of [
  [EXPIRED, OLD],
  [LIVE, OLD],
  [INFLIGHT, Date.now()],
  [RECENT, Date.now()],
  [MALFORMED, OLD],
  [OTHER_LIVE, OLD],
]) {
  write(name, when);
}

/*
 * Two live keys, so the "old but still live" cases are genuinely covered.
 *
 * node_redis is callback-based and server/storage/redis.js only promisifies
 * ttl, hgetall, hget and ping, so the remaining calls are promisified here
 * rather than widening the shared client for a test's convenience.
 */
const storage = require('../../server/storage');
const redis = storage.redis;

/*
 * Refuse to run on redis-mock.
 *
 * server/storage/redis.js substitutes an in-process mock whenever redis_host is
 * localhost and NODE_ENV is not production. This gate writes a key in this
 * process and then runs the reaper in a child, so with a mock each side sees a
 * different empty database: the "key is still live" files look orphaned and the
 * reaper correctly, from its own point of view, deletes them. That is how this
 * gate first failed while the reaper was behaving correctly.
 *
 * Running it against a real Redis is the only way the live-key case means
 * anything, so say so plainly rather than reporting a misleading result.
 */
if (!process.env.REDIS_HOST || !process.env.REDIS_PORT) {
  process.stderr.write(
    '  this gate needs a real Redis: run it through remote-run.mjs, or set\n' +
      '  REDIS_HOST and REDIS_PORT yourself.\n'
  );
  process.exit(2);
}
const call = (fn, ...args) =>
  new Promise((resolve, reject) =>
    fn.call(redis, ...args, (err, res) => (err ? reject(err) : resolve(res)))
  );

const live = [LIVE, OTHER_LIVE].map(n => n.replace(/^\d+-/, ''));
for (const id of live) {
  await call(redis.hset, id, 'prefix', '7');
  await call(redis.expire, id, 3600);
}

async function runReaper() {
  const { stdout } = await execFileAsync(process.execPath, [REAPER], {
    env: { ...process.env, FILE_DIR: dir }
  });
  return stdout.trim();
}

const first = await runReaper();
measured('first pass', first);

const left = fs.readdirSync(dir);
check('reaper: removed the expired file', !left.includes(EXPIRED), left.join(','));
check(
  'reaper: kept the old file whose key is still live',
  left.includes(LIVE),
  'deleted a file whose link still works'
);
check(
  'reaper: kept the in-flight upload (fresh, no key)',
  left.includes(INFLIGHT),
  'this is the race that would corrupt live uploads'
);
check('reaper: kept the recent file (fresh, no key)', left.includes(RECENT));
check(
  'reaper: kept the second old file with a live key',
  left.includes(OTHER_LIVE)
);
check('reaper: ignored the malformed name', left.includes(MALFORMED));

const second = await runReaper();
check('reaper: second pass is a no-op', /0 removed/.test(second), second);

for (const id of live) {
  await call(redis.del, id);
}
try {
  redis.quit?.();
} catch (e) {
  // already closing
}
fs.rmSync(dir, { recursive: true, force: true });

if (failures.length) {
  process.stderr.write(`\n${failures.length} reaper check(s) failed:\n`);
  for (const f of failures) {
    process.stderr.write(`  - ${f}\n`);
  }
  process.exit(1);
}
process.stdout.write('REAPER VERIFIED\n');