#!/usr/bin/env node
/*
 * Syncs the current working tree to a remote host and runs one command there.
 *
 * Gates use this so that "verified on the remote host" means the remote is
 * running the same bytes as the local tree, not a stale checkout.
 *
 * Configuration (environment):
 *   SEND_SSH_HOST   required, e.g. 13.223.86.129
 *   SEND_SSH_USER   required, e.g. admin
 *   SEND_SSH_KEY    required, path to the private key
 *   SEND_SSH_PORT   optional, ssh port (default 22)
 *   SEND_REMOTE_DIR optional, remote work directory
 *   SEND_NO_SYNC    optional, set to 1 to skip the upload
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/*
 * Connection settings come from the environment first, then from
 * ~/.send-verify.json. The file exists so the gate ledger can run without every
 * caller exporting variables, and it lives outside the repository because the
 * private key path is machine specific.
 */
function loadSettings() {
  let fromFile = {};
  const settingsFile =
    process.env.SEND_VERIFY_CONFIG ||
    path.join(os.homedir(), '.send-verify.json');
  if (fs.existsSync(settingsFile)) {
    try {
      fromFile = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    } catch (e) {
      process.stderr.write(
        `remote-run: could not parse ${settingsFile}: ${e.message}\n`
      );
    }
  }
  const pick = (env, fileKey, fallback) =>
    process.env[env] || fromFile[fileKey] || fallback;
  return {
    host: pick('SEND_SSH_HOST', 'host'),
    user: pick('SEND_SSH_USER', 'user', 'admin'),
    key: pick('SEND_SSH_KEY', 'key'),
    port: pick('SEND_SSH_PORT', 'port', '22'),
    remoteDir: pick('SEND_REMOTE_DIR', 'remoteDir', '/home/admin/send-verify'),
    redisPort: pick('SEND_REDIS_PORT', 'redisPort', '6399'),
    skipPrep:
      process.env.SEND_SKIP_PREPARE === '1' || fromFile.skipPrep === true
  };
}

const settings = loadSettings();
const {
  host: HOST,
  user: USER,
  key: KEY,
  port: PORT,
  redisPort: REDIS_PORT
} = settings;
/*
 * Pass the caller's SEND_* knobs through to the remote command.
 *
 * A CHECK line is meant to be self-contained, so `SEND_UNIT=... node
 * scripts/verify/remote-run.mjs ...` has to mean something on the far side.
 * Only the connection and bootstrap variables are held back: they describe how
 * to reach this host and would be meaningless, and in the case of a local key
 * path actively misleading, once they land on a Linux box.
 */
/*
 * Refuse to run on the verify host.
 *
 * `npm test` is a glob over test:*, so a remote variant named test:something
 * becomes part of it, and the suite re-enters itself where there is no SSH
 * config to read -- an error about a missing host, raised on the machine doing
 * the running, pointing at the wrong process entirely. The marker is set on
 * every forwarded command, so this catches that class of mistake whatever it is
 * called rather than only the case that has already happened once.
 */
if (process.env.SEND_ON_VERIFY_HOST) {
  console.error(
    'remote-run: already on the verify host, refusing to nest.\n' +
      '  This usually means a remote variant of a suite was named so that a\n' +
      '  glob like test:* picked it up and it invoked itself.\n'
  );
  process.exit(2);
}

const NOT_FORWARDED = new Set([
  'SEND_SSH_HOST',
  'SEND_SSH_USER',
  'SEND_SSH_KEY',
  'SEND_SSH_PORT',
  'SEND_REMOTE_DIR',
  'SEND_REMOTE_REDIS_DIR',
  'SEND_NO_SYNC',
  'SEND_SKIP_PREPARE',
  'SEND_VERIFY_CONFIG',
  'SEND_ON_VERIFY_HOST'
]);

