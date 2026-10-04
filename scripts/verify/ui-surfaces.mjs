#!/usr/bin/env node
/*
 * Drives every redesigned surface in a real browser against the deployed
 * instance, and asserts two things:
 *
 *   1. the flows still work: a file uploaded through the actual file input can
 *      be received and downloaded through the actual download button, and the
 *      terminal states render
 *   2. no surface regressed to the legacy light panel: every route must render
 *      the Send Ultra shell and must not emit a bare `.main > section` or a
 *      white utility class
 *
 * The second half is the point. The earlier UI work was verified by eye, which
 * is exactly the kind of claim that quietly stops being true; this fails
 * instead.
 *
 * Usage: node scripts/verify/ui-surfaces.mjs <origin>
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const origin = process.argv[2];
if (!origin) {
  process.stderr.write('usage: ui-surfaces.mjs <origin>\n');
  process.exit(2);
}

/*
 * Puppeteer is a dev dependency and this verifier is a dev tool, so it is loaded
 * lazily and its absence is reported as a skip rather than a hard failure. A
 * missing browser must not be mistaken for a passing UI.
 */
let puppeteer = null;
try {
  puppeteer = require('puppeteer');
} catch (e) {
  process.stdout.write('  puppeteer unavailable, cannot drive a browser\n');
  process.stdout.write('UI SURFACES SKIPPED (no browser)\n');
  process.exit(0);
}

const failures = [];
const notes = [];

function measured(label, value) {
  process.stdout.write(`  ${label}: ${value}\n`);
}

function check(label, condition, detail = '') {
  if (condition) {
    measured(label, 'ok');
  } else {
    failures.push(label + (detail ? ` (${detail})` : ''));
    process.stdout.write(`  ${label}: FAIL${detail ? ` (${detail})` : ''}\n`);
  }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'send-ui-'));
const payload = crypto.randomBytes(512 * 1024);
const payloadPath = path.join(work, 'surface-check.bin');
fs.writeFileSync(payloadPath, payload);
const expectedSha = crypto.createHash('sha256').update(payload).digest('hex');

/*
 * Launch with retries.
 *
 * The bundled Chromium for this Puppeteer version segfaults on this host often
 * enough to make a single launch a coin flip. A crash before the first
 * assertion is an infrastructure failure, not a verdict on the interface, so it
 * is retried rather than reported as a failure.
 *
 * SEND_CHROME_PATH selects a different engine. Worth doing when the question is
 * how the layout actually looks: the bundled build predates flexbox `gap`, so it
 * renders the interface with every flex gap collapsed.
 */
async function launch() {
  const args = ['--no-sandbox', '--disable-dev-shm-usage'];
  const executablePath = process.env.SEND_CHROME_PATH || undefined;
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await puppeteer.launch({ args, executablePath });
    } catch (e) {
      lastError = e;
      process.stdout.write(
        `  browser launch attempt ${attempt} failed, retrying\n`
      );
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw lastError;
}

const browser = await launch();

const pageErrors = [];
const badResponses = [];

async function newPage(width = 1440, height = 900) {
  const page = await browser.newPage();
  page.on('pageerror', e => pageErrors.push(String(e).slice(0, 160)));
  page.on('console', m => {
    /*
     * Resource failures are recorded by the response handler below, with the
     * URL attached. Counting them here as well would report the same defect
     * twice and would also flag the dead link this gate probes on purpose.
     */
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) {
      pageErrors.push('console: ' + m.text().slice(0, 160));
    }
  });
  /*
   * A 404 is a defect even when the page still renders, and the browser only
   * mentions it on the console, where it is easy to miss. Recording the URL
   * turns "something 404ed" into a specific, fixable line.
   */
  page.on('response', res => {
    if (res.status() >= 400) {
      badResponses.push(`${res.status()} ${res.url().replace(origin, '')}`);
    }
  });
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  return page;
}

/*
 * `ready` must be a selector that only exists once the route itself has
 * rendered, not one that is present in the document shell.
 *
 * The server answers `/` with the /blank route on purpose (pages.js), so the
 * first paint is an empty frame and the real route appears client side. Waiting
 * on a shell class such as .su-field would therefore assert against the shell
 * and quietly pass before anything had rendered.
 */
async function open(page, url, ready) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForFunction(() => !!document.querySelector('.su-field'), {
    timeout: 30000
  });
  await page.waitForFunction(
    sel => !!document.querySelector(sel),
    { timeout: 30000 },
    ready
  );
  await new Promise(r => setTimeout(r, 600));
}

