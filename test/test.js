/**
 * Created by toonew on 2017/4/18.
 */
const fs = require('fs');

const unzip = require('../index');

var rs = fs.createReadStream('./test.zip');
var ws = unzip.Extract({path: 'output', verbose: true});//1.输出路径 2.想信息开关
rs.pipe(ws);
