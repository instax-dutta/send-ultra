import assert from 'assert';
import Archive from '../../../app/archive';
import FileSender from '../../../app/fileSender';
import FileReceiver from '../../../app/fileReceiver';

const headless = /Headless/.test(navigator.userAgent);
// TODO: save on headless doesn't work as it used to since it now
// follows a link instead of fetch. Maybe there's a way to make it
// work? For now always set noSave.
const options = { noSave: true || !headless, stream: true }; // only run the saveFile code if headless

// FileSender uses a File in real life but a Blob works for testing
const blob = new Blob([new ArrayBuffer(1024 * 128)], { type: 'text/plain' });
blob.name = 'test.txt';
const archive = new Archive([blob]);

/*
 * A payload large enough for a cancel to land mid-transfer.
 *
 * The server only counts a download once the response finishes, and it
 * deliberately skips the count when the request is aborted, so "a cancelled
 * download does not consume a download" is real behaviour worth asserting. At
 * 128KB the transfer completes inside a single tick on a fast machine: the
 * cancel is requested after every byte has already been sent and counted, and
 * the assertion then failed as "1 == 0" for reasons that had nothing to do with
 * cancellation. Only the cancellation tests use this one, so the rest of the
 * suite keeps the small blob.
 */
const cancelBlob = new Blob([new ArrayBuffer(1024 * 1024 * 12)], {
  type: 'text/plain'
});
cancelBlob.name = 'cancel.txt';
const cancelArchive = new Archive([cancelBlob]);

navigator.serviceWorker.register('/serviceWorker.js');

describe('Upload / Download flow', function() {
  this.timeout(0);
  it('can only download once by default', async function() {
    const fs = new FileSender();
    const file = await fs.upload(archive);
    const fr = new FileReceiver({
      secretKey: file.toJSON().secretKey,
      id: file.id,
      nonce: file.keychain.nonce,
      requiresPassword: false
    });
    await fr.getMetadata();
    await fr.download(options);

    try {
      await fr.download(options);
      assert.fail('downloaded again');
    } catch (e) {
      assert.equal(e.message, '404');
    }
  });

  it('downloads with the correct password', async function() {
    const fs = new FileSender();
    const file = await fs.upload(archive);
    await file.setPassword('magic');
    const fr = new FileReceiver({
      secretKey: file.toJSON().secretKey,
      id: file.id,
      url: file.url,
      nonce: file.keychain.nonce,
      requiresPassword: true,
      password: 'magic'
    });
    await fr.getMetadata();
    await fr.download(options);
    assert.equal(fr.state, 'complete');
  });

  it('blocks invalid passwords from downloading', async function() {
    const fs = new FileSender();
    const file = await fs.upload(archive);
    await file.setPassword('magic');
    const fr = new FileReceiver({
      secretKey: file.toJSON().secretKey,
      id: file.id,
      url: file.url,
      nonce: file.keychain.nonce,
      requiresPassword: true,
      password: 'password'
    });
    try {
      await fr.getMetadata();
      assert.fail('got metadata with bad password');
    } catch (e) {
      assert.equal(e.message, '401');
    }
    try {
      // We can't decrypt without IV from metadata
      // but let's try to download anyway
      await fr.download(options);
      assert.fail('downloaded file with bad password');
    } catch (e) {
      assert.equal(e.message, '401');
    }
  });

  it('retries a bad nonce', async function() {
    const fs = new FileSender();
    const file = await fs.upload(archive);
    const fr = new FileReceiver({
      secretKey: file.toJSON().secretKey,
      id: file.id,
      nonce: null, // oops
      requiresPassword: false
    });
    await fr.getMetadata();
    assert.equal(fr.fileInfo.name, archive.name);
  });

  it('can cancel the upload', async function() {
    const fs = new FileSender();
    const up = fs.upload(archive);
    fs.cancel(); // before encrypting
    try {
      await up;
      assert.fail('not cancelled 1');
    } catch (e) {
      assert.equal(e.message, '0');
    }
    fs.reset();
    fs.once('encrypting', () => fs.cancel());
    try {
      await fs.upload(archive);
      assert.fail('not cancelled 2');
    } catch (e) {
      assert.equal(e.message, '0');
    }
    fs.reset();
    fs.once('progress', () => fs.cancel());
    try {
      await fs.upload(archive);
      assert.fail('not cancelled 3');
    } catch (e) {
      assert.equal(e.message, '0');
    }
  });

  it('can cancel the download', async function() {
    const fs = new FileSender();
    const file = await fs.upload(cancelArchive);
    const fr = new FileReceiver({
      secretKey: file.toJSON().secretKey,
      id: file.id,
      nonce: file.keychain.nonce,
      requiresPassword: false
    });
    await fr.getMetadata();
    fr.once('progress', () => fr.cancel());

    // The rejection is collected rather than asserted inside a try block. An
    // `assert.fail('not cancelled')` written there is itself thrown inside the
    // try, so the catch swallows the very failure it exists to report.
    let error = null;
    try {
      await fr.download(options);
    } catch (e) {
      error = e;
    }
    assert.ok(error, 'download was not cancelled');
    assert.equal(error.message, '0');
  });

  it('can increase download count on download', async function() {
    this.timeout(0);
    const fs = new FileSender();
    const file = await fs.upload(archive);
    const fr = new FileReceiver({
      secretKey: file.toJSON().secretKey,
      id: file.id,
      nonce: file.keychain.nonce,
      requiresPassword: false
    });
    await fr.getMetadata();
    await fr.download(options);
    await file.updateDownloadCount();
    assert.equal(file.dtotal, 1);
  });

  it('does not increase download count when download cancelled', async function() {
    const fs = new FileSender();
    const file = await fs.upload(cancelArchive);
    const fr = new FileReceiver({
      secretKey: file.toJSON().secretKey,
      id: file.id,
      nonce: file.keychain.nonce,
      requiresPassword: false
    });
    await fr.getMetadata();
    fr.once('progress', () => fr.cancel());

    // Same shape as above, and for the same reason: a fail-fast assertion inside
    // the try would be caught here and reported as a download-count mismatch,
    // which reads like a server bug and sends the next reader to the wrong file.
    let error = null;
    try {
      await fr.download(options);
    } catch (e) {
      error = e;
    }
    assert.ok(error, 'download was not cancelled');
    assert.equal(error.message, '0');

    await file.updateDownloadCount();
    assert.equal(file.dtotal, 0);
  });

  it('can allow multiple downloads', async function() {
    const fs = new FileSender();
    const a = new Archive([blob]);
    a.dlimit = 2;
    const file = await fs.upload(a);
    const fr = new FileReceiver({
      secretKey: file.toJSON().secretKey,
      id: file.id,
      nonce: file.keychain.nonce,
      requiresPassword: false
    });
    await fr.getMetadata();
    await fr.download(options);
    await file.updateDownloadCount();
    assert.equal(file.dtotal, 1);

    await fr.download(options);
    await file.updateDownloadCount();
    assert.equal(file.dtotal, 2);
    try {
      await fr.download(options);
      assert.fail('downloaded too many times');
    } catch (e) {
      assert.equal(e.message, '404');
    }
  });

  it('can delete the file before download', async function() {
    const fs = new FileSender();
    const file = await fs.upload(archive);
    const fr = new FileReceiver({
      secretKey: file.toJSON().secretKey,
      id: file.id,
      nonce: file.keychain.nonce,
      requiresPassword: false
    });
    await file.del();
    try {
      await fr.getMetadata();
      assert.fail('file still exists');
    } catch (e) {
      assert.equal(e.message, '404');
    }
  });
});
