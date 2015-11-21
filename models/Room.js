var mongoose = require('mongoose');
var Schema = mongoose.Schema;
var ObjectId = mongoose.SchemaTypes.ObjectId;
var slug = require('mongoose-slug');

var _ = require('underscore');
var async = require('async');
var util = require('../util');

var config = require('../config');

// this defines the fields associated with the model,
// and moreover, their type.
var RoomSchema = new Schema({
  name:        { type: String , required: true },
  description: { type: String },
  _creator:    { type: ObjectId, ref: 'Person' },
  _owner:      { type: ObjectId, ref: 'Person' },
  created:     { type: Date, default: Date.now },
  _moderators: [ { type: ObjectId , ref: 'Person' } ],
  bans: {
    _tracks: [ { type: ObjectId , ref: 'Track' } ],
    _people: [ { type: ObjectId , ref: 'Person' } ],
  }
});

RoomSchema.plugin( slug('name'), {
  required: true
} );
RoomSchema.index({ slug: 1 });

RoomSchema.virtual('index').get(function() {
  var protocol = (config.app.safe) ? 'https' : 'http';
  return protocol + '://' + this.slug + '.' + config.app.host;
});

RoomSchema.methods.bind = function( soundtrack ) {
  this.soundtrack = soundtrack;
};
RoomSchema.methods.broadcast = function( msg , GLOBAL ) {
  if (GLOBAL) return this.soundtrack.broadcast( msg );

  var room = this;
  var app = room.soundtrack.app;

  var myClients = _.flatten( _.toArray( room.listeners ).map(function(l) {
    return l.ids;
  }) );

  var json = JSON.stringify(msg);
  for (var id in app.clients) {
    if (app.clients[id].room === room._id.toString()) {
      app.clients[id].write(json);
    }
  }
};
RoomSchema.methods.queueTrack = function( track , curator , callback ) {
  var room = this;

  Track.findOne({ _id: track._id }).populate('_artist _credits').exec(function(err, realTrack) {
    if (err || !realTrack) return callback('Could not acquire that track.');

    var playlistItem = realTrack.toObject();

    playlistItem._artist = {
        _id: playlistItem._artist._id
      , name: playlistItem._artist.name
      , slug: playlistItem._artist.slug
    };

    var playableSources = 0;
    for (var source in playlistItem.sources) {
      for (var i = 0; i < playlistItem.sources[ source ].length; i++) {
        if (['direct', 'soundcloud', 'youtube', 'bandcamp'].indexOf( source ) >= 0) playableSources += 1;
        delete playlistItem.sources[ source ][ i ].data;
      }
    }

    if (!playableSources) {
      return callback({
          status: 'error'
        , message: 'No playable sources.'
      });
    }

    var curatorObj = {
        _id: curator._id
      , username: curator.username
      , slug: curator.slug
    };

    if (curator.profiles && curator.profiles.changetip && curator.profiles.changetip.username) {
      curatorObj.changetip = curator.profiles.changetip.username;
    }

    room.playlist.push( _.extend( playlistItem , {
        score: 0
      , votes: {} // TODO: auto-upvote?
      , timestamp: new Date()
      , curator: curatorObj
    } ) );

    room.sortPlaylist();

    room.savePlaylist(function() {
      room.broadcast({
        type: 'playlist:add',
        data: track
      });
      return callback();
    });
  });
};
RoomSchema.methods.sortPlaylist = function() {
  var room = this;
  room.playlist = _.union( [ room.playlist[0] ] , room.playlist.slice(1).sort(function(a, b) {
    if (b.score === a.score) {
      return a.timestamp - b.timestamp;
    } else {
      return b.score - a.score;
    }
  }) );
};
RoomSchema.methods.savePlaylist = function( saved ) {
  if (!saved) var saved = new Function();
  var self = this;
  var app = self.soundtrack.app;

  //console.log('saving playlist');
  //console.log('as exists', self.playlist );
  //console.log('as stringified', JSON.stringify( self.playlist ));

  app.redis.set( app.config.database.name + ':rooms:' + self.slug + ':playlist', JSON.stringify( self.playlist ) );

  app.rooms[ self.slug ] = self;

  saved();
};

