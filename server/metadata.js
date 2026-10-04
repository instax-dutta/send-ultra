class Metadata {
  constructor(obj) {
    this.dl = +obj.dl || 0;
    this.dlimit = +obj.dlimit || 1;
    this.pwd = String(obj.pwd) === 'true';
    this.owner = obj.owner;
    this.metadata = obj.metadata;
    this.auth = obj.auth;
    this.nonce = obj.nonce;
    // Storage prefix, carried so a download can resolve its object without
    // asking Redis for the prefix a second time.
    this.prefix = obj.prefix;
  }
}

module.exports = Metadata;
