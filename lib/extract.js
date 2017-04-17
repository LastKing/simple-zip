/**
 * Created by toonew on 2017/4/17.
 */
module.exports = Extract;

const Parse = require('./parse');
const Writable = require('stream').Writable;
var path = require('path');
var inherits = require('util').inherits;

function Extract(opts) {
  var self = this;

  if (!(this instanceof Extract)) {
    return new Extract();
  }

  Writable.call(this);

  this._opts = opts || {verbose: false};

  this._parser = Parse(this._opts);
  this._parser.on('error', function (err) {
    self.emit('error', err);
  });


}

inherits(Extract, Writable);

Extract.prototype._write = function (chunk, encoding, callback) {
  if (this._parser.write(chunk)) {
    return callback();
  }

  return this._parser.once('drain', callback);
};






