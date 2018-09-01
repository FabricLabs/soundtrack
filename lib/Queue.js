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

}
var Job = function( job ) {
  // pull things from the internal job
  this.id   = job._job.id;
  this.name = job.name;
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

Queue.prototype.get = function( jobID , cb ) {
  var self = this;

  self._redis.get('jobs:' + jobID, function(err, reply) {
    if (err || !reply) throw new Error('something went wrong:' + err);

    try {
      var job = JSON.parse(reply);
    } catch(e) {
      return cb(e);
    }

    if (!job) {
      return self.cleanup( jobID , function() {
        cb('no such entry in redis')
      });
    }

    // kue-specific
    self._kue.Job.get( jobID , function(err , thisKueJob ) {
      if (err) return cb( err ); 
      job._job = thisKueJob;
      var fullJob = new Job( job );
      return cb( null , fullJob );
    });
  });
}

Queue.prototype.register = function( kueJob ) {

};

Queue.prototype.cleanup = function( jobID , cleanupComplete ) {
  var self = this;
  async.series([
    function(d) { self._redis.zrem('queue', jobID , d ); },
    function(d) { self._redis.del('job:' + jobID, jobID , d ); }
  ], function(err) {
    cleanupComplete( err );
  });
}

Queue.prototype.push = function( name , data , callback ) {
  var self = this;

  var kueJob = self._jobs.create( self._database , data );

  // now actually save and emit
  kueJob.save(function(err) {
    console.log('job saved to kue');

    // our internal version of the job
    var queueJob = new Job({
      title: data.name,
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
  // get the list of previous jobs
  self._redis.zrange('queue', 0, -1, function(e, jobs ) {
    // populate them with their corresponding internals:
    // - get the metadata (specific to Queue)
    // - get the specific engine's version of the job (Kue)
    async.map( jobs , function( j , c ) {
      self.get( j , c );
    }, function(err, realJobs) {
      if (err) console.log(err);

      self.jobs = realJobs;
      console.log('queue strapped.', self.jobs.length + ' jobs available');

      self._jobs.process( self._database , function( kueJob , kueComplete ) {

        console.log('inside kue job... id ' + kueJob.id );

        self.get( kueJob.id , function(err, job) {
          evaluator( job , function(err, result) {
            self.cleanup( kueJob.id , function() {
              kueComplete( err , result );
            });
          });
        });
      });
    });
  });

}
module.exports = Queue;