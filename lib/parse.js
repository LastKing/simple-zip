/**
 * Created by toonew on 2017/4/17.
 */
module.exports = Parse.create = Parse;

const Transform = require('stream').Transform;
const inherits = require('util').inherits;
const zlib = require('zlib');

const PullStream = require('pullstream');
const binary = require('binary');
const MatchStream = require('match-stream');

const Entry = require('./entry');

function Parse(opts) {
  var self = this;

  if (!(this instanceof Parse)) {
    return new Parse(opts);
  }
  Transform.call(this, {lowWaterMark: 0});

  this._opts = opts || {verbose: false};
  this._hasEntryListener = false;

  this._pullStream = new PullStream();

  this._pullStream.on("error", function (e) {
    self.emit('error', e);
  });

  this._pullStream.once("end", function () {
    self._streamEnd = true;
  });
  this._pullStream.once("finish", function () {
    self._streamFinish = true;
  });

  this._readRecord();
}
inherits(Parse, Transform);

//继承 Transform必须实现的一个转换函数  （将可写端写入的数据变换后添加到可读端）
Parse.prototype._transform = function (chunk, encoding, callback) {
  if (this._pullStream.write(chunk)) {
    return callback();
  }

  this._pullStream.once('drain', callback);
};

Parse.prototype._readRecord = function () {
  var self = this;

  this._pullStream.pull(4, function (err, data) {
    if (err) return self.emit('error', err);


    if (data.length === 0) {
      return;
    }

    // zip 三部分
    var signature = data.readUInt32LE(0);
    if (signature === 0x04034b50) {         // 1.内容源数据
      self._readFile();
    } else if (signature === 0x02014b50) { // 2.压缩的目录源数据
      self._readCentralDirectoryFileHeader();
    } else if (signature === 0x06054b50) { // 3.目录结束标识结构
      self._readEndOfCentralDirectoryRecord();
    } else {
      err = new Error('invalid signature: 0x' + signature.toString(16));
      self.emit('error', err);
    }
  });

};

//1.内容源数据
Parse.prototype._readFile = function () {
  var self = this;
  this._pullStream.pull(26, function (err, data) {
    if (err) return self.emit('error', err);

    var vars = binary.parse(data)           //4bytes 在上面readRecord进行了
        .word16lu('versionsNeededToExtract')//解压文件所需 pkware最低 版本
        .word16lu('flags')            //通用位标记
        .word16lu('compressionMethod')//压缩方法
        .word16lu('lastModifiedTime') //文件最后修改时间
        .word16lu('lastModifiedDate') //文件最后修改日期
        .word32lu('crc32')            //说明采用的算法
        .word32lu('compressedSize')   //压缩后的大小
        .word32lu('uncompressedSize') //非压缩的大小
        .word16lu('fileNameLength')   //文件名长度
        .word16lu('extraFieldLength') //拓展区长度
        .vars;

    //（这个前面的都是固定的大小，只有这两个是活动的）
    // 接下来是 文件名 和  拓展区 文件  (  n  : m  )
    return self._pullStream.pull(vars.fileNameLength, function (err, fileName) {
      if (err) return self.emit('error', err);

      fileName = fileName.toString('utf8');
      var entry = new Entry();
      entry.path = fileName;
      entry.props.path = fileName;
      entry.type = (vars.compressedSize === 0 && /[\/\\]$/.test(fileName)) ? 'Directory' : 'File';

      if (self._opts.verbose) {
        if (entry.type === 'Directory') {
          console.log('   creating:', fileName);
        } else if (entry.type === 'File') {
          if (vars.compressionMethod === 0) {
            console.log(' extracting:', fileName);
          } else {
            console.log('  inflating:', fileName);
          }
        }
      }

      var hasEntryListener = self._hasEntryListener;
      if (hasEntryListener) {
        self.emit('entry', entry);
      }

      self._pullStream.pull(vars.extraFieldLength, function (err, extraField) {
        if (err) return self.emit('error', err);

        if (entry.type === 'Directory') {
          self._pullStream.pull(vars.compressedSize, function (err, compressedData) {
            if (err) return self.emit('error', err);

            if (hasEntryListener) {
              entry.write(compressedData);
              entry.end();
            }
            return self._readRecord();
          });
        } else {
          var fileSizeKnown = !(vars.flags & 0x08);
          var has_compression = !(vars.compressionMethod === 0);
          var inflater;

          if (has_compression) {
            inflater = zlib.createInflateRaw();
            inflater.on('error', function (err) {
              self.emit('error', err);
            });
          }

          if (fileSizeKnown) {
            entry.size = vars.uncompressedSize;
            if (hasEntryListener) {
              entry.on('finish', self._readRecord.bind(self));
              if (has_compression) {
                self._pullStream.pipe(vars.compressedSize, inflater).pipe(entry);
              } else {
                self._pullStream.pipe(vars.compressedSize, entry);
              }
            } else {
              self._pullStream.drain(vars.compressedSize, function (err) {
                if (err) {
                  return self.emit('error', err);
                }
                self._readRecord();
              });
            }
          } else {
            var descriptorSig = new Buffer(4);
            descriptorSig.writeUInt32LE(0x08074b50, 0);

            var matchStream = new MatchStream({pattern: descriptorSig}, function (buf, matched, extra) {
              if (hasEntryListener) {
                if (!matched) {
                  return this.push(buf);
                }
                this.push(buf);
              }
              self._pullStream.unpipe();
              self._pullStream.prepend(extra);
              setImmediate(function () {
                self._processDataDescriptor(entry);
              });
              return this.push(null);
            });

            self._pullStream.pipe(matchStream);
            if (hasEntryListener) {
              if (has_compression) {
                matchStream.pipe(inflater).pipe(entry);
              } else {
                matchStream.pipe(entry);
              }
            }
          }

        }
      })

    })

  });
};