RoomSchema.methods.generatePool = function( gain , failpoint , cb ) {
  var room = this;
  var MAXIMUM_PLAY_AGE = 180;

  if (typeof(gain) === 'function') {
    var cb = gain;
    var gain = 0;
    var failpoint = MAXIMUM_PLAY_AGE;
  }

  if (typeof(failpoint) === 'function') {
    var cb = failpoint;
    var failpoint = MAXIMUM_PLAY_AGE;
  }

  if (!gain) var gain = 0;
  if (!failpoint) var failpoint = MAXIMUM_PLAY_AGE;

  var query = {};

  // must be queued by a real person
  query._curator = { $exists: true };
  // must have been played in this room
  query._room = room._id;
  // must not be banned
  query._track = { $nin: room.bans._tracks };

  // TEMPORARY PERFORMANCE FIX
  return Play.find(query).limit( 4096 ).sort('timestamp').exec(function(err, plays) {
    return cb(err, plays, query);
  });

  // must have been queued within the past 7 days
  query = _.extend( query , {
    $or: util.timeSeries('timestamp', 3600*3*1000, 24*60*1000*60, 7 + gain ),
    //timestamp: { $lt: (new Date()) - 3600 * 3 * 1000 }
  });

  // but not if it's been played recently!
  // TODO: one level of callbacks to collect this!
  Play.count({ _room: room._id }).exec(function(err, totalPlays) {
    if (!totalPlays) {
      // no tracks have ever been played.  full query.
      query = {};
    } else if (gain > failpoint) {
      // just query the whole damned room.
      query = { _room: room._id };
    }

    Play.find( query ).limit( 4096 ).sort('timestamp').exec(function(err, plays) {
      Play.find({
        _room: room._id,
        timestamp: { $gte: (new Date()) - 3600 * 3 * 1000 }
      }).exec(function(err, exclusions) {
        query.exclusionIDs = exclusions.map(function(x) { return x._track.toString(); });

        plays = plays.filter(function(x) {
          //console.log('filtering ', x );
          //console.log('exclusions checker,', x._track.toString() , 'in' , query.exclusionIDs , '?');
          //console.log(!~query.exclusionIDs.indexOf( x._track.toString() ));
          return !~query.exclusionIDs.indexOf( x._track.toString() );
        });

        if (err) console.error( err );
        if ((!plays || plays.length < 10) && (gain <= failpoint)) return room.generatePool( gain + 7 , failpoint , cb );
        if ((!plays) && (gain > failpoint)) return cb('init');

        return cb( err , plays , query );

      });

    });
  });

};
RoomSchema.methods.selectTrack = function( cb ) {
  var room = this;

  room.generatePool(function(err, plays) {
    if (err || !plays || plays.length === 0) {
      console.log('room ' + room.slug + ' has no pool (POOL\'S CLOSED!)');
      return room.soundtrack.trackFromSource('youtube', 'wZThMWK9GxA', function(err, track) {
        Artist.populate( track , '_artist' , cb );
      });
    }

    var randomSelection = plays[ _.random(0, plays.length - 1 ) ];
    Track.findOne({ _id: randomSelection._track }).populate('_artist').exec( cb );
  });

};
RoomSchema.methods.ensureQueue = function(callback) {
  var room = this;
  if (room.playlist.length > 0) return callback();

  room.selectTrack(function(err, track) {
    if (err || !track) return callback( err );
    track.startTime = Date.now();
    // TODO: add score: 0 and votes: {}?
    room.playlist.push( track );
    return callback();
  });

};
RoomSchema.methods.nextSong = function( done ) {
  if (!done) var done = new Function();
  var room = this;
  var app = room.soundtrack.app;

  //console.log('old playlist length', room.playlist.length);
  var lastTrack = room.playlist.shift();
  //console.log('lastTrack was', lastTrack);
  //console.log('new playlist length', room.playlist.length);

  room.ensureQueue(function() {
    room.savePlaylist(function() {
      //console.log('saved, ', err );
      room.startMusic(function() {
        console.log('nextSong() started music');
        done();
      });
    });
  });
};

