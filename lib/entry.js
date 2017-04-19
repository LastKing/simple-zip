/**
 * Created by toonew on 2017/4/17.
 */
module.exports = Entry;

const PassThrough = require('stream').PassThrough;
const inherits = require('util').inherits;

inherits(Entry, PassThrough);

function Entry() {
  PassThrough.call(this);
  this.props = {};
}

Entry.prototype.autodrain = function () {
  this.on('readable', this.read.bind(this));
};