//2.压缩的目录源数据
Parse.prototype._readCentralDirectoryFileHeader = function () {
  var self = this;

  this._pullStream.pull(42, function (err, data) {
    if (err) return self.emit('error', err);

    var vars = binary.parse(data)
        .word16lu('versionMadeBy')     //压缩所用的pkware版本
        .word16lu('versionsNeededToExtract')//解压所需pkware的最低版本
        .word16lu('flags')             //通用位标记
        .word16lu('compressionMethod') //压缩方法
        .word16lu('lastModifiedTime')  //文件最后的修改时间
        .word16lu('lastModifiedDate')  //文件最后修改日期
        .word32lu('crc32')             //CRC-32算法
        .word32lu('compressedSize')    //压缩后的大小
        .word32lu('uncompressedSize')  //未压缩的大小
        .word16lu('fileNameLength')    //文件名长度
        .word16lu('extraFieldLength')  //扩展域长度
        .word16lu('fileCommentLength') //文件注释长度
        .word16lu('diskNumber')        //文件开始位置的磁盘编号
        .word16lu('internalFileAttributes') //内部文件属性
        .word32lu('externalFileAttributes') //外部文件属性
        .word32lu('offsetToLocalFileHeader')//本地文件header的相对位移
        .vars;

    //三个不定大小属性
    // 1. 目录文件名  2.拓展域  3.文件注释内容
    return self._pullStream.pull(vars.fileNameLength, function (err, filename) {
      if (err)return self.emit('error', err);

      filename = filename.toString('utf8');

      self._pullStream.pull(vars.extraFieldLength, function (err, extraField) {
        if (err)return self.emit('error', err);

        self._pullStream.pull(vars.fileCommentLength, function (err, fileComment) {
          if (err) {
            return self.emit('error', err);
          }
          return self._readRecord();
        })
      });
    });
  });
};

//3.目录结束标识结构
Parse.prototype._readEndOfCentralDirectoryRecord = function () {
  var self = this;
  this._pullStream.pull(18, function (err, data) {
    if (err) return self.emit('error', err);

    var vars = binary.parse(data)
        .word16lu('diskNumber')   //当前磁盘编号
        .word16lu('diskStart')    //核心目录开始位置的磁盘编号
        .word16lu('numberOfRecordsOnDisk')//该磁盘上所记录的核心目录数量
        .word16lu('numberOfRecords')      //核心目录结构总数
        .word32lu('sizeOfCentralDirectory')//核心目录的大小
        .word32lu('offsetToStartOfCentralDirectory')//核心目录开始位置相对于archive开始的位移
        .word16lu('commentLength') //注释长度
        .vars;

    //以上固定，下面不定
    // 注释内容
    if (vars.commentLength) {
      setImmediate(function () {
        self._pullStream.pull(vars.commentLength, function (err, comment) {
          if (err) return self.emit('error', err);
          comment = comment.toString('utf8');
          return self._pullStream.end();
        });
      });
    } else {
      self._pullStream.end();
    }
  });
};


Parse.prototype.pipe = function (dest, opts) {
  var self = this;
  if (typeof dest.add === "function") {
    self.on("entry", function (entry) {
      dest.add(entry);
    })
  }
  return Transform.prototype.pipe.apply(this, arguments);
};

Parse.prototype._flush = function (callback) {
  if (!this._streamEnd || !this._streamFinish) {
    return setImmediate(this._flush.bind(this, callback));
  }

  this.emit('close');
  return callback();
};

//重写监听事件 ，增加一些判断
Parse.prototype.addListener = function (type, listener) {
  if ('entry' === type) {
    this._hasEntryListener = true;
  }

  return Transform.prototype.addListener.call(this, type, listener);
};

Parse.prototype.on = Parse.prototype.addListener;
