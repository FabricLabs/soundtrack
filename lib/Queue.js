require('debug-trace')({ always: true });

var util = require('util');
var EventEmitter = require('events').EventEmitter;

var async = require('async');
var redis = require('redis');

var Queue = function(config) {
  var self = this;

  self._database = config.app.name || 'maki';
  self._redis    = redis.createClient( config.redis.port , config.redis.host );

  self._kue  = require('kue');
  self._kue.redis.createClient = function() {
    console.log('createClient()');
    return self._redis;
  }

  self._jobs = self._kue.createQueue({
    prefix: config.app.name + ':q'
  });

  self.jobs = [];
  self._jobMap = {};

}
var Job = function( job ) {
  // pull things from the internal job
  this.id   = job._job.id;
  this.type = job._job.data.type;
  this.date = (new Date()).getTime();
  this.data = job._job.data.data;
  this._job = job._job;
};
var Worker = function( queue , type ) {
  this.queue = queue;
  this.type = type;
};

util.inherits( Queue , EventEmitter );
util.inherits( Job , EventEmitter );
util.inherits( Worker , EventEmitter );

Queue.prototype.get = function( id , cb ) {
  this._kue.Job.get( id , cb );
}

Queue.prototype.register = function( kueJob ) {

};

Queue.prototype.push = function( name , data , callback ) {
  var self = this;

  var kueJob = self._jobs.create( self._database , data );

  // now actually save and emit
  kueJob.save(function(err) {
    console.log('job saved to kue');

    // our internal version of the job
    var queueJob = new Job({
      _job: kueJob
    });

    self.jobs.push( queueJob );

    // save the data for the job
    function addJob( j , d ) {
      var metadata = j;
      delete metadata._job;
      self._redis.set('jobs:' + j.id , JSON.stringify( metadata ), d );
    }

    // take the job ID and insert it into the queue
    function addJobToQueue( jobID , d ) {
      self._redis.zadd( 'queue' , jobID , jobID , d );
    }

    async.waterfall([
      function(done) { addJob( queueJob , done ); },
      function(arg1 , done) { addJobToQueue( queueJob.id , done ); }
    ], function(err, results) {
      console.log('supppppppp')
      console.log(err, results);

      self.emit('job', queueJob );

      callback( err , queueJob );

    });
  });
}

Queue.prototype.process = function( type , evaluator ) {
  var self = this;
  console.log('Queue().process', self.jobs);

  self._redis.zrange('queue', 0, -1, function(e, j) {
    console.log('SUP QUEUE:', e , j);

    async.map( j , function(jobID , jobPopulated ) {
      self._redis.get('jobs:' + jobID, function(err, reply) {
        if (err) console.log(err);
        if (!reply) return jobPopulated('no such entry in redis');

        try {
          var job = JSON.parse(reply);
        } catch(e) {
          return jobPopulated(e);
        }

        // kue-specific
        self.get( jobID , function(err , thisKueJob ) {
          if (err) return jobPopulated( err ); 

          console.log('inside map, kueJob', thisKueJob);

          job._job = thisKueJob;
          job = new Job( job );

          jobPopulated( null , job );
        });
      });
    } , function(err, realJobs) {
      if (err) console.log(err);

      console.log('realJobs', realJobs);


      self.jobs = realJobs;


      console.log('queue strapped.', self.jobs);

      self._jobs.process( self._database , function( kueJob , kueComplete ) {

        console.log('inside kue job... id ' + kueJob.id );
        console.log('jobs: ' , self.jobs);
        console.log('looking for ' + kueJob.id );

        var job = null;
        var jobIndex;
        for (var i = 0; i < self.jobs.length; i++) {
          if (self.jobs[ i ].id == kueJob.id) {

            job = self.jobs[ i ];
            jobIndex = i;

            break;
          }
        }

        console.log('job', job);

        evaluator( job , function(err, result) {
          console.log('eval callback', err , result );
          if (err) console.log(err);

          function cleanup( jobID , cleanupComplete) {
            async.series([
              function(d) { self._redis.zrem('queue', jobID , d ); },
              function(d) { self._redis.del('job:' + jobID, jobID , d ); }
            ], function(err) {
              kueComplete( err , result );
            });
          }

          return cleanup( kueJob.id , kueComplete );

        });
      });



    });
  });

}
module.exports = Queue;