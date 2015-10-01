var async = require('async');
var _ = require('underscore');

module.exports = {
  index: function(req, res, next) {
    if (!req.roomObj) {
      var sortedRooms = [];
      return Room.find().exec(function(err, rooms) {
        rooms.forEach(function( room ) {
          var roomName = room.slug;
          var cachedRoom = req.app.locals.rooms[ roomName ];
          cachedRoom.description = room.description;
          cachedRoom.listenerCount = Object.keys(cachedRoom.listeners).length;
          sortedRooms.push(cachedRoom);
        });
        
        sortedRooms = sortedRooms.sort(function(a, b) {
          return b.listenerCount - a.listenerCount;
        });
        
        return async.map( sortedRooms , function( room , done ) {
          Person.populate( room , {
            path: '_owner'
          }, done );
        } , function(err, finalRooms) {
          Person.count({}, function(err, userCount) {
            return res.render('rooms', {
              rooms: finalRooms,
              userCount: userCount
            });          
          });
        });
      });
    }
    
    async.parallel([
      collectChats,
      collectPlaylists
    ], function(err, results) {
      var messages = results[0].reverse();
      var playlists = results[1];

      res.render('index', {
          messages: messages
        , backup: []
        , playlists: playlists || []
        , room: req.app.rooms[ req.room ]
        , page: {
            title: req.roomObj.name,
            description: req.roomObj.description
          }
      });
      
    });
    
    function collectChats( done ) {
      Chat.find({
        _room: req.roomObj._id
      }).limit(10).sort('-created').populate('_author _track _play').exec(function(err, messages) {
        Artist.populate( messages, {
          path: '_track._artist'
        }, done );
      });
    }
    function collectPlaylists( done ) {
      Playlist.find({ _creator: ((req.user) ? req.user._id : undefined) }).sort('name').exec( done );
    }
  },
  about: function(req, res, next) {
    res.render('about', { });
  },
  help: function(req, res, next) {
    res.render('help', { });
  },
  history: function(req, res) {
    Play.find({
      _room: req.roomObj._id
    }).populate('_track _curator _room').sort('-timestamp').limit(100).exec(function(err, plays) {
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
          { $match: {
            _curator: { $exists: true },
            _room: req.roomObj._id
          } },
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
          { $match: {
            _curator: { $exists: true },
            _room: req.roomObj._id
          } },
          { $group: { _id: '$_curator', count: { $sum: 1 } } },
          { $sort: { 'count': -1 } },
          { $limit: LIMIT }
        ], function(err, collected) {
          Person.find({ _id: { $in: collected.map(function(x) { return x._id; }) } }).exec(function(err, input) {
            var output = [];
            for (var i = 0; i < collected.length; i++) {
              output.push( _.extend( collected[i] , input[i] ) );
            }
            done( err , output );
          });
        } );
      }
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