RoomSchema.methods.startMusic = function( cb ) {
  var room = this;
  if (!room.playlist[0]) {
    console.log('no playlist');
    return Track.count(function(err, count) {
      if (!count) return cb('no tracks.  new install?  TODO: base set.');
      var rand = Math.floor(Math.random() * count);
      Track.findOne().skip( rand ).exec(function(err, track) {
        room.playlist.push( track );
        room.savePlaylist(function(err) {
          return cb('zero-length playlist.  inserting random');
        });
      });
    });
  }

  room.track = room.playlist[0];
  if (!room.track.startTime) room.track.startTime = Date.now();

  var now = Date.now();
  var seekTo = (now - room.playlist[0].startTime) / 1000;

  Track.findOne({ _id: room.track._id }).populate('_artist _artists').lean().exec(function(err, track) {
    if (err || !track) return cb('no such track (severe error)');

    // temporary collect exact matches...
    // testing for future merging of track data for advances
    var query = { _artist: track._artist._id , title: track.title, _id: { $ne: track._id } };
    Track.find( query ).lean().exec(function(err, tracks) {
      var sources = track.sources;
      tracks.forEach(function(t) {
        for (var source in t.sources) {
          sources[ source ] = _.union( sources[ source ] , t.sources[ source ] );
        }
      });

      room.broadcast({
        type: 'track',
        data: _.extend( room.track , track ),
        sources: sources,
        seekTo: seekTo
      });

      clearTimeout( room.trackTimer );
      clearTimeout( room.permaTimer );

      room.trackTimer = setTimeout(function() {
        room.nextSong();
      }, (room.track.duration - seekTo) * 1000 );

      if (room.soundtrack.app.lastfm) {
        room.setListeningActive( room.track , new Function() );
      }

      if (room.track.duration > 30) {
        var FOUR_MINUTES = 4 * 60;
        var scrobbleTime = (room.track.duration > FOUR_MINUTES) ? FOUR_MINUTES : room.track.duration / 2;

        room.permaTimer = setTimeout(function() {

          async.parallel([
            insertIntoPlayHistory,
            scrobbleIfEnabled
          ], function(err, results) {
            if (err) console.log(err);
            console.log('play history updated and lastfm scrobbled!');
          });

          function insertIntoPlayHistory( done ) {
            var play = new Play({
              _track: room.track._id,
              _curator: (room.track.curator) ? room.track.curator._id : undefined,
              _room: room._id,
              timestamp: now
            });
            play.save( done );
          }

          function scrobbleIfEnabled( done ) {
            if (!room.soundtrack.app.lastfm) return done();
            room.scrobbleActive( room.track , done );
          }

        }, scrobbleTime * 1000 );
      }

      return cb();

    });
  });
};

RoomSchema.methods.scrobbleActive = function(requestedTrack, cb) {
  var room = this;
  var app = room.soundtrack.app;

  console.log('scrobbling to active listeners...');

  Track.findOne({ _id: requestedTrack._id }).populate('_artist').exec(function(err, track) {
    if (!track || track._artist.name && track._artist.name.toLowerCase() == 'gobbly') { return false; }

    Person.find({ _id: { $in: _.toArray( room.listeners ).map(function(x) { return x._id; }) } }).exec(function(err, people) {
      _.filter( people , function(x) {
        return (x.profiles && x.profiles.lastfm && x.profiles.lastfm.username && x.preferences.scrobble);
      } ).forEach(function(user) {
        console.log('listener available:' + user._id + ' ' + user.username );

        var lastfm = new app.LastFM({
            api_key: app.config.lastfm.key
          , secret:  app.config.lastfm.secret
        });

        var creds = {
            username: user.profiles.lastfm.username
          , key: user.profiles.lastfm.key
        };

        lastfm.setSessionCredentials( creds.username , creds.key );
        lastfm.track.scrobble({
            artist: track._artist.name
          , track: track.title
          , duration: Math.floor(track.duration)
          , timestamp: Math.floor((new Date()).getTime() / 1000)
        }, function(err, scrobbles) {
          if (err) { return console.log('le fail...', err); }
          cb();
        });
      });
    });
  });
}

RoomSchema.methods.setListeningActive = function(requestedTrack, cb) {
  var room = this;
  var app = room.soundtrack.app;

  console.log('setting "listening to" for active listeners...');

  Track.findOne({ _id: requestedTrack._id }).populate('_artist').exec(function(err, track) {
    if (!track || track._artist.name && track._artist.name.toLowerCase() == 'gobbly') { return false; }

    Person.find({ _id: { $in: _.toArray( room.listeners ).map(function(x) { return x._id; }) } }).exec(function(err, people) {
      _.filter( people , function(x) {
        return (x.profiles && x.profiles.lastfm && x.profiles.lastfm.username && x.preferences.scrobble);
      } ).forEach(function(user) {
        console.log('listener available:' + user._id + ' ' + user.username );

        var lastfm = new app.LastFM({
            api_key: app.config.lastfm.key
          , secret:  app.config.lastfm.secret
        });

        var creds = {
            username: user.profiles.lastfm.username
          , key: user.profiles.lastfm.key
        };

        lastfm.setSessionCredentials( creds.username , creds.key );
        lastfm.track.updateNowPlaying({
            artist: track._artist.name
          , track: track.title
          , duration: Math.floor(track.duration)
        }, function(err, scrobbles) {
          if (err) return console.log('le fail...', err);
          cb();
        });
      });
    });
  });
}

var Room = mongoose.model('Room', RoomSchema);

// export the model to anything requiring it.
module.exports = {
  Room: Room
};
