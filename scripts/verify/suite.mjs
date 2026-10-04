#!/usr/bin/env node
/*
 * G1 and G2: a suite runs on the remote host with zero failures.
 *
 * The suite is driven through mocha's JSON reporter rather than by grepping
 * human-readable output, so the gate does not depend on the reporter format or
 * on how many tests the suite happens to contain. A suite that crashed, timed
 * out, or failed to start reports no JSON and therefore fails.
 *
 * Usage: node scripts/verify/suite.mjs <e2e|backend>
 */

import { exec } from './lib.mjs';

const SUITES = {
  e2e: {
    token: 'E2E ROUNDTRIP SUITE PASSED',
    args: ['mocha', '--reporter', 'json', '--timeout', '60000', 'test/e2e']
  },
  backend: {
    token: 'BACKEND SUITE PASSED',
    args: ['mocha', '--reporter', 'json', 'test/backend']
  }
};

const which = process.argv[2];
const suite = SUITES[which];
if (!suite) {
  process.stderr.write(`usage: suite.mjs <${Object.keys(SUITES).join('|')}>\n`);
  process.exit(2);
}

const { code, stdout, out } = await exec('npx', suite.args, { env: process.env });

let report;
try {
  report = JSON.parse(stdout.slice(stdout.indexOf('{')));
} catch (e) {
  process.stderr.write(`  could not read a mocha JSON report (exit ${code}):\n`);
  process.stderr.write(`  ${out.slice(-2000)}\n`);
  process.exit(1);
}

const stats = report.stats || {};
process.stdout.write(
  `  suite ${which}: ${stats.passes} passing, ${stats.failures} failing, ` +
    `${stats.tests} tests, ${stats.duration}ms\n`
);

if (code !== 0) {
  process.stderr.write(`  mocha exited ${code}\n`);
  process.exit(1);
}
if (!(stats.passes > 0)) {
  process.stderr.write('  the suite reported no passing tests\n');
  process.exit(1);
}
if (stats.failures > 0) {
  for (const failure of (report.failures || []).slice(0, 5)) {
    process.stderr.write(`  FAIL ${failure.fullTitle}\n`);
  }
  process.exit(1);
}

process.stdout.write(`${suite.token}\n`);