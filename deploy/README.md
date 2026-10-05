# Deploying Send Ultra

Everything needed to run this on a fresh Linux server. The files here are the ones
the running deployment actually uses, not a sketch of them.

If you would rather follow the original upstream instructions, they are still in
[../docs/deployment.md](../docs/deployment.md). That one uses Apache and a
`nohup` background process, which does not survive a reboot. Prefer what follows.

## Layout

```
/opt/send-ultra            the checkout
/opt/send-ultra/.env       configuration, from env.example
/opt/send-ultra-data/files ciphertext, outside the checkout on purpose
/var/lib/send-ultra-redis  Redis data
```

Ciphertext lives outside the checkout so that a redeploy cannot overwrite or
remove it, and so the systemd unit can be granted write access to exactly one
directory.

## Prerequisites

```bash
sudo apt install git nodejs npm redis-server
```

Redis must be the *system* package. Send needs `redis-server` on `PATH` only for
its own test suites, which locate it at runtime; the service itself talks to
whatever `REDIS_PORT` points at.

To run the browser-driven suites on this host rather than on your machine, the
bundled Chromium also needs three libraries:

```bash
sudo apt install libxcursor1 libxss1 libgtk-3-0t64
```

## Steps

```bash
# 1. A service user that is not root.
sudo useradd --system --home /opt/send-ultra --shell /usr/sbin/nologin send
sudo mkdir -p /opt/send-ultra-data/files
sudo chown -R send:send /opt/send-ultra-data

# 2. The checkout.
sudo git clone https://github.com/instax-dutta/send-ultra /opt/send-ultra
sudo chown -R send:send /opt/send-ultra
cd /opt/send-ultra
sudo -u send npm ci
sudo -u send npm run build

# 3. Configuration.
sudo cp deploy/env.example .env
sudo -u send nano .env          # BASE_URL at minimum, and FILE_DIR
```

Redis, on its own port with its own data directory:

```bash
sudo install -d -o redis -g redis /var/lib/send-ultra-redis
sudo install -d -o redis -g redis /var/log/redis
sudo cp deploy/redis/send-ultra.conf /etc/redis/send-ultra.conf
```

Then the units:

```bash
sudo cp deploy/systemd/*.service deploy/systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now send-ultra-redis
sudo systemctl enable --now send-ultra
sudo systemctl enable --now send-ultra-reap.timer
```

Check it came up:

```bash
systemctl is-active send-ultra send-ultra-redis send-ultra-reap.timer
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:18100/
```

`PORT` in `.env` is the loopback port Send binds. Put a reverse proxy or a
Cloudflare tunnel in front of it; nothing here should face the internet directly,
and nothing serves TLS on its own.

## Enabling the AOF on an instance that already has data

Skip this on a fresh install, where `deploy/redis/send-ultra.conf` is read from
the start. It matters when moving an existing RDB-only Redis onto the AOF.

**Turn it on against the running instance, not by editing the file and
restarting.** With `appendonly yes` in the config and no AOF present, Redis
creates an *empty* AOF base and does not load the RDB, so the dataset is silently
gone after the restart:

```bash
redis-cli -p 18101 config set appendonly yes   # rewrites the AOF base from memory
redis-cli -p 18101 config get appendonly       # expect: appendonly yes
redis-cli -p 18101 dbsize                      # must be unchanged
sudo systemctl restart send-ultra-redis
redis-cli -p 18101 dbsize                      # must still be unchanged
```

Check that last number. Nothing prints an error when this goes wrong.

## Two things that will bite otherwise

**Rate limiting.** There is none, in the app or by default at the edge. Every
upload may be `MAX_FILE_SIZE`, so a single script can fill the disk. On
Cloudflare, add a rate limiting rule on the URI path starting `/api/upload`; it
costs nothing and needs no application change.

**Redis is the only record that a file exists.** The server holds ciphertext it
cannot read, and the metadata that maps a link to that ciphertext is a Redis key.
If Redis is lost, every link 404s while its bytes sit on disk. Hence a dedicated
instance, the AOF, and `noeviction`.

## Verifying a deployment

The ledger in [../GATES.md](../GATES.md) checks a running instance end to end.
It runs over SSH against a configured host:

```bash
cp ~/.send-verify.json.example ~/.send-verify.json   # edit host and user
node scripts/verify/remote-run.mjs 'echo ok'
```

The full test suite runs the same way, which is why nothing needs to be installed
on the machine doing the pushing:

```bash
npm run verify:remote
```

Omit `key` in that config for a host reached over Tailscale SSH, which needs no
private key.
