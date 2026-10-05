#!/usr/bin/env node
/*
 * Drives a real browser through an upload and asserts the transfer readout
 * behaves the way a person would need it to.
 *
 * The point of this gate is the honesty of the estimate, not its presence. A
 * progress bar with a number attached passes almost any check; what actually
 * matters is that the number is withheld until it means something, that it
 * counts down rather than sitting frozen, and that it survives a completed
 * transfer.
 *
 * Usage: node scripts/verify/transfer-readout.mjs <origin>
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const origin = process.argv[2];
if (!origin) {
  process.stderr.write('usage: transfer-readout.mjs <origin>\n');
  process.exit(2);
}

let puppeteer = null;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  process.stdout.write('  puppeteer unavailable\n');
  process.stdout.write('TRANSFER READOUT SKIPPED (no browser)\n');
  process.exit(0);
}

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

async function launch() {
  const args = ['--no-sandbox', '--disable-dev-shm-usage'];
  const executablePath = process.env.SEND_CHROME_PATH || undefined;
  let last;
  for (let i = 1; i <= 3; i++) {
    try {
      return await puppeteer.launch({ args, executablePath });
    } catch (e) {
      last = e;
      process.stdout.write(`  launch attempt ${i} failed, retrying\n`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw last;
}

/*
 * Big enough that the upload lasts long enough to observe the countdown, small
 * enough not to sit on the disk for long.
 */
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'send-eta-'));
const payload = crypto.randomBytes(96 * 1024 * 1024);
const payloadPath = path.join(work, 'readout-check.bin');
fs.writeFileSync(payloadPath, payload);
measured('payload', `${Math.round(payload.length / 1024 / 1024)} MiB`);

const browser = await launch();
const pageErrors = [];

try {
  const page = await browser.newPage();
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 140)));
  page.on('console', m => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) {
      pageErrors.push('console: ' + m.text().slice(0, 140));
    }
  });
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(origin + '/', { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!document.querySelector('.su-drop'), {
    timeout: 30000
  });

  /*
   * Attach the file through the real input via DOM.setFileInputFiles.
   *
   * Not page.evaluate with a base64 payload: passing 96 MiB through the CDP
   * bridge as an argument closes the render target outright. This is also the
   * more faithful route, since it is how a user's file actually arrives.
   */
  const client = await page.target().createCDPSession();
  await client.send('DOM.enable');
  const doc = await client.send('DOM.getDocument');
  const inputNode = await client.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: '#empty #file-upload'
  });
  check('readout: real file input found', !!inputNode.nodeId);
  await client.send('DOM.setFileInputFiles', {
    files: [payloadPath],
    nodeId: inputNode.nodeId
  });
  // Belt and braces: some engines set the files without firing change.
  await page.evaluate(() => {
    const el = document.querySelector('#empty #file-upload');
    if (el && el.files && el.files.length) {
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await new Promise(r => setTimeout(r, 1500));
  const staged = await page.evaluate(
    () => document.querySelectorAll('#wip .su-fileitem').length
  );
  check('readout: file staged for upload', staged > 0, `${staged} item(s)`);

  await new Promise(r => setTimeout(r, 1500));
  await page.click('#upload-btn');

  /*
   * The readout is withheld until both thresholds clear, so the first sighting
   * of it is the interesting moment. Sample until it appears.
   */
  const appeared = await page
    .waitForFunction(() => !!document.querySelector('.su-readout'), {
      timeout: 60000,
      polling: 250
    })
    .then(() => true)
    .catch(() => false);
  check('readout: appears during the transfer', appeared);

  const first = await page.evaluate(() => {
    const meta = document.querySelector('.su-readout-meta');
    const pct = document.querySelector('.su-readout-value');
    return {
      meta: meta ? meta.textContent.replace(/\s+/g, ' ').trim() : '',
      percent: pct ? pct.textContent.trim() : '',
      pending: !!document.querySelector('.su-readout-pending')
    };
  });
  measured('first sighting', JSON.stringify(first.meta));
  check('readout: shows a percentage', /\d/.test(first.percent), first.percent);

  // Somewhere in the middle it should carry a real estimate rather than the
  // placeholder, and a throughput figure.
  await new Promise(r => setTimeout(r, 4000));
  const mid = await page.evaluate(() => {
    const meta = document.querySelector('.su-readout-meta');
    return {
      text: meta ? meta.textContent.replace(/\s+/g, ' ').trim() : '',
      pendingCount: document.querySelectorAll('.su-readout-pending').length
    };
  });
  measured('mid transfer', JSON.stringify(mid.text));

  const hasEta = /\d+\s*(s|m|h)\b/.test(mid.text);
  const hasRate = /(\/s|B\/s)/.test(mid.text);
  check('readout: shows time remaining', hasEta, mid.text);
  check('readout: shows throughput', hasRate, mid.text);
  check(
    'readout: no placeholder left once estimating',
    mid.pendingCount === 0,
    `${mid.pendingCount} placeholder(s)`
  );

  /*
   * Count down, not a frozen number. Sampled twice a few seconds apart: a
   * readout that only repaints when a chunk lands can sit still for the whole
   * transfer on a slow link.
   */
  const snapA = await page.evaluate(
    () =>
      (document.querySelector('.su-readout-meta') || {}).textContent || ''
  );
  await new Promise(r => setTimeout(r, 6000));
  const snapB = await page.evaluate(
    () =>
      (document.querySelector('.su-readout-meta') || {}).textContent || ''
  );
  check(
    'readout: the estimate advances over time',
    snapA !== snapB && snapB.length > 0,
    `${JSON.stringify(snapA.trim())} -> ${JSON.stringify(snapB.trim())}`
  );

  // Complete, then confirm the completed sheet is clean of a stale countdown.
  const done = await page
    .waitForFunction(() => !!document.querySelector('send-modal'), {
      timeout: 300000,
      polling: 500
    })
    .then(() => true)
    .catch(() => false);
  check('readout: transfer completed', done);

  if (done) {
    const after = await page.evaluate(() => ({
      readouts: document.querySelectorAll('.su-readout').length,
      pending: document.querySelectorAll('.su-readout-pending').length
    }));
    check(
      'readout: no leftover countdown on the completed sheet',
      after.readouts === 0 && after.pending === 0,
      JSON.stringify(after)
    );
  }

  check(
    'no page errors',
    pageErrors.length === 0,
    pageErrors.slice(0, 3).join(' | ')
  );
} finally {
  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  process.stderr.write(`\n${failures.length} readout check(s) failed:\n`);
  for (const f of failures) {
    process.stderr.write(`  - ${f}\n`);
  }
  process.exit(1);
}
process.stdout.write('TRANSFER READOUT VERIFIED\n');