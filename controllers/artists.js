var rest = require('restler')
  , _ = require('underscore')
  , async = require('async');

module.exports = {
  list: function(req, res, next) {
    var limit = (req.param('limit')) ? req.param('limit') : 100;
    var query = (req.param('q')) ? { name: new RegExp('(.*)'+req.param('q')+'(.*)', 'i') } : undefined;

    async.parallel([
      function(done) {
        Artist.count().exec( done );
      },
      function(done) {
        Artist.find( query ).sort('name').limit( limit ).exec( done );
      }
    ], function(err, results) {
      res.format({
        json: function() {
          res.send( results[1].map(function(x) {
            x = x.toObject();
            //x.value = x._id;
            x.value = x.name;
            return x;
          }) );
        },
        html: function() {
          res.render('artists', {
              count: results[0]
            , limit: limit
            , artists: results[1]
          });
        }
      });
    });
  },
  view: function(req, res, next) {
    Artist.findOne({ slug: req.param('artistSlug') }).exec(function(err, artist) {
      if (!artist) { return next(); }

      Track.find({ $or: [
          { _artist: artist._id }
        , { _credits: artist._id }
      ] }).populate('_artist').exec(function(err, tracks) {
        
        var now = new Date();
        var oneWeekAgo = new Date(now.getTime() - (60*60*24*7*1000));

        console.log( artist.tracking.tracks.updated , oneWeekAgo );
        if (artist.tracking.tracks.updated < oneWeekAgo) {
          rest.get('http://ws.audioscrobbler.com/2.0/?method=artist.gettoptracks&artist='+encodeURIComponent(artist.name)+'&limit=10000&format=json&api_key=89a54d8c58f533944fee0196aa227341').on('complete', function(results) {
            if (results.toptracks && results.toptracks.track) {
              var popularTracks = results.toptracks.track;
              popularTracks.forEach(function(track) {
                console.log('popular track for artist ' + artist.name , track);
                
                req.soundtrack.trackFromSource('lastfm', track , function(err, realTrack) {
                  console.log( err || realTrack._id );
                });
                
              });
            }
          });
        }

        Play.aggregate([
          { $match: { _track: { $in: tracks.map(function(x) { return x._id; }) } } },
          { $group: { _id: '$_track', count: { $sum: 1 } } },
          { $sort: { 'count': -1 } }
        ], function(err, trackScores) {

          res.render('artist', {
              artist: artist
            , tracks: tracks.map(function(track) {
                var plays = _.find( trackScores , function(x) { return x._id.toString() == track._id.toString() } );
                track.plays = (plays) ? plays.count : 0;
                return track;
              })
          });

        });

      });
    });
  }
}
