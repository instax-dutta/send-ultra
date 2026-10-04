const { Transform } = require('stream');

class Limiter extends Transform {
  constructor(limit) {
    super();
    this.limit = limit;
    this.length = 0;
    this.exceeded = false;
  }

  _transform(chunk, encoding, callback) {
    this.length += chunk.length;
    if (this.length > this.limit) {
      // Stop before forwarding the chunk that busts the limit, and stop
      // accepting further ones so the source is not drained needlessly.
      this.exceeded = true;
      return callback(new Error('limit'));
    }
    this.push(chunk);
    callback();
  }
}

module.exports = Limiter;
