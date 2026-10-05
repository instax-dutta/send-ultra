#!/usr/bin/env node
/*
 * Deletes the ciphertext of uploads whose metadata has expired.
 *
 * Expiry is enforced on read: once the Redis key is gone the link stops working
 * and the bytes cannot be fetched. What expiry does not do is remove them, so
 * the filesystem grows for the lifetime of the instance. This closes that.
 *
 * THE RACE, which is the whole reason this is not a five-line script:
 *
 * storage.set() awaits the incoming stream before it writes any Redis key
 * (server/storage/index.js writes the hash only after `await this.storage.set`
 * resolves). A 10 GiB upload therefore sits on disk with no key in Redis for the
 * entire duration of the transfer. A reaper that deleted every file whose key
 * was missing would destroy in-flight uploads, and would look perfectly healthy
 * while doing it.
 *
 * Two independent guards prevent that:
 *
 *   1. Age. A file is only a candidate once its last write is older than
 *      max_expire_seconds plus a margin. A live key always carries a TTL at or
 *      below max_expire_seconds, so once a file is older than that *and* its key
 *      is gone, the key must have expired. mtime is also refreshed as an upload
 *      writes, so a slow in-flight transfer keeps its own age down.
 *   2. Never fail loudly. One unreadable file must not stop the sweep, because a
 *      reaper that dies halfway leaves exactly the mess it was written to clear.
 *
 * Usage: node scripts/reap-expired.mjs [--dry-run]
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const config = require('../server/config');

const DRY_RUN = process.argv.includes('--dry-run');

/*
 * Margin on top of the longest expiry the server will ever grant. Covers a clock
 * skew, and gives a second chance to anything whose key write failed while the
 * transfer itself succeeded.
 */
const MARGIN_MS = 60 * 60 * 1000;

const FILE_DIR = config.file_dir;
const MAX_AGE_MS = config.max_expire_seconds * 1000 + MARGIN_MS;

/* `7-3f2a...` -> `3f2a...`. The prefix is the expiry bucket in days. */
function idFromFilename(name) {
  const dash = name.indexOf('-');
  if (dash === -1) {
    return null;
  }
  const prefix = name.slice(0, dash);
  const id = name.slice(dash + 1);
  return /^\d+$/.test(prefix) && id.length > 0 ? id : null;
}

function human(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)}${units[i]}`;
}

async function main() {
  if (!fs.existsSync(FILE_DIR)) {
    process.stdout.write(`reap: file dir ${FILE_DIR} does not exist, nothing to do\n`);
    return 0;
  }

  const redis = require('../server/storage').redis;
  let entries;
  try {
    entries = await fs.promises.readdir(FILE_DIR);
  } catch (err) {
    process.stderr.write(`reap: cannot read ${FILE_DIR}: ${err.message}\n`);
    return 1;
  }

  const now = Date.now();
  let candidates = 0;
  let removed = 0;
  let freed = 0;
  let skipped = 0;
  let errors = 0;

  for (const name of entries) {
    const id = idFromFilename(name);
    if (!id) {
      continue;
    }

    let stat;
    try {
      stat = await fs.promises.stat(path.join(FILE_DIR, name));
    } catch (err) {
      // Raced with something else that removed it. Not a problem.
      skipped++;
      continue;
    }

    const age = now - stat.mtimeMs;
    if (age < MAX_AGE_MS) {
      // Still young enough that its key may not exist yet: this is either a
      // live upload or a live link.
      skipped++;
      continue;
    }
    candidates++;

    try {
      const meta = await redis.hgetallAsync(id);
      const live = meta && Object.keys(meta).length > 0;
      if (live) {
        // Key is still present, so the link still works. Redis will expire it.
        skipped++;
        continue;
      }

      freed += stat.size;
      if (!DRY_RUN) {
        await fs.promises.unlink(path.join(FILE_DIR, name));
      }
      removed++;
    } catch (err) {
      errors++;
      process.stderr.write(`reap: ${name}: ${err.message}\n`);
    }
  }

  const verb = DRY_RUN ? 'would remove' : 'removed';
  process.stdout.write(
    `reap: scanned ${entries.length} entries, ${removed} ${verb} (${human(
      freed
    )}), ${skipped} kept, ${errors} error(s); age threshold ${Math.round(
      MAX_AGE_MS / 1000
    )}s, dir ${FILE_DIR}\n`
  );

  try {
    redis.quit?.();
  } catch (e) {
    // The client may already be closing; nothing to do.
  }
  return errors > 0 ? 1 : 0;
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    process.stderr.write(`reap: ${err && err.stack ? err.stack : err}\n`);
    process.exit(1);
  });