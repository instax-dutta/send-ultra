/* eslint-disable no-undef, no-process-exit */
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const webpack = require('webpack');
const config = require('../../webpack.config');
const middleware = require('webpack-dev-middleware');
const express = require('express');
const devRoutes = require('../../server/bin/test');
const app = express();

const wpm = middleware(webpack(config(null, { mode: 'development' })), {
  logLevel: 'silent'
});
app.use(wpm);
devRoutes(app, { middleware: wpm });

// eslint-disable-next-line no-unused-vars
function onConsole(msg) {
  // uncomment to debug
  // console.error(msg.text());
}

/*
 * Pick the newest browser available.
 *
 * The bundled Chromium in this puppeteer version dates from 2020. On an arm64 Mac
 * running a current macOS it launches under Rosetta some of the time and
 * segfaults the rest, which made this suite fail roughly one run in six with
 * "Failed to launch the browser process!" and no connection to any test. An
 * explicit up-to-date Chrome is preferred; the bundled build is still used when
 * nothing better is present, so a clean checkout on another machine still runs.
 */
function findChrome() {
  const explicit = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH
  ].filter(Boolean);
  for (const p of explicit) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  const downloaded = path.resolve(__dirname, '../../chrome');
  if (fs.existsSync(downloaded)) {
    const found = searchForBrowser(downloaded, 0);
    if (found) {
      return found;
    }
  }
  return puppeteer.executablePath();
}

/*
 * Walk the @puppeteer/browsers cache layout looking for a browser binary.
 *
 * The directory holds a .metadata file alongside the version folders, so every
 * entry is checked before it is descended into rather than assumed to be a
 * directory; reading it as one throws ENOTDIR.
 */
function searchForBrowser(dir, depth) {
  if (depth > 6) {
    return null;
  }
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return null;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // macOS puts the binary in Contents/MacOS inside the .app bundle.
      if (/^Contents$/.test(entry.name)) {
        const bin = path.join(full, 'MacOS');
        if (fs.existsSync(bin)) {
          for (const f of fs.readdirSync(bin)) {
            if (/^(Google Chrome for Testing|chrome|Chromium)$/.test(f)) {
              return path.join(bin, f);
            }
          }
        }
      }
      const hit = searchForBrowser(full, depth + 1);
      if (hit) {
        return hit;
      }
    } else if (entry.isFile() && /^chrome$|^chromium$/.test(entry.name)) {
      // Linux layout: a bare executable next to the resources directory.
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch (e) {
        // not executable, keep looking
      }
    }
  }
  return null;
}

const CHROME_ARGS = [
  // puppeteer >= 1.10.0 crashes on Circle CI without this flag set
  '--no-sandbox',
  // The default /dev/shm is often too small to host a browser, and the failure
  // surfaces as "Failed to launch the browser process!" with nothing about disk
  // space in it.
  '--disable-dev-shm-usage'
];

/*
 * A launch is retried because the failure is a crash in the browser process
 * rather than a deterministic refusal: the same binary launches on the next
 * attempt. Giving up on the first SEGV turned a recoverable hiccup into a red
 * run, and the crash left nothing behind to diagnose.
 */
async function launch(attempts = 3) {
  const executablePath = findChrome();
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await puppeteer.launch({ executablePath, args: CHROME_ARGS });
    } catch (e) {
      lastError = e;
      console.log(
        `  browser launch attempt ${attempt}/${attempts} failed, retrying\n`
      );
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
  throw lastError;
}

const server = app.listen(async function() {
  let exitCode = -1;
  /*
   * Launched inside the try, not before it.
   *
   * A launch failure is one of the likeliest things to happen here (no /dev/shm
   * headroom, too many leftover browsers, a sandbox that refuses). When it
   * happened outside the try, the rejection skipped the catch and the finally
   * entirely: no message, no test count, the webpack server left listening, and
   * an unhandled rejection killed the process. The run looked like a silent
   * disappearance rather than a failure to start a browser.
   */
  let browser = null;
  try {
    console.log(`browser: ${findChrome()}\n`);
    browser = await launch();
    const page = await browser.newPage();
    page.on('console', onConsole);
    page.on('pageerror', console.log.bind(console));
    await page.setDefaultNavigationTimeout(120000);
    await page.goto(`http://127.0.0.1:${server.address().port}/test`);
    /*
     * Generous, and the reason is stated rather than the number just being
     * raised: this waits for a development webpack build plus the whole suite in
     * the page, and both scale with how loaded the machine is. At 15s it expired
     * on a busy run and was reported as a timeout with nothing to suggest the
     * build was still going.
     */
    await page.waitFor(() => typeof runner.testResults !== 'undefined', {
      polling: 1000,
      timeout: 180000
    });
    const results = await page.evaluate(() => runner.testResults);
    const coverage = await page.evaluate(() => __coverage__);
    if (coverage) {
      const dir = path.resolve(__dirname, '../../.nyc_output');
      fs.mkdirSync(dir, {
        recursive: true
      });
      fs.writeFileSync(
        path.resolve(dir, 'frontend.json'),
        JSON.stringify(coverage)
      );
    }
    const stats = results.stats;
    const loadFailures = await page.evaluate(
      () => window.__suiteLoadFailures || []
    );
    exitCode = stats.failures + loadFailures.length;
    console.log(`${stats.passes} passing (${stats.duration}ms)\n`);
    if (loadFailures.length) {
      console.log(`Files that could not load (${loadFailures.length}):\n`);
      for (const f of loadFailures) {
        console.log(`  ${f.file}: ${f.message}\n`);
      }
    }
    if (stats.failures) {
      console.log('Failures:\n');
      for (const f of results.failures) {
        console.log(`${f.fullTitle}`);
        console.log(` ${f.err.stack}\n`);
      }
    }
  } catch (e) {
    console.log(`frontend suite could not run: ${(e && e.stack) || e}\n`);
    exitCode = 1;
  } finally {
    /*
     * Both of these are awaited. Left unawaited, the process could exit while
     * Chrome was still up, stranding its helper processes; the next run then
     * inherited a crowded machine and could fail to launch at all. server.close
     * also only stops new connections, so this needs the callback form to know
     * when the listener is actually gone.
     */
    if (browser) {
      await browser.close();
    }
    await new Promise(resolve => server.close(resolve));
    process.exit(exitCode);
  }
});
