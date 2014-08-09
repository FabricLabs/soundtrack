//require('debug-trace')({ always: true });

var config = require('./config');
var database = require('./db');

var Soundtrack = require('./lib/soundtrack');
var soundtrack = new Soundtrack({
  config: config
});

Artist = require('./models/Artist').Artist;
Track  = require('./models/Track').Track;
Source = require('./models/Source').Source;

var Queue = require('./lib/Queue');
var jobs  = new Queue( config );

var rest  = require('restler');
var async = require('async');

jobs.process('maki', function(job, done) {
  if (!job) return done('no such job in Queue');

  console.log('evaluator running', job.id );

  switch (job.type) {
    default:
      done('unhandled job type', job.type);
    break;
    case 'artist:update':
      console.log('updating artist:', job.data.id)

      var artistID = job.data.id;
      Artist.findOne({ _id: artistID }).exec(function(err, artist) {
        if (err) return done(err);
        if (!artist) return done('No such artist found!');

        console.log('artist: ' , artist);

        var now = new Date();
        var oneWeekAgo = new Date(now.getTime() - (60*60*24*7*1000));

        if (artist.tracking.tracks.updated > oneWeekAgo) {
          return done('Artist already updated less than one week ago');
        }

        rest.get('http://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&artist='+encodeURIComponent(artist.name)+'&limit=100&format=json&api_key=89a54d8c58f533944fee0196aa227341').on('complete', function(results) {
          if (!results.toptracks || !results.toptracks.track) {
            return done('Could not acquire top tracks for this artist');
          }

          var popularTracks = results.toptracks.track;
          if (!popularTracks.length) return done('Popular tracks not array...');
          
          async.map( popularTracks , function( remoteTrack , trackDone ) {
            soundtrack.trackFromSource('lastfm', remoteTrack , trackDone );
          }, function(err, results) {

            artist.tracking.tracks.updated = new Date();
            artist.save(function(err) {
              if (err) console.log(err);
              done( err, artist );
            });

          });
        });
  
      });

    break;
  }

});