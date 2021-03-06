/**
 * Created by toonew on 2017/4/17.
 */
module.exports = Extract;

const Writable = require('stream').Writable;
const inherits = require('util').inherits;

const Writer = require('fstream').Writer;

const Parse = require('./parse');

function Extract(opts) {
  var self = this;

  if (!(this instanceof Extract)) {
    return new Extract(opts);
  }

  Writable.call(this);

  //1.设置参数
  this._opts = opts || {verbose: false};

  //2.根据参数  获取
  this._parser = Parse(this._opts);

  this._parser.on('error', function (err) {
    self.emit('error', err);
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

  //将解析完毕的数据  通过 writer 刷写到物理存储中
  this._parser.pipe(writer);

  //记录 ws  pipe进来的rs基本信息
  this.on('pipe', function (source) {
    if (opts.verbose && source.path) {
      console.log('Archive: ', source.path);
    }
  });

  this.on('finish', function () {
    self._parser.end();
  });
}

inherits(Extract, Writable);

//读取外部进入的 数据流
Extract.prototype._write = function (chunk, encoding, callback) {
  if (this._parser.write(chunk)) {
    return callback();
  }

  return this._parser.once('drain', callback);
};
