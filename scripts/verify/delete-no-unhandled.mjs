#!/usr/bin/env node
/*
 * G5: deleting storage never produces an unhandled rejection.
 *
 * The bug: storage.del() called storage.del(path) without awaiting it. The
 * filesystem backend used fs.unlinkSync, so removing an object that was already
 * gone threw ENOENT inside an unawaited promise, which Node reports as an
 * unhandled rejection and, by default, terminates the process.
 *
 * The control: this same script deliberately provokes one unhandled rejection
 * and asserts the detector sees it. Without that, an absence check would also
 * pass if the detector were simply broken.
 */

process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'error';

import { assert, measured, ok, require, shutdown } from './lib.mjs';
import { Readable } from 'node:stream';

const unhandled = [];
process.on('unhandledRejection', reason => {
  unhandled.push(reason);
});

async function main() {
  const storage = require('../../server/storage');
  const id = `delprobe${process.pid}${Date.now()}`;

  await storage.set(id, Readable.from([Buffer.from('payload')]), {
    owner: 'o',
    metadata: 'm',
    auth: 'a',
    nonce: 'n',
    dlimit: 1
  });
  measured('stored object present', (await storage.metadata(id)) !== null);

  await storage.del(id);
  measured(
    'after first delete, metadata',
    JSON.stringify(await storage.metadata(id))
  );

  // The regression: deleting an absent object must be a no-op, not a throw.
  await storage.del(id);
  measured(
    'after second delete, metadata',
    JSON.stringify(await storage.metadata(id))
  );

  // Let the microtask queue and the rejection window drain.
  await new Promise(resolve => setTimeout(resolve, 300));

  assert.equal(
    unhandled.length,
    0,
    'expected no unhandled rejections, got: ' +
      unhandled.map(u => (u && u.message) || String(u)).join('; ')
  );
  measured('unhandled rejections during real deletes', unhandled.length);

  /* Negative control: the detector must be capable of seeing a rejection.
   * If this does not register, the assertion above proves nothing. */
  Promise.reject(new Error('deliberate control rejection'));
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(
    unhandled.length,
    1,
    'the unhandled-rejection detector failed its own control, so the ' +
      'absence check above is not trustworthy'
  );
  measured('control rejection detected', unhandled.length === 1);

  await shutdown(null);
  ok('STORAGE DELETE VERIFIED');
}

main().catch(err => {
  process.stderr.write(`  ${(err && err.stack) || err}\n`);
  process.exit(1);
});
