var config = require('./config');
var database = require('./db');

var Soundtrack = require('./lib/soundtrack');
var soundtrack = new Soundtrack({
  config: config
});

Artist = require('./models/Artist').Artist;
Track  = require('./models/Track').Track;
Source = require('./models/Source').Source;

var Monq = require('monq');
var monq = Monq('mongodb://localhost:27017/' + config.database.name );
var jobs = monq.queue( config.database.name );

var rest  = require('restler');
var async = require('async');

var processors = {
  'test': function( data , jobIsDone ) {
    console.log('#winning' , data );
    jobIsDone();
  },
  'track:crawl': function( data , jobIsDone ) {
    Track.findOne({ _id: data.id }).exec(function(err, track) {
      console.log('gathering sources...');
      soundtrack.gatherSources( track , function() {
        console.log('sources gathered!');
        jobIsDone();
      });
    });
  },
  'artist:update': function( data , jobIsDone ) {
    console.log('updating artist:', data.id)

    var artistID = data.id;
    Artist.findOne({ _id: artistID }).exec(function(err, artist) {
      if (err) return jobIsDone(err);
      if (!artist) return jobIsDone('No such artist found!');

      var now = new Date();
      var oneWeekAgo = new Date(now.getTime() - (60*60*24*7*1000));

      if (artist.tracking.tracks.updated > oneWeekAgo) {
        return jobIsDone('Artist already updated less than one week ago');
      }

      rest.get('http://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&artist='+encodeURIComponent(artist.name)+'&limit=100&format=json&api_key=89a54d8c58f533944fee0196aa227341').on('complete', function(results) {
        if (!results.toptracks || !results.toptracks.track) {
          return jobIsDone('Could not acquire top tracks for this artist');
        }

        var popularTracks = results.toptracks.track;
        if (!popularTracks.length) return jobIsDone('Popular tracks not array...');

        async.map( popularTracks , function( remoteTrack , trackDone ) {
          soundtrack.trackFromSource('lastfm', remoteTrack , trackDone );
        }, function(err, results) {

          artist.tracking.tracks.updated = new Date();
          artist.save(function(err) {
            if (err) console.log(err);

            console.log('artist update complete!');
            jobIsDone( err, artist );
          });

        });
      });
    });
  }
}

var worker = monq.worker( [ config.database.name ] );
worker.register( processors );

worker.on('dequeued', function (data) {
  console.log('worker dequeued job %s', data._id );
});
worker.on('failed', function (data) {
  console.log('job %s failed', data._id , data.data );
});
worker.on('complete', function (data) {
  console.log('job %s complete', data._id );
});
worker.on('error', function (err) {
  console.log('worker error', err );
});

worker.start();
