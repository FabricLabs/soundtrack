var async = require('async');
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
        ], function(err, topTracks) {
          Track.find({ _id: { $in: topTracks.map(function(x) { return x._id; }) } }).populate('_artist').exec( done );
        } );
      },
      function collectTopDJs( done ) {
        Play.aggregate([
          { $group: { _id: '$_curator', count: { $sum: 1 } } },
          { $sort: { 'count': -1 } },
          { $limit: LIMIT }
          ], function(err, topDJs) {
            Person.find({ _id: { $in: topDJs.map(function(x) { return x._id; }) } }).exec( done );
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
