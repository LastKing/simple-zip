/**
 * Created by toonew on 2017/4/18.
 */
const fs = require('fs');

const unzip = require('../index');

var rs = fs.createReadStream('./test.zip');
var ws = unzip.Extract({path: 'output/path'});
rs.pipe(ws);
