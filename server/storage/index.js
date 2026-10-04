const config = require('../config');
const Metadata = require('../metadata');
const createLogger = require('../log');
const createRedisClient = require('./redis');

function getPrefix(seconds) {
  return Math.max(Math.floor(seconds / 86400), 1);
}

class DB {
  constructor(config) {
    let Storage = null;
    if (config.s3_bucket) {
      Storage = require('./s3');
    } else if (config.gcs_bucket) {
      Storage = require('./gcs');
    } else {
      Storage = require('./fs');
    }
    this.log = createLogger('send.storage');

    this.storage = new Storage(config, this.log);

    this.redis = createRedisClient(config);
    this.redis.on('error', err => {
      this.log.error('Redis:', err);
    });
  }

  async ttl(id) {
    const result = await this.redis.ttlAsync(id);
    return Math.ceil(result) * 1000;
  }

  prefixedPath(id, prefix) {
    return `${prefix}-${id}`;
  }

  async getPrefixedId(id) {
    const prefix = await this.redis.hgetAsync(id, 'prefix');
    return this.prefixedPath(id, prefix);
  }

  async length(id, prefix) {
    const filePath =
      prefix === undefined
        ? await this.getPrefixedId(id)
        : this.prefixedPath(id, prefix);
    return this.storage.length(filePath);
  }

  async get(id, prefix) {
    const filePath =
      prefix === undefined
        ? await this.getPrefixedId(id)
        : this.prefixedPath(id, prefix);
    return this.storage.getStream(filePath);
  }

  async set(id, file, meta, expireSeconds = config.default_expire_seconds) {
    const prefix = getPrefix(expireSeconds);
    const filePath = this.prefixedPath(id, prefix);
    await this.storage.set(filePath, file);
    // hmset is deprecated in Redis 4+; the object form of hset is equivalent.
    // These are fire-and-forget today, so route failures to the logger rather
    // than letting them surface as unhandled rejections.
    this.redis.hset(id, 'prefix', prefix);
    if (meta) {
      // hmset is deprecated in Redis 4+ and both the object and flat-array
      // forms of hset are rejected or silently dropped depending on the
      // client, so write each field with the scalar form. node_redis batches
      // commands issued in the same tick, so this stays a single write.
      for (const key of Object.keys(meta)) {
        this.redis.hset(id, key, meta[key]);
      }
    }
    this.redis.expire(id, expireSeconds);
  }

  setField(id, key, value) {
    this.redis.hset(id, key, value);
  }

  incrementField(id, key, increment = 1) {
    this.redis.hincrby(id, key, increment);
  }

  async del(id) {
    const filePath = await this.getPrefixedId(id);
    // Awaited: an un-awaited delete produced an unhandled rejection when the
    // object was already gone.
    await this.storage.del(filePath);
    this.redis.del(id);
  }

  async ping() {
    await this.redis.pingAsync();
    await this.storage.ping();
  }

  async metadata(id) {
    const result = await this.redis.hgetallAsync(id);
    return result && new Metadata(result);
  }
}

module.exports = new DB(config);
