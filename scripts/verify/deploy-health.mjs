#!/usr/bin/env node
/*
 * G14: the deployed service is managed, not hand-started.
 *
 * "Hosted" has to survive a reboot and a crash, so this restarts the unit and
 * requires it to come back and serve again on its own. A process launched by
 * hand from an ssh session would fail here, which is the point.
 *
 * Runs on the host, against the real systemd unit.
 *
 * The unit name and the health URL are parameters, because they differ per
 * deployment. They were previously hardcoded to `send-app` on port 80, which
 * only ever described one machine: on another host the service is a different
 * unit and port 80 belongs to the reverse proxy, so the gate checked the wrong
 * process and would have reported a healthy deployment as broken.
 */

import { exec, measured, ok } from './lib.mjs';

async function waitForHttp(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.status === 200) {
        await res.text();
        return true;
      }
    } catch (e) {
      // not up yet
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

const UNIT = process.env.SEND_UNIT || 'send-app';
const HEALTH_URL = process.env.SEND_HEALTH_URL || 'http://127.0.0.1/';
measured('unit', UNIT);
measured('health url', HEALTH_URL);

const before = await exec('systemctl', ['is-active', UNIT]);
measured(
  'service before restart',
  before.stdout.trim() || before.stderr.trim()
);
if (before.stdout.trim() !== 'active') {
  process.stderr.write(`  ${UNIT} is not active to begin with\n`);
  process.exit(1);
}

const restart = await exec('sudo', ['systemctl', 'restart', UNIT]);
if (restart.code !== 0) {
  process.stderr.write(`  restart failed: ${restart.out}\n`);
  process.exit(1);
}
measured('restart issued', 'ok');

const back = await waitForHttp(HEALTH_URL);
if (!back) {
  const status = await exec('systemctl', ['status', UNIT, '--no-pager']);
  process.stderr.write('  service did not serve again after a restart\n');
  process.stderr.write(`  ${status.out.slice(-800)}\n`);
  process.exit(1);
}
measured('serving after restart', 'yes');

const active = await exec('systemctl', ['is-active', UNIT]);
measured('service after restart', active.stdout.trim());
if (active.stdout.trim() !== 'active') {
  process.exit(1);
}

const enabled = await exec('systemctl', ['is-enabled', UNIT]);
measured('starts on boot', enabled.stdout.trim());
if (enabled.stdout.trim() !== 'enabled') {
  process.stderr.write(
    '  the unit is not enabled, so it would not survive a reboot\n'
  );
  process.exit(1);
}

ok('DEPLOYED SERVICE VERIFIED');