function forwardedEnv() {
  const parts = [];
  for (const [key, value] of Object.entries(process.env)) {
    if (!key.startsWith('SEND_') || NOT_FORWARDED.has(key) || !value) {
      continue;
    }
    // Single-quoted so a value with spaces, as paths here often have, survives
    // the shell on the far side intact.
    parts.push(`${key}='${value.replace(/'/g, "'\\''")}'`);
  }
  /*
   * No trailing newline, and this must be interpolated as a prefix on the same
   * line as the command. Emitted on a line of its own it looks equivalent and
   * is not: `VAR=x` alone sets a shell variable without exporting it, so the
   * command on the next line starts with no such variable in its environment.
   */
  return parts.join(' ');
}

const REMOTE_DIR = settings.remoteDir;
const REMOTE_REDIS_DIR =
  process.env.SEND_REMOTE_REDIS_DIR ||
  `${path.dirname(REMOTE_DIR)}/send-verify-redis`;
const REPO = process.cwd();

const EXCLUDES = [
  'node_modules',
  '.git',
  'dist',
  '.nyc_output',
  'coverage',
  '.codebase-memory',
  '.unlazy',
  /*
   * A Chrome installed locally for the browser-driven suites. It is a large
   * platform-specific binary: syncing it uploads a macOS build to a Linux host,
   * where the frontend suite then finds it, tries to execute it, and fails with
   * a shell syntax error instead of running anything. The remote installs its own
   * browser, or uses the Chromium that arrives with its npm install.
   */
  'chrome',
  // Runtime state that belongs to the deployment, not to the source tree.
  // Losing .env would take the service down on the next sync.
  '.env',
  'app.log',
  // macOS resource-fork sidecars and Finder metadata. They are not valid SVGs
  // and break the webpack asset pipeline on Linux.
  '._*',
  '.DS_Store'
];

function fail(msg) {
  process.stderr.write(`remote-run: ${msg}\n`);
  process.exit(2);
}

function sshArgs(command) {
  /*
   * `-i` is only supplied when a key is actually configured. Some hosts are
   * reached over Tailscale SSH, which authenticates against the tailnet and has
   * no private key at all; passing an empty -i there makes ssh fail before it
   * ever tries.
   */
  const identity = KEY ? ['-i', KEY] : [];
  return [
    'ssh',
    ...identity,
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'LogLevel=ERROR',
    '-p',
    PORT,
    `${USER}@${HOST}`,
    command
  ];
}

function run(args, { input } = {}) {
  return new Promise(resolve => {
    const child = spawn(args[0], args.slice(1), {
      stdio:
        input === undefined
          ? ['ignore', 'inherit', 'inherit']
          : ['pipe', 'inherit', 'inherit']
    });
    if (input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.end(input);
    }
    child.on('error', err =>
      fail(`${args[0]} failed to start: ${err.message}`)
    );
    child.on('close', code => resolve(code === null ? 1 : code));
  });
}

/* Tar the working tree and untar it on the remote, overwriting in place. */
async function sync() {
  // bsdtar (macOS) stamps xattrs the remote GNU tar cannot read. Drop them;
  // GNU tar does not know this flag, so gate it on the local platform.
  const tarArgs = [];
  if (process.platform === 'darwin') {
    tarArgs.push('--no-mac-metadata');
  }
  tarArgs.push('-cf', '-', '--exclude=*/.git');
  for (const dir of EXCLUDES) {
    tarArgs.push(`--exclude=${dir}`);
  }
  // bsdtar writes AppleDouble sidecars as ._name beside each file. Match both
  // the top level and nested levels.
  tarArgs.push('--exclude=._*', '--exclude=*/._*');
  // bsdtar requires an explicit path; GNU tar accepts it too.
  tarArgs.push('.');

  const tar = spawn('tar', tarArgs, {
    cwd: REPO,
    stdio: ['ignore', 'pipe', 'inherit']
  });

  const chunks = [];
  tar.stdout.on('data', c => chunks.push(c));
  tar.on('error', err => fail(`tar failed to start: ${err.message}`));

  const archive = await new Promise((resolve, reject) => {
    tar.on('close', code =>
      code === 0
        ? resolve(Buffer.concat(chunks))
        : reject(new Error(`tar exited ${code}`))
    );
    tar.on('error', reject);
  });

  // Extracting over a dirty tree leaves deleted files behind, and a stale
  // file is worse than no file here (a leftover macOS sidecar once broke the
  // SVG pipeline). Clear the work directory first, but keep node_modules and
  // dist so an install or a build is not repeated on every run.
  /*
 * Clear the work directory before extracting, or a file deleted locally would
 * linger on the remote and a stale file is worse than no file (a leftover macOS
 * sidecar once broke the SVG pipeline). Installs and builds are expensive, so
 * node_modules and dist are kept, as is any deployment runtime state.
 */
const KEEP = ['node_modules', 'dist', '.env', 'app.log']
  .map(name => `! -name ${name}`)
  .join(' ');
const clean = `mkdir -p ${REMOTE_DIR} && find ${REMOTE_DIR} -mindepth 1 -maxdepth 1 ${KEEP} -exec rm -rf {} +`;

  // --warning=no-unknown-keyword silences the remote GNU tar complaining about
  // xattr extended headers that bsdtar wrote. Real tar errors still surface.
  const code = await run(
    sshArgs(
      `${clean} && tar --warning=no-unknown-keyword -xf - -C ${REMOTE_DIR}`
    ),
    { input: archive }
  );
  if (code !== 0) {
    fail(`remote untar exited ${code}`);
  }
  process.stderr.write(`remote-run: synced to ${USER}@${HOST}:${REMOTE_DIR}\n`);
}

