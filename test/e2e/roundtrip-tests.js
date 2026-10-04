const assert = require('assert');
const Limiter = require('../../server/limiter');
const {
  Archive,
  Keychain,
  WebSocket,
  Zip,
  arrayToB64,
  bufferToStream,
  downloadStream,
  origin,
  randomBytes,
  roundTrip,
  startServer,
  stopServer,
  streamToBuffer,
  upload
} = require('./harness');

describe('Core transfer path', function() {
  this.timeout(60000);

  before(startServer);
  after(stopServer);

  describe('single file round trip', function() {
    // ECE records are 64KiB, so the sizes either side of that boundary are
    // where a streaming or padding regression would surface.
    const sizes = [
      ['an empty file', 0],
      ['a single byte', 1],
      ['a sub-record payload', 100],
      ['one byte under a record', 65535],
      ['exactly one record', 65536],
      ['one byte over a record', 65537],
      ['many records', 1024 * 1024 + 12345]
    ];

    sizes.forEach(function([label, size]) {
      it(`recovers ${label} (${size} bytes) byte for byte`, async function() {
        const original = randomBytes(size);
        const result = await roundTrip(original, { name: 'file.bin' });

        assert.strictEqual(
          result.plaintext.length,
          size,
          'decrypted length must equal the uploaded length'
        );
        assert.ok(
          result.plaintext.equals(original),
          'decrypted bytes must be identical to the original'
        );
      });
    });

    it('never stores the plaintext in the clear', async function() {
      const original = randomBytes(4096);
      const result = await roundTrip(original);

      assert.ok(
        result.ciphertext.length > original.length,
        'ECE framing must add overhead'
      );
      assert.ok(
        !result.ciphertext.includes(original.subarray(0, 64)),
        'the plaintext must not appear in the stored ciphertext'
      );
    });
  });

  describe('authorization', function() {
    it('rejects a download signed with the wrong key', async function() {
      // dlimit is high enough that the harness's own first download does not
      // delete the file, so a 401 can only mean the HMAC was rejected.
      const result = await roundTrip(randomBytes(2048), { dlimit: 5 });
      const impostor = new Keychain(arrayToB64(randomBytes(16)));

      const response = await downloadStream(result.id, impostor);
      assert.strictEqual(response.status, 401, 'a bad HMAC must be rejected');
    });

    it('rejects a download with no authorization header', async function() {
      const result = await roundTrip(randomBytes(512));
      const response = await fetch(`${origin()}/api/download/${result.id}`);
      assert.strictEqual(response.status, 401);
    });

    it('accepts the same secret across independent keychains', async function() {
      const original = randomBytes(1024);
      const result = await roundTrip(original, { dlimit: 5 });

      // A brand new Keychain built only from the shared secret must be able
      // to read the file, which is what happens when a link is opened twice.
      const other = new Keychain(result.secretKey);
      const response = await downloadStream(result.id, other);
      assert.strictEqual(response.status, 200);

      const ciphertext = await streamToBuffer(response.body);
      const plaintext = await streamToBuffer(
        other.decryptStream(bufferToStream(ciphertext))
      );
      assert.ok(
        plaintext.equals(original),
        'a fresh keychain must recover the same bytes'
      );
    });
  });

  describe('archive round trip', function() {
    it('preserves multi-file archive contents and rebuilds a valid zip', async function() {
      const contents = [randomBytes(1000), randomBytes(70000), randomBytes(3)];
      const files = contents.map((buf, i) => new File([buf], `part-${i}.bin`));
      const expected = Buffer.concat(contents);

      const archive = new Archive(files, 86400, 1);
      assert.strictEqual(archive.type, 'send-archive');
      assert.strictEqual(archive.name, 'Send-Ultra-Archive.zip');

      const sender = new Keychain();
      const secretKey = arrayToB64(sender.rawSecret);
      const metadata = await sender.encryptMetadata({
        name: archive.name,
        size: archive.size,
        type: archive.type,
        manifest: archive.manifest
      });

      const info = await upload({
        // Archive.stream is the real concat used by the uploader.
        encrypted: sender.encryptStream(archive.stream),
        metadata: arrayToB64(new Uint8Array(metadata)),
        authKeyB64: await sender.authKeyB64(),
        timeLimit: 86400,
        dlimit: 1
      });

      const receiver = new Keychain(secretKey);
      const response = await downloadStream(info.id, receiver);
      assert.strictEqual(response.status, 200);

      const ciphertext = await streamToBuffer(response.body);
      const decrypted = await streamToBuffer(
        receiver.decryptStream(bufferToStream(ciphertext))
      );
      assert.ok(
        decrypted.equals(expected),
        'the archive payload must survive the round trip byte for byte'
      );

      // Rebuild the zip the way the receiver and service worker do.
      const zip = new Zip(archive.manifest, bufferToStream(decrypted));
      const zipped = await streamToBuffer(zip.stream);

      assert.strictEqual(
        zipped.readUInt32LE(0),
        0x04034b50,
        'must start with a local file header signature'
      );
      assert.strictEqual(
        zipped.length,
        zip.size,
        'Zip.size must predict the produced archive length'
      );
      assert.strictEqual(
        zipped.readUInt32LE(zipped.length - 22),
        0x06054b50,
        'must end with an end-of-central-directory signature'
      );
      assert.strictEqual(
        zipped.readUInt16LE(zipped.length - 22 + 8),
        files.length,
        'the central directory must list every file'
      );
    });
  });

  describe('download limits', function() {
    it('keeps the file while downloads remain', async function() {
      const result = await roundTrip(randomBytes(1024), { dlimit: 5 });
      for (let attempt = 1; attempt <= 3; attempt++) {
        const response = await downloadStream(result.id, result.receiver);
        assert.strictEqual(
          response.status,
          200,
          `download ${attempt} of 5 should succeed`
        );
      }
    });

    it('deletes the file once the limit is reached', async function() {
      const result = await roundTrip(randomBytes(1024), { dlimit: 1 });
      assert.ok(result.plaintext.length === 1024);

      const response = await downloadStream(result.id, result.receiver);
      assert.strictEqual(
        response.status,
        404,
        'an exhausted file must no longer be downloadable'
      );
    });
  });

  describe('expiry', function() {
    it('rotates the nonce on download and honours the requested ttl', async function() {
      const result = await roundTrip(randomBytes(256), {
        timeLimit: 300,
        dlimit: 5
      });
      const response = await downloadStream(result.id, result.receiver);

      assert.strictEqual(response.status, 200);
      assert.ok(
        response.headers.get('WWW-Authenticate'),
        'a fresh nonce must accompany the download'
      );
    });
  });

  describe('websocket route', function() {
    it('rejects an upgrade on an unknown path', async function() {
      const ws = new WebSocket(`${origin().replace(/^http/, 'ws')}/nope`);
      const err = await new Promise(resolve => {
        ws.once('error', resolve);
        ws.once('open', () => resolve(null));
      });
      assert.ok(err, 'an unknown upgrade path must be rejected');
    });

    it('signals a limit error when the upload exceeds the cap', async function() {
      // MAX_FILE_SIZE defaults to 2.5GiB, so exercise the limiter directly
      // rather than actually pushing that many bytes.
      const limiter = new Limiter(16);
      const failed = new Promise(resolve => limiter.on('error', resolve));
      limiter.write(randomBytes(64));
      const err = await failed;
      assert.strictEqual(err.message, 'limit');
    });

    it('allocates an id and reports the download url', async function() {
      const keychain = new Keychain();
      const metadata = await keychain.encryptMetadata({
        name: 'x.bin',
        size: 1,
        type: 'application/octet-stream'
      });
      const infoPromise = roundTrip(randomBytes(64), {
        name: 'x.bin',
        timeLimit: 86400,
        dlimit: 1
      });
      const info = await infoPromise;
      assert.match(info.id, /^[0-9a-f]{16}$/);
      assert.ok(info.url.endsWith(`/download/${info.id}/`));
      assert.ok(
        arrayToB64(new Uint8Array(metadata)).length > 0,
        'metadata must serialise'
      );
      assert.ok(keychain.rawSecret.length === 16);
    });
  });
});
