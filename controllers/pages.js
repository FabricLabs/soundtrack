var async = require('async');
var _ = require('underscore');

module.exports = {
  index: function(req, res, next) {
    Chat.find({}).limit(10).sort('-created').populate('_author _track _play').exec(function(err, messages) {
      Playlist.find({ _creator: ((req.user) ? req.user._id : undefined) }).sort('name').exec(function(err, playlists) {
        if (err) { console.log(err); }

        Artist.populate( messages, {
          path: '_track._artist'
        }, function(err, messages) {
          res.render('index', {
              messages: messages.reverse()
            , backup: []
            , playlists: playlists || []
            , room: req.app.room
          });
        })
      });

    });
  },
  about: function(req, res, next) {
    res.render('about', { });
  },
  history: function(req, res) {
    Play.find({}).populate('_track _curator').sort('-timestamp').limit(100).exec(function(err, plays) {
      Artist.populate(plays, {
        path: '_track._artist'
      }, function(err, plays) {
        res.render('history', {
          plays: plays
        });
      });
    });
  },
  stats: function(req, res, next) {
    var LIMIT = 50;
    
    var functions = [
      function collectTopTracks( done ) {
        Play.aggregate([
          { $group: { _id: '$_track', count: { $sum: 1 } } },
          { $sort: { 'count': -1 } },
          { $limit: LIMIT }
        ], function(err, collected) {
          Track.find({ _id: { $in: collected.map(function(x) { return x._id; }) } }).populate('_artist').exec(function(err, input) {
            var output = [];
            for (var i = 0; i < collected.length; i++) {
              output.push( _.extend( collected[i] , input[i] ) );
            }
            done( err , output );
          });
        } );
      },
      function collectTopDJs( done ) {
        Play.aggregate([
          { $match: { _curator: { $exists: true } } },
          { $group: { _id: '$_curator', count: { $sum: 1 } } },
          { $sort: { 'count': -1 } },
          { $limit: LIMIT }
          ], function(err, collected) {
            console.log(collected);
            
            Person.find({ _id: { $in: collected.map(function(x) { return x._id; }) } }).exec(function(err, input) {
              var output = [];
              for (var i = 0; i < collected.length; i++) {
                output.push( _.extend( collected[i] , input[i] ) );
              }
              done( err , output );
            });
          } );
        },
    ];
    
    async.parallel( functions , function(err, results) {
      var stats = {
        topTracks: results[0],
        topDJs: results[1]
      }
      
      res.format({
        json: function() { res.send(stats); },
        html: function() { res.render('stats', stats ); }
      });
    });
  }
}
