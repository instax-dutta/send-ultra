const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const stat = promisify(fs.stat);
const unlink = promisify(fs.unlink);

class FSStorage {
  constructor(config, log) {
    this.log = log;
    this.dir = config.file_dir;
    fs.mkdirSync(this.dir, {
      recursive: true
    });
  }

  async length(id) {
    const result = await stat(path.join(this.dir, id));
    return result.size;
  }

  getStream(id) {
    return fs.createReadStream(path.join(this.dir, id));
  }

  set(id, file) {
    return new Promise((resolve, reject) => {
      const filepath = path.join(this.dir, id);
      const fstream = fs.createWriteStream(filepath);
      file.pipe(fstream);
      file.on('error', err => {
        fstream.destroy(err);
      });
      fstream.on('error', err => {
        // unlinkSync could itself throw and would block the event loop.
        unlink(filepath).catch(() => {});
        reject(err);
      });
      fstream.on('finish', resolve);
    });
  }

  async del(id) {
    try {
      await unlink(path.join(this.dir, id));
    } catch (e) {
      // A missing or already-removed object is the desired end state, so it is
      // not an error. Anything else is.
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') {
        throw e;
      }
    }
  }

  ping() {
    return Promise.resolve();
  }
}

module.exports = FSStorage;
