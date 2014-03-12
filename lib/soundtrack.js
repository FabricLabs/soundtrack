var _ = require('underscore');
var util = require('../util');

var Soundtrack = function(app) {
  //this.app = app;
  this.rooms = {};
  //setInterval( this.markAndSweep, app.config.connection.checkInterval );
}

var Room = function() {

}

Soundtrack.prototype.sortPlaylist = function() {
  var self = this;
  var app = this.app;
  app.room.playlist = _.union( [ app.room.playlist[0] ] , app.room.playlist.slice(1).sort(function(a, b) {
    if (b.score === a.score) {
      return a.timestamp - b.timestamp;
    } else {
      return b.score - a.score;
    }
  }) );
}
Soundtrack.prototype.broadcast = function(msg) {
  var self = this;
  var app = this.app;
  switch (msg.type) {
    case 'edit':
      for (var i = 0; i < app.room.playlist.length; i++) {

        console.log( 'comparing ' + app.room.playlist[ i ]._id + ' to ' + msg.track._id );
        console.log( app.room.playlist[ i ]._id == msg.track._id );

        if ( app.room.playlist[ i ]._id.toString() == msg.track._id.toString() ) {
          app.room.playlist[ i ].title        = msg.track.title;
          app.room.playlist[ i ].slug         = msg.track.slug;
          app.room.playlist[ i ]._artist.name = msg.track._artist.name;
          app.room.playlist[ i ]._artist.slug = msg.track._artist.slug;
        }
      }
    break;
  }

  var json = JSON.stringify(msg);
  for (var id in app.clients) {
    app.clients[id].write(json);
  }
};
Soundtrack.prototype.whisper = function(id, msg) {
  var self = this;
  var app = this.app;
  var json = JSON.stringify(msg);
  app.clients[id].write(json);
};
Soundtrack.prototype.markAndSweep = function(){
  var self = this;
  var app = this.app;

  self.broadcast({type: 'ping'}); // we should probably not do this globally... instead, start interval after client connect?
  var time = (new Date()).getTime();
  self.forEachClient(function(client, id){
    if (client.pongTime < time - app.config.connection.clientTimeout) {
      client.close('', 'Timeout');
      // TODO: broadcast part message

      self.broadcast({
          type: 'part'
        , data: {
              id: id
            , _id: (app.clients[id] && app.clients[id].user) ? app.clients[id].user._id : undefined
          }
      });

      delete app.clients[id];

      /*/self.broadcast({
          type: 'part'
        , data: {
            id: conn.id
          }
      });/**/
    }
  });
};
Soundtrack.prototype.forEachClient = function(fn) {235
  var self = this;
  for (var id in app.clients) {
    fn(app.clients[id], id)
  }
};
Soundtrack.prototype.queueTrack = function(track, curator, queueCallback) {
  var self = this;
  var app = this.app;
  Track.findOne({ _id: track._id }).populate('_artist _credits').exec(function(err, realTrack) {

    var playlistItem = realTrack.toObject();

    playlistItem._artist = {
        _id: playlistItem._artist._id
      , name: playlistItem._artist.name
      , slug: playlistItem._artist.slug
    };

    for (var source in playlistItem.sources) {
      console.log(source);
      console.log(playlistItem.sources[ source ]);
      for (var i = 0; i<playlistItem.sources[ source ].length; i++) {
        delete playlistItem.sources[ source ][ i ].data;
      }
    }

    app.room.playlist.push( _.extend( playlistItem , {
        score: 0
      , votes: {} // TODO: auto-upvote?
      , timestamp: new Date()
      , curator: {
            _id: curator._id
          , id: (app.room.listeners[ curator._id.toString() ]) ? app.room.listeners[ curator._id.toString() ].connId : undefined
          , username: curator.username
          , slug: curator.slug
        }
    } ) );

    self.sortPlaylist();

    app.redis.set( app.config.database.name + ':playlist', JSON.stringify( app.room.playlist ) );

    self.broadcast({
        type: 'playlist:add'
      , data: track
    });

    queueCallback();
  });
};
Soundtrack.prototype.ensureQueue = function(callback) {
  var self = this;
  var app = this.app;
  // remove the first track in the playlist...
  var lastTrack = app.room.playlist.shift();
  console.log(app.room.playlist.length);

  if (app.room.playlist.length == 0) {
    var query = { _curator: { $exists: true } };

    query = _.extend( query , {
      $or: util.timeSeries('timestamp', 3600*3*1000, 24*60*1000*60, 7)
    });
    console.log('!!!!!!!!!!!!!!!!!!!!! QUERY !!!!!!!!!!!!!!!!!!!!!')
    console.log( query );

    Play.find( query ).limit(4096).sort('timestamp').exec(function(err, plays) {
      if (err || !plays) {
        return util.getYoutubeVideo( 'dQw4w9WgXcQ‎' , function(track) {
          if (track) { backupTracks.push( track.toObject() ); }
          callback();
        });
      }

      console.log('plays are ' + plays.length + ' long.');

      var randomSelection = plays[ _.random(0, plays.length - 1 ) ];
      console.log('random selection is ')
      console.log(randomSelection);

      Track.findOne({ _id: randomSelection._track }).populate('_artist').exec(function(err, track) {

        console.log('track is: ')
        console.log( track.title );

        app.room.playlist.push( _.extend( track , {
            score: 0
          , votes: {}
        } ) );
        callback();
      });
    });
  } else {
    callback();
  }
};
Soundtrack.prototype.nextSong = function() {
  var self = this;
  var app = this.app;

  console.log( self );

  self.ensureQueue(function() {
    app.room.playlist[0].startTime = Date.now();
    app.room.track = app.room.playlist[0];

    app.redis.set(app.config.database.name + ':playlist', JSON.stringify( app.room.playlist ) );

    var play = new Play({
        _track: app.room.playlist[0]._id
      , _curator: (app.room.playlist[0].curator) ? app.room.playlist[0].curator._id : undefined
    });
    play.save(function(err) {
      // ...then start the music.
      self.startMusic();
    });
  });
};
Soundtrack.prototype.startMusic = function() {
  var self = this;
  var app = this.app;

  var firstTrack = app.room.playlist[0];

  if (!app.room.playlist[0]) {
    self.broadcast({
        type: 'announcement'
      , data: {
            formatted: '<div class="message">No tracks in playlist.  Please add at least one!  Waiting 5 seconds...</div>'
          , created: new Date()
        }
    });
    return setTimeout(app.startMusic, 5000);
  }

  var seekTo = (Date.now() - app.room.playlist[0].startTime) / 1000;
  app.room.track = app.room.playlist[0];

  Track.findOne({ _id: app.room.playlist[0]._id }).populate('_artist _artists').lean().exec(function(err, track) {
    if (track) {
      self.broadcast({
          type: 'track'
        , data: _.extend( firstTrack , track )
        , seekTo: seekTo
      });
    } else {
      console.log('uhhh... broken: ' + app.room.playlist[0].sources['youtube'][0].id + ' and ' +track);
    }
  });

  clearTimeout( self.timeout );

  self.timeout = setTimeout(function() {
    self.nextSong 
  }, (app.room.playlist[0].duration - seekTo) * 1000 );

  if (app.lastfm) {
    app.lastfm.scrobbleActive( app.room.playlist[0] , function() {
      console.log('scrobbling complete!');
    });
  }

};

