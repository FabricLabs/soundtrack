var config = require('./config');

var Queue = require('./lib/Queue');
var jobs = new Queue( config );

jobs.push('soundtrack', {
  type: 'artist:update',
  data: {
    id: '51eb87cdb945debc6a0001c9'
  }
}, function( err , job ) {
  if (err) console.log(err);
  console.log( 'job pushed' , job );

  job.on('complete', function(t) {
    console.log('scheduled job completed', t);

    process.exit();
  });
});