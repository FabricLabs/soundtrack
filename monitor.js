var config = require('./config');
var db = require('./db');

var Queue = require('./lib/Queue');
var jobs = new Queue( config );

jobs._kue.app.listen(3000);