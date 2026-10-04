#!/usr/bin/env node
/*
 * G3: FXA_REQUIRED is a real, enforced config key, and only then.
 *
 * The bug this guards: `fxa_required` was read by auth.js and ws.js but never
 * declared in the convict schema, so convict ignored FXA_REQUIRED entirely and
 * `config.fxa_required` was always undefined. An operator could set
 * FXA_REQUIRED=true and still serve unauthenticated uploads.
 *
 * This proves both polarities, because a check that only shows the deny path
 * would also pass if the route were simply broken:
 *   1. FXA_REQUIRED=true  -> an unauthenticated upload is refused
 *   2. FXA_REQUIRED=false -> the same upload is accepted
 * A check that cannot distinguish those two states would not be evidence.
 */

process.env.NODE_ENV = 'production';
process.env.LOG_LEVEL = 'error';

import { assert, measured, ok, require } from './lib.mjs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const REPO = process.cwd();

function runUploadScenario(fxaRequired) {
  /* Each scenario runs in a fresh process: server/config.js is a singleton
   * that resolves the environment once at require time. */
  const child = spawnSync(
    process.execPath,
    [path.join(REPO, 'scripts/verify/_fxa-child.cjs')],
    {
      cwd: REPO,
      encoding: 'utf8',
      env: {
        ...process.env,
        FXA_REQUIRED: fxaRequired ? 'true' : 'false',
        REDIS_HOST: process.env.REDIS_HOST || '127.0.0.1',
        REDIS_PORT: process.env.REDIS_PORT || '6379'
      }
    }
  );
  const out = (child.stdout || '') + (child.stderr || '');
  const line = out
    .split('\n')
    .reverse()
    .find(l => l.startsWith('RESULT '));
  if (!line) {
    throw new Error(
      `scenario FXA_REQUIRED=${fxaRequired} produced no result:\n${out}`
    );
  }
  return JSON.parse(line.slice('RESULT '.length));
}

try {
  const config = require('../../server/config');
  assert.equal(
    typeof config.fxa_required,
    'boolean',
    'config.fxa_required must be a declared boolean, got ' +
      typeof config.fxa_required
  );
  measured('config.fxa_required declared', typeof config.fxa_required);

  const denied = runUploadScenario(true);
  measured('FXA_REQUIRED=true  -> config value', denied.configValue);
  measured('FXA_REQUIRED=true  -> upload status', denied.status);

  const allowed = runUploadScenario(false);
  measured('FXA_REQUIRED=false -> config value', allowed.configValue);
  measured('FXA_REQUIRED=false -> upload status', allowed.status);

  /* Negative control: the harness must be able to see both outcomes. If the
   * deny and allow states were indistinguishable, these assertions could not
   * both hold and the gate would be measuring nothing. */
  assert.equal(
    denied.configValue,
    true,
    'FXA_REQUIRED=true must be visible to the config singleton'
  );
  assert.equal(
    allowed.configValue,
    false,
    'FXA_REQUIRED=false must be visible to the config singleton'
  );
  assert.equal(
    denied.status,
    401,
    'with FXA_REQUIRED=true an unauthenticated upload must be refused with 401, got ' +
      denied.status
  );
  assert.notEqual(
    allowed.status,
    401,
    'with FXA_REQUIRED=false the same upload must not be refused, got 401 — ' +
      'the deny check above would prove nothing if both paths refused'
  );
  assert.equal(
    allowed.status,
    200,
    'with FXA_REQUIRED=false an upload must succeed, got ' + allowed.status
  );

  ok('FXA REQUIRED BEHAVIOUR VERIFIED');
} catch (err) {
  process.stderr.write(`  ${(err && err.stack) || err}\n`);
  process.exit(1);
}