Soundtrack.prototype.lastfmAuthSetup = function(req, res) {
  var self = this;
  var app = this.app;

  //var authUrl = lastfm.getAuthenticationUrl({ cb: ((config.app.safe) ? 'http://' : 'http://') + config.app.host + '/auth/lastfm/callback' });
  var authUrl = lastfm.getAuthenticationUrl({ cb: (( app.config.app.safe) ? 'http://' : 'http://') + 'soundtrack.io/auth/lastfm/callback' });
  res.redirect(authUrl);
};
Soundtrack.prototype.lastfmAuthCallback = function(req, res) {
  var self = this;
  var app = this.app;

  lastfm.authenticate( req.param('token') , function(err, session) {
    console.log(session);

    if (err) {
      console.log(err);
      req.flash('error', 'Something went wrong with authentication.');
      return res.redirect('/');
    }

    Person.findOne({ $or: [
        { _id: (req.user) ? req.user._id : undefined }
      , { 'profiles.lastfm.username': session.username }
    ]}).exec(function(err, person) {

      if (!person) {
        var person = new Person({ username: 'reset this later ' });
      }

      person.profiles.lastfm = {
          username: session.username
        , key: session.key
        , updated: new Date()
      };

      person.save(function(err) {
        if (err) { console.log(err); }
        req.session.passport.user = person._id;
        res.redirect('/');
      });

    });

  });
};
Soundtrack.prototype.scrobbleActive = function(requestedTrack, cb) {
  var self = this;
  var app = this.app;

  console.log('scrobbling to active listeners...');

  Track.findOne({ _id: requestedTrack._id }).populate('_artist').exec(function(err, track) {
    if (!track || track._artist.name && track._artist.name.toLowerCase() == 'gobbly') { return false; }

    Person.find({ _id: { $in: _.toArray(app.room.listeners).map(function(x) { return x._id; }) } }).exec(function(err, people) {
      _.filter( people , function(x) {
        console.log('evaluating listener:');
        console.log(x);
        return (x.profiles && x.profiles.lastfm && x.profiles.lastfm.username && x.preferences.scrobble);
      } ).forEach(function(user) {
        console.log('listener available:');
        console.log(user);

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
          , timestamp: Math.floor((new Date()).getTime() / 1000) - 300
        }, function(err, scrobbles) {
          if (err) { return console.log('le fail...', err); }

          console.log(scrobbles);
          cb();
        });
      });
    });
  });
}

module.exports = Soundtrack;
