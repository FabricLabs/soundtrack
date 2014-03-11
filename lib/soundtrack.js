var _ = require('underscore');

module.exports = {
  sortPlaylist: function() {
    app.room.playlist = _.union( [ app.room.playlist[0] ] , app.room.playlist.slice(1).sort(function(a, b) {
      if (b.score === a.score) {
        return a.timestamp - b.timestamp;
      } else {
        return b.score - a.score;
      }
    }) );
  },
  broadcast: function(msg) {
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
  },
  whisper: function(id, msg) {
    var json = JSON.stringify(msg);
    app.clients[id].write(json);
  },
  markAndSweep: function(){
    app.broadcast({type: 'ping'}); // we should probably not do this globally... instead, start interval after client connect?
    var time = (new Date()).getTime();
    app.forEachClient(function(client, id){
      if (client.pongTime < time - app.config.connection.clientTimeout) {
        client.close('', 'Timeout');
        // TODO: broadcast part message

        app.broadcast({
            type: 'part'
          , data: {
                id: id
              , _id: (app.clients[id] && app.clients[id].user) ? app.clients[id].user._id : undefined
            }
        });

        delete app.clients[id];

        /*/app.broadcast({
            type: 'part'
          , data: {
              id: conn.id
            }
        });/**/
      }
    });
  },
  forEachClient: function(fn) {
    for (var id in app.clients) {
      fn(app.clients[id], id)
    }
  },
  ensureQueue: function(callback) {
    // remove the first track in the playlist...
    var lastTrack = app.room.playlist.shift();
    console.log(app.room.playlist.length);

    if (app.room.playlist.length == 0) {
      var query = {
          _curator: { $exists: true }
        , timestamp: { $gte: new Date((Math.floor((new Date()).getTime() / 1000) - 604800) * 1000) }
      };
      console.log('!!!!!!!!!!!!!!!!!!!!! QUERY !!!!!!!!!!!!!!!!!!!!!')
      console.log( query );

      Play.find( query ).limit(100).sort('timestamp').exec(function(err, plays) {
        if (err || !plays) {
          util.getYoutubeVideo( 'dQw4w9WgXcQ‎' , function(track) {
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
          console.log( track );

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
  },
  nextSong: function() {
    app.ensureQueue(function() {
      app.room.playlist[0].startTime = Date.now();
      app.room.track = app.room.playlist[0];

      app.redis.set(app.config.database.name + ':playlist', JSON.stringify( app.room.playlist ) );

      var play = new Play({
          _track: app.room.playlist[0]._id
        , _curator: (app.room.playlist[0].curator) ? app.room.playlist[0].curator._id : undefined
      });
      play.save(function(err) {
        // ...then start the music.
        app.startMusic();
      });
    });
  },
  startMusic: function() {
    console.log('startMusic() called, current playlist is: ' + JSON.stringify(app.room.playlist));

    console.log('current playlist lead is...')
    console.log( app.room.playlist[0] )
    var firstTrack = app.room.playlist[0];

    if (!app.room.playlist[0]) {
      app.broadcast({
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

      console.log('extending...')
      console.log( app.room.playlist[0] )
      console.log('with...');
      console.log( track );

      if (track) {
        app.broadcast({
            type: 'track'
          , data: _.extend( firstTrack , track )
          , seekTo: seekTo
        });
      } else {
        console.log('uhhh... broken: ' + app.room.playlist[0].sources['youtube'][0].id + ' and ' +track);
      }
    });

    clearTimeout( app.timeout );

    app.timeout = setTimeout( app.nextSong , (app.room.playlist[0].duration - seekTo) * 1000 );

    if (app.lastfm) {
      app.lastfm.scrobbleActive( app.room.playlist[0] , function() {
        console.log('scrobbling complete!');
      });
    }

  }
}