async function main() {
  const command = process.argv.slice(2).join(' ');
  if (!command) {
    fail('usage: remote-run.mjs <command>');
  }
  // No SEND_SSH_KEY in this list: it is optional, for Tailscale SSH.
  for (const [name, value] of Object.entries({
    SEND_SSH_HOST: HOST,
    SEND_SSH_USER: USER
  })) {
    if (!value) {
      fail(`${name} is not set`);
    }
  }
  if (KEY && !fs.existsSync(KEY)) {
    fail(`private key not found: ${KEY}`);
  }
  if (process.env.SEND_NO_SYNC !== '1') {
    await sync();
  }

  /*
   * A verifier needs a real Redis and a build present. Provisioning them here
   * keeps each CHECK a single command. Both steps are idempotent so a rerun is
   * cheap, and they are separated by newlines rather than `&&` because starting
   * redis in the background must not detach the rest of the script.
   */
  const redisPort = REDIS_PORT;
  /*
   * LC_ALL=C for the whole remote script.
   *
   * ssh without a login shell does not set LANG or LC_ALL, and redis 8 refuses
   * to start when it cannot configure a locale: "Failed to configure LOCALE for
   * invalid locale name". It exits before binding, so the readiness probe below
   * reports "redis did not start" and the cause is not visible anywhere. systemd
   * does supply an environment, which is why the deployed instance never hit this.
   */
  const env = 'export LC_ALL=C LANG=C';
  const script = settings.skipPrep
    ? `cd ${REMOTE_DIR}\n`
    : [
        env,
        `cd ${REMOTE_DIR}`,
        `mkdir -p ${REMOTE_REDIS_DIR}`,
        `if ! redis-cli -p ${redisPort} ping >/dev/null 2>&1; then`,
        `  nohup redis-server --port ${redisPort} --bind 127.0.0.1 --dir ${REMOTE_REDIS_DIR} --save '' --appendonly no >${REMOTE_REDIS_DIR}/redis.log 2>&1 &`,
        `fi`,
        `for i in $(seq 1 40); do redis-cli -p ${redisPort} ping >/dev/null 2>&1 && break; sleep 0.25; done`,
        `redis-cli -p ${redisPort} ping >/dev/null 2>&1 || { echo "prepare: redis did not start on ${redisPort}"; exit 1; }`,
        `if [ ! -f dist/manifest.json ]; then npm run build >/dev/null 2>&1 || { echo "prepare: build failed"; exit 1; }; fi`,
        `echo "prepare: redis ${redisPort} up, dist present"`
      ].join('\n') +
      `\n${env}\nSEND_ON_VERIFY_HOST=1 REDIS_HOST=127.0.0.1 REDIS_PORT=${redisPort} ${forwardedEnv()} ${command}\n`;

  const code = await run(sshArgs(script));
  process.exit(code);
}

main().catch(err => fail(err && err.stack ? err.stack : String(err)));
