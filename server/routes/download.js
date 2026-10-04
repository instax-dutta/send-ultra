const storage = require('../storage');
const createLogger = require('../log');
const log = createLogger('send.download');

module.exports = async function(req, res) {
  const id = req.params.id;
  try {
    const meta = req.meta;
    // auth.hmac already loaded the metadata hash, which carries the storage
    // prefix. Reusing it here removes two Redis round trips per download.
    const prefix = meta.prefix;
    const contentLength = await storage.length(id, prefix);
    const fileStream = await storage.get(id, prefix);
    let cancelled = false;

    req.on('aborted', () => {
      cancelled = true;
      fileStream.destroy();
    });

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': contentLength
    });
    fileStream.pipe(res).on('finish', async () => {
      if (cancelled) {
        return;
      }

      const dl = meta.dl + 1;
      const dlimit = meta.dlimit;
      try {
        if (dl >= dlimit) {
          await storage.del(id);
        } else {
          await storage.incrementField(id, 'dl');
        }
      } catch (e) {
        log.info('StorageError:', id);
      }
    });
  } catch (e) {
    res.sendStatus(404);
  }
};
