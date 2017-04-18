/**
 * Created by toonew on 2017/4/17.
 */
module.exports = Extract;

const Writable = require('stream').Writable;
const path = require('path');
const inherits = require('util').inherits;

const Writer = require('fstream').Writer;

const Parse = require('./parse');

function Extract(opts) {
  var self = this;

  if (!(this instanceof Extract)) {
    return new Extract(opts);
  }

  Writable.call(this);

  this._opts = opts || {verbose: false};

  this._parser = Parse(this._opts);
  this._parser.on('error', function (err) {
    self.emit('error', err);
  });

  this.on('finish', function () {
    self._parser.end();
  });

  //根据将上面的数据写入到一个文件夹内
  var writer = Writer({
    type: 'Directory',
    path: opts.path
  });

  writer.on('error', function (err) {
    self.emit('error', err);
  });
  writer.on('close', function () {
    self.emit('close')
  });

  this.on('pipe', function (source) {
    if (opts.verbose && source.path) {
      console.log('Archive: ', source.path);
    }
  });

  this._parser.pipe(writer);
}

inherits(Extract, Writable);

Extract.prototype._write = function (chunk, encoding, callback) {
  if (this._parser.write(chunk)) {
    return callback();
  }

  return this._parser.once('drain', callback);
};






