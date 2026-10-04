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
  return [
    'ssh',
    '-i',
    KEY,
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
  for (const [name, value] of Object.entries({
    SEND_SSH_HOST: HOST,
    SEND_SSH_USER: USER,
    SEND_SSH_KEY: KEY
  })) {
    if (!value) {
      fail(`${name} is not set`);
    }
  }
  if (!fs.existsSync(KEY)) {
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
  const script = settings.skipPrep
    ? `cd ${REMOTE_DIR}\n`
    : [
        `cd ${REMOTE_DIR}`,
        `mkdir -p ${REMOTE_REDIS_DIR}`,
        `if ! redis-cli -p ${redisPort} ping >/dev/null 2>&1; then`,
        `  nohup redis-server --port ${redisPort} --bind 127.0.0.1 --dir ${REMOTE_REDIS_DIR} --save '' --appendonly no >${REMOTE_REDIS_DIR}/redis.log 2>&1 &`,
        `fi`,
        `for i in $(seq 1 40); do redis-cli -p ${redisPort} ping >/dev/null 2>&1 && break; sleep 0.25; done`,
        `redis-cli -p ${redisPort} ping >/dev/null 2>&1 || { echo "prepare: redis did not start on ${redisPort}"; exit 1; }`,
        `if [ ! -f dist/manifest.json ]; then npm run build >/dev/null 2>&1 || { echo "prepare: build failed"; exit 1; }; fi`,
        `echo "prepare: redis ${redisPort} up, dist present"`
      ].join('\n') + `\nREDIS_PORT=${redisPort} ${command}\n`;

  const code = await run(sshArgs(script));
  process.exit(code);
}

main().catch(err => fail(err && err.stack ? err.stack : String(err)));
