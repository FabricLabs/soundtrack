var config = require('./config');

var Monq = require('monq');
var monq = Monq('mongodb://localhost:27017/' + config.database.name );
var jobs = monq.queue( config.database.name );

/**/jobs.enqueue('artist:update', { id: '51eb574225d63eb169000208' } , function(err, job) {
/*/jobs.enqueue('test', { id: '5390073d1559212f560012b4' } , function(err, job) {/**/
  console.log('enqueued: ' , job );
  process.exit();
});