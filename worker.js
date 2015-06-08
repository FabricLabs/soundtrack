var config = require('./config');
var database = require('./db');

console.log('config, database loaded');

var Agency = require('mongoose-agency');
var agency = new Agency( database.source , {
  // timeout: 0.01
});

var Soundtrack = require('./lib/soundtrack');
var soundtrack = new Soundtrack({
  config: config
});
soundtrack.DEBUG = true;

console.log('soundtrack instantiated...');

Artist = require('./models/Artist').Artist;
Track  = require('./models/Track').Track;
Source = require('./models/Source').Source;

var rest  = require('restler');
var async = require('async');

var TOP_TRACK_COUNT = 10;

var processors = {
  'test': function( data , jobIsDone ) {
    console.log('#winning' , data );
    jobIsDone();
  },
  'track:crawl': function( data , jobIsDone ) {
    console.log('trackID', data.id );

    Track.findOne({ _id: data.id }).exec(function(err, track) {
      if (err) console.log(err);
      if (!track) console.log('no such track found!');

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
      console.log( err , artist );

      if (err) return jobIsDone(err);
      if (!artist) return jobIsDone('No such artist found!');

      var now = new Date();
      var oneWeekAgo = new Date(now.getTime() - (60*60*24*7*1000));

      if (artist.tracking.tracks.updated > oneWeekAgo) {
        console.log('artist already up to date');
        return jobIsDone();
      }

      rest.get('http://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&artist='+encodeURIComponent(artist.name)+'&limit='+TOP_TRACK_COUNT+'&format=json&api_key=89a54d8c58f533944fee0196aa227341').on('complete', function(results) {
        console.log('yesssss', results);

        if (!results.toptracks || !results.toptracks.track) {
          console.log('Could not acquire top tracks for this artist')
          return jobIsDone();
        }

        var popularTracks = results.toptracks.track;
        if (!popularTracks.length) return jobIsDone('Popular tracks not array...');

        console.log('popularTracks', popularTracks);

        async.map( popularTracks , function( remoteTrack , trackDone ) {
          console.log('inside something', remoteTrack )
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

Object.keys( processors ).forEach(function(jobType) {
  agency.subscribe( jobType , processors[ jobType ] );
});