/*
 * The regression assertion. Every route must render the redesigned shell, and
 * none may paint the legacy white panel that .main > section still carries for
 * anything the redesign missed.
 */
async function audit(page, label) {
  const report = await page.evaluate(() => {
    const legacyPanel = document.querySelector('.main > section');
    const whiteUtility = document.querySelector(
      '[class*="bg-white"], [class*="dark:bg-grey-90"], [class*="md:shadow-big"]'
    );
    return {
      hasField: !!document.querySelector('.su-field'),
      hasStage: !!document.querySelector('.su-stage'),
      hasHeader: !!document.querySelector('.su-header'),
      hasFooter: !!document.querySelector('.su-footer'),
      legacyPanel: !!legacyPanel,
      whiteUtility: !!whiteUtility,
      whiteUtilityClass: whiteUtility ? whiteUtility.className : ''
    };
  });

  check(`${label}: lit background field`, report.hasField);
  check(`${label}: stage wrapper`, report.hasStage);
  check(`${label}: glass header`, report.hasHeader);
  check(`${label}: footer`, report.hasFooter);
  check(`${label}: no legacy panel`, !report.legacyPanel);
  check(
    `${label}: no light-panel utility`,
    !report.whiteUtility,
    report.whiteUtilityClass
  );
}

try {
  /* ---------------------------------------------------------------- *
   * 1. Upload surface
   * ---------------------------------------------------------------- */
  const up = await newPage();
  await open(up, origin + '/', '.su-drop');
  await audit(up, 'upload');

  const brand = await up.$eval('.su-eyebrow', el => el.textContent.trim());
  check('upload: brand eyebrow populated', brand.length > 0, brand);
  measured('brand string', JSON.stringify(brand));

  const uploadInputs = await up.$$('#empty #file-upload');
  check('upload: real file input present', uploadInputs.length === 1);
  check(
    'upload: drop target exposed',
    !!(await up.$('.su-drop'))
  );

  /*
   * Attach through the genuine <input type=file> element.
   *
   * Not via puppeteer's file chooser: that helper builds the File with
   * fetch('data:...'), which this app's connect-src policy forbids, so it fails
   * against the deployed instance for a reason that has nothing to do with the
   * interface. The bytes are decoded in-page and a real change event is
   * dispatched on the real input, which is the exact path addFiles takes.
   */
  await up.evaluate(
    (name, b64) => {
      const bin = atob(b64);
      const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        buf[i] = bin.charCodeAt(i);
      }
      const dt = new DataTransfer();
      dt.items.add(
        new File([buf], name, { type: 'application/octet-stream' })
      );
      /*
       * A second file, so the archive card renders its file-count disclosure.
       * That path was rewritten, and a single-file upload would never render it.
       */
      dt.items.add(
        new File([buf.subarray(0, 4096)], 'notes.txt', { type: 'text/plain' })
      );
      const input = document.querySelector('#empty #file-upload');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    path.basename(payloadPath),
    payload.toString('base64')
  );
  await new Promise(r => setTimeout(r, 2500));

  const expirySelects = await up.$$eval('.su-expiry .su-select', els =>
    els.map(el => ({
      id: el.id,
      options: el.options.length,
      styled: el.classList.contains('su-select')
    }))
  );
  check(
    'upload: expiry pickers present and styled',
    expirySelects.length === 2 && expirySelects.every(s => s.styled && s.options > 1),
    JSON.stringify(expirySelects)
  );

  await up.click('#upload-btn');

  const shared = await up
    .waitForFunction(
      () => {
        const el = document.querySelector('#wip, input[readonly], [class*="su-filecard"]');
        const field = document.querySelector('input[readonly]');
        return field ? field.value : null;
      },
      { timeout: 180000, polling: 500 }
    )
    .then(handle => handle.jsonValue())
    .catch(() => null);

  if (!shared) {
    failures.push('upload: no share URL after transfer');
    process.stdout.write('  upload: FAIL (no share URL)\n');
    throw new Error('upload produced no share URL');
  }
  check('upload: transfer produced a share link', /^https?:\/\/.+\/download\/.+/.test(shared));
  notes.push('share link issued');

  const archiveCard = await up.evaluate(() => {
    const el = document.querySelector('[id^="archive-"]');
    if (!el) {
      return null;
    }
    return {
      hasManifestToggle: !!el.querySelector('.su-toggle'),
      hasActions: !!el.querySelector('.su-actions'),
      iconAction: !!el.querySelector('.su-icon-btn'),
      legacyIcon: !!el.querySelector('.text-white'),
      name: (el.querySelector('.su-meta-name') || {}).textContent || ''
    };
  });
  if (archiveCard) {
    check('archive card: file-count toggle restyled', archiveCard.hasManifestToggle);
    check('archive card: action row restyled', archiveCard.hasActions);
    check('archive card: delete restyled', archiveCard.iconAction);
    check(
      'archive card: no legacy icon colour',
      !archiveCard.legacyIcon
    );
  } else {
    notes.push('single-file archive: manifest toggle not applicable');
  }

  /*
   * The post-upload sheet. It is the first thing a user sees after a successful
   * transfer, so a regression here is the most visible one possible.
   */
  const dialog = await up
    .waitForFunction(() => !!document.querySelector('send-modal'), {
      timeout: 30000,
      polling: 500
    })
    .then(() => true)
    .catch(() => false);
  check('dialog: copy sheet opens after upload', dialog);

  if (dialog) {
    const sheet = await up.evaluate(() => {
      const cs = el => getComputedStyle(el);
      const actions = [...document.querySelectorAll('.su-modal-core button, .su-modal-core a')]
        .map(el => ({ color: cs(el).color, text: el.textContent.trim() }));
      const field = document.querySelector('#share-url');
      const qrBtn = document.querySelector('#qr-btn');
      return {
        usesShell: !!document.querySelector('.su-dialog'),
        title: (document.querySelector('.su-title') || {}).textContent || '',
        inlineStyles: document.querySelectorAll('[style]').length,
        actions,
        fieldWidth: field ? Math.round(field.getBoundingClientRect().width) : 0,
        qrWidth: qrBtn ? Math.round(qrBtn.getBoundingClientRect().width) : 0,
        qrHasSizeClass: qrBtn
          ? qrBtn.classList.contains('w-16') || qrBtn.classList.contains('w-48')
          : false
      };
    });

    check('dialog: shared sheet in use', sheet.usesShell);
    check('dialog: headline on the new type scale', sheet.title.length > 0, sheet.title);
    check(
      'dialog: no inline styles (CSP styleSrc is nonce-only)',
      sheet.inlineStyles === 0,
      `${sheet.inlineStyles} inline style attribute(s)`
    );
    check('dialog: link field laid out', sheet.fieldWidth > 0, `${sheet.fieldWidth}px`);
    /*
     * The toggle swaps w-16 and w-48, so the button has to start with one of
     * them. Without a starting width the QR has no constraint and expands to
     * fill the row on first paint, squeezing the link field to a stub.
     */
    check('dialog: QR toggle starts collapsed', sheet.qrHasSizeClass && sheet.qrWidth <= 80,
      `${sheet.qrWidth}px, size class present: ${sheet.qrHasSizeClass}`);
    check('dialog: link field gets the row', sheet.fieldWidth > sheet.qrWidth * 2,
      `field ${sheet.fieldWidth}px vs qr ${sheet.qrWidth}px`);

    /*
     * The secondary action used to inherit --color-primary, a blue that appears
     * nowhere else in the interface. Assert the computed colour rather than the
     * class, so a renamed class cannot hide the regression.
     */
    const offPalette = sheet.actions.filter(a => a.color === 'rgb(10, 132, 255)');
    check(
      'dialog: no legacy primary blue on any action',
      offPalette.length === 0,
      offPalette.map(a => a.text).join(', ')
    );

    /*
     * Exercise the QR toggle both ways. A control that looks right but does
     * nothing is invisible to a screenshot and to a presence assertion.
     */
    await up.click('#qr-btn').catch(() => {});
    await new Promise(r => setTimeout(r, 400));
    const expanded = await up.evaluate(() => {
      const f = document.querySelector('#share-url');
      const q = document.querySelector('#qr-btn');
      return {
        fieldHidden: f ? getComputedStyle(f).display === 'none' : false,
        qrGrew: q.getBoundingClientRect().width > 60
      };
    });
    check('dialog: QR toggle hides the link field', expanded.fieldHidden);
    check('dialog: QR toggle enlarges the code', expanded.qrGrew);

    await up.click('#qr-btn').catch(() => {});
    await new Promise(r => setTimeout(r, 400));
    const collapsed = await up.evaluate(() => {
      const f = document.querySelector('#share-url');
      const q = document.querySelector('#qr-btn');
      return {
        fieldVisible: f ? getComputedStyle(f).display !== 'none' : false,
        qrWidth: q ? Math.round(q.getBoundingClientRect().width) : 0,
        hasW16: q ? q.classList.contains('w-16') : false
      };
    });
    check('dialog: QR toggle restores the link field', collapsed.fieldVisible);
    check('dialog: QR toggle returns to the small size',
      collapsed.hasW16 && collapsed.qrWidth <= 80, `${collapsed.qrWidth}px`);
  }

  await up.screenshot({ path: path.join(work, '1b-dialog.png') });
  await up.evaluate(() => {
    const ok = [...document.querySelectorAll('.su-link-btn')][0];
    if (ok) ok.click();
  });
  await new Promise(r => setTimeout(r, 900));
  await up.screenshot({ path: path.join(work, '1-upload.png') });

  /* ---------------------------------------------------------------- *
   * 2. Receiver preview
   * ---------------------------------------------------------------- */
  const recv = await newPage();
  await open(recv, shared, '#download-btn');
  await audit(recv, 'receiver');

  const preview = await recv.evaluate(() => ({
    title: (document.querySelector('.su-title') || {}).textContent || '',
    lede: (document.querySelector('.su-lede') || {}).textContent || '',
    metaName: (document.querySelector('.su-meta-name') || {}).textContent || '',
    downloadBtn: !!document.querySelector('#download-btn'),
    btnLabel: (document.querySelector('#download-btn') || {}).textContent || '',
    legacyBtn: !!document.querySelector('#download-btn.btn')
  }));
  check('receiver: headline rendered', preview.title.length > 0, preview.title);
  check('receiver: description rendered', preview.lede.length > 0);
  /*
   * Compared against the name the upload page actually produced rather than a
   * hardcoded one: more than one file is sent as an archive, so the receiver
   * legitimately shows the archive name and not the original file name.
   */
  const expectedName = archiveCard && archiveCard.name ? archiveCard.name : 'surface-check.bin';
  check(
    'receiver: name matches what was uploaded',
    preview.metaName === expectedName,
    `${preview.metaName} vs ${expectedName}`
  );
  check('receiver: download button present', preview.downloadBtn);
  check(
    'receiver: download button restyled',
    !preview.legacyBtn && preview.btnLabel.length > 0,
    preview.btnLabel
  );
  await recv.screenshot({ path: path.join(work, '2-receiver.png') });

  /* ---------------------------------------------------------------- *
   * 3. Narrow viewport, on the live receiver card
   *
   * Checked here rather than on a second visit because an anonymous link is
   * typically single use: by the time the desktop download had run, reopening
   * it would legitimately show a spent state instead of the preview card.
   * ---------------------------------------------------------------- */
  await recv.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await new Promise(r => setTimeout(r, 500));
  const overflow = await recv.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    btnWidth: (document.querySelector('#download-btn') || {}).getBoundingClientRect
      ? document.querySelector('#download-btn').getBoundingClientRect().width
      : 0
  }));
  check(
    'mobile: receiver does not scroll horizontally',
    overflow.scrollWidth <= overflow.clientWidth + 1,
    `${overflow.scrollWidth} > ${overflow.clientWidth}`
  );
  check(
    'mobile: download button fits the viewport',
    overflow.btnWidth > 0 && overflow.btnWidth <= overflow.clientWidth,
    `button ${overflow.btnWidth}, viewport ${overflow.clientWidth}`
  );
  await recv.screenshot({ path: path.join(work, '3-mobile.png'), fullPage: true });
  await recv.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await new Promise(r => setTimeout(r, 400));

  /* ---------------------------------------------------------------- *
   * 4. Download completes and the bytes survive the redesign
   * ---------------------------------------------------------------- */
  const client = await recv.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: work
  });

  await recv.click('#download-btn');

  const complete = await recv
    .waitForFunction(() => !!document.querySelector('#download-complete'), {
      timeout: 120000,
      polling: 500
    })
    .then(() => true)
    .catch(() => false);
  check('receiver: reached the completed state', complete);
  if (complete) {
    const done = await recv.evaluate(() => ({
      heading: (document.querySelector('.su-title') || {}).textContent || '',
      hasCard: !!document.querySelector('.su-core.su-card'),
      legacy: !!document.querySelector('.bg-white')
    }));
    check('complete: heading rendered', done.heading.length > 0, done.heading);
    check('complete: glass card present', done.hasCard);
    check('complete: no legacy background', !done.legacy);
    await recv.screenshot({ path: path.join(work, '4-complete.png') });
  }

  /* Give the browser a moment to finish writing the file. */
  const downloaded = path.join(work, 'surface-check.bin');
  let received = null;
  for (let i = 0; i < 40; i++) {
    if (fs.existsSync(downloaded) && !fs.existsSync(downloaded + '.crdownload')) {
      received = downloaded;
      break;
    }
    await new Promise(r => setTimeout(r, 500));
  }

  if (!received) {
    failures.push('download: no file written to disk');
    process.stdout.write('  download: FAIL (no file written)\n');
  } else {
    const got = fs.readFileSync(received);
    const gotSha = crypto.createHash('sha256').update(got).digest('hex');
    check('download: byte count matches', got.length === payload.length, `${got.length} vs ${payload.length}`);
    check('download: sha256 matches', gotSha === expectedSha, `${gotSha} vs ${expectedSha}`);
  }

  /* ---------------------------------------------------------------- *
   * 5. Terminal states
   * ---------------------------------------------------------------- */
  const err = await newPage();
  await open(err, origin + '/error', '.su-title');
  await audit(err, 'error');
  const errState = await err.evaluate(() => ({
    title: (document.querySelector('.su-title') || {}).textContent || '',
    glyph: !!document.querySelector('.su-glyph .su-glyph-icon'),
    warn: !!document.querySelector('.su-glyph-warn'),
    cta: !!document.querySelector('.su-btn'),
    legacy: !!document.querySelector('.text-primary')
  }));
  check('error: headline rendered', errState.title.length > 0, errState.title);
  check('error: glyph rendered', errState.glyph);
  check('error: warning tone applied', errState.warn);
  check('error: call to action rendered', errState.cta);
  check('error: no legacy illustration', !errState.legacy);
  await err.screenshot({ path: path.join(work, '5-error.png') });

  /* A syntactically valid link with a dead id must land on the expired state. */
  const dead = await newPage();
  await open(dead, origin + '/download/deadbeefdeadbeefdeadbeef/#notarealkey', '.su-title');
  await audit(dead, 'expired');
  const gone = await dead.evaluate(() => ({
    title: (document.querySelector('.su-title') || {}).textContent || '',
    still: !!document.querySelector('.su-glyph-still'),
    glyph: !!document.querySelector('.su-glyph .su-glyph-icon')
  }));
  check('expired: headline rendered', gone.title.length > 0, gone.title);
  check('expired: glyph rendered', gone.glyph);
  check('expired: still tone applied', gone.still);
  await dead.screenshot({ path: path.join(work, '6-expired.png') });

  /* Unsupported browser route. */
  const uns = await newPage();
  await open(uns, origin + '/unsupported/unsupported', '.su-title');
  await audit(uns, 'unsupported');
  const unsState = await uns.evaluate(() => ({
    title: (document.querySelector('.su-title') || {}).textContent || '',
    cta: !!document.querySelector('.su-btn'),
    why: !!document.querySelector('a.su-ghost'),
    firefox: !!document.querySelector('.su-btn-disc svg image')
  }));
  check('unsupported: headline rendered', unsState.title.length > 0, unsState.title);
  check('unsupported: call to action rendered', unsState.cta);
  check('unsupported: explanation link present', unsState.why);
  check('unsupported: firefox mark present', unsState.firefox);
  await uns.screenshot({ path: path.join(work, '7-unsupported.png') });

  check('no page errors across every surface', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  /*
   * /download/<dead id> is requested on purpose above, so that one path is
   * allowed to answer 404. Every other request must succeed.
   */
  const unexpected404 = badResponses.filter(
    r => !r.startsWith('404 /api/') && !r.startsWith('404 /download/')
  );
  check(
    'no unexpected failed request',
    unexpected404.length === 0,
    [...new Set(unexpected404)].slice(0, 5).join(' | ')
  );
  measured('intentional 404s (dead link probe)', badResponses.length - unexpected404.length);
} finally {
  await browser.close();
  fs.rmSync(work, { recursive: true, force: true });
}

if (failures.length) {
  process.stderr.write(`\n${failures.length} UI surface check(s) failed:\n`);
  for (const f of failures) {
    process.stderr.write(`  - ${f}\n`);
  }
  process.exit(1);
}

for (const n of notes) {
  process.stdout.write(`  note: ${n}\n`);
}
process.stdout.write('UI SURFACES VERIFIED\n');