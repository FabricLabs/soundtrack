var _ = require('underscore');
var util = require('../util');
var rest = require('restler');
var async = require('async');
var slug = require('speakingurl');
var Queue = require('maki-queue');

var Soundtrack = function(app) {
  var self = this;

  this.app = app;
  this.app.rooms = {};
  this.backupTracks = [];
  this.timers = {
    scrobble: {}
  };

  this.DEBUG = false;

  this._jobs = new Queue();

};

Soundtrack.prototype.start = function() {
  var self = this;
  // periodically check for idle sockets
  setInterval(function() {
    self.markAndSweep();
  }, self.app.config.connection.checkInterval );
};

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
    // special handling for edits
    // this allows us to simply update the in-memory version of a track,
    // rather than querying mongoDB several more times for data.
    case 'edit':
      for (var roomName in app.rooms) {
        var room = app.rooms[ roomName ];
        for (var i = 0; i < room.playlist.length; i++) {
  
          console.log( 'comparing ' + room.playlist[ i ]._id + ' to ' + msg.track._id );
          console.log( room.playlist[ i ]._id == msg.track._id );
  
          if ( room.playlist[ i ]._id.toString() == msg.track._id.toString() ) {
            room.playlist[ i ].title        = msg.track.title;
            room.playlist[ i ].slug         = msg.track.slug;
            room.playlist[ i ].flags        = msg.track.flags;
            room.playlist[ i ]._artist.name = msg.track._artist.name;
            room.playlist[ i ]._artist.slug = msg.track._artist.slug;
          }
        }
      }
    break;
  }

  //app.redis.set(app.config.database.name + ':playlist', JSON.stringify( app.room.playlist ) );

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
      
      for (var roomName in app.rooms) {
        var room = app.rooms[ roomName ];
  
        if (client.user) {
          if (!room.listeners[ client.user._id ]) {
            room.listeners[ client.user._id ] = { ids: [] };
          }
          
          room.listeners[ client.user._id ].ids = _.reject( room.listeners[ client.user._id ].ids , function(x) {
            return x == client.id;
          });
        } 
  
        for (var userID in room.listeners) {
          if (room.listeners[ userID ].ids.length === 0) {
            delete room.listeners[ userID ];
            self.broadcast({
                type: 'part'
              , data: {
                  _id: (app.clients[id] && app.clients[id].user) ? app.clients[id].user._id : undefined
                }
            });
          }
        }
      }



      delete app.clients[id];
    }
  });
};
Soundtrack.prototype.forEachClient = function(fn) {
  var self = this;
  var app = this.app;
  for (var id in app.clients) {
    fn(app.clients[id], id)
  }
};
Soundtrack.prototype.queueTrack = function(track, curator, queueCallback) {
  var self = this;
  var app = this.app;

  console.log('queueTrack() : ' + track._id );
  Track.findOne({ _id: track._id }).populate('_artist _credits').exec(function(err, realTrack) {
    if (err || !realTrack) {
      console.log('Failed to find anything useful');
      console.log(err);
      return queueCallback();
    }

    var playlistItem = realTrack.toObject();

    playlistItem._artist = {
        _id: playlistItem._artist._id
      , name: playlistItem._artist.name
      , slug: playlistItem._artist.slug
    };

    var playableSources = 0;
    for (var source in playlistItem.sources) {
      for (var i = 0; i < playlistItem.sources[ source ].length; i++) {
        if (['soundcloud', 'youtube', 'bandcamp'].indexOf( source ) >= 0) playableSources += 1;
        delete playlistItem.sources[ source ][ i ].data;
      }
    }
    
    console.log( 'playable sources', playableSources);
    if (!playableSources) {
      return queueCallback({
          status: 'error'
        , message: 'No playable sources.'
      });
    }

    app.room.playlist.push(  );

    self.sortPlaylist();

    app.redis.set( app.config.database.name + ':playlist', JSON.stringify( app.room.playlist ) );

    self.broadcast({
        type: 'playlist:add'
      , data: track
    });

    queueCallback();
  });
};
Soundtrack.prototype.ensureQueue = function( gain , callback ) {
  var self = this;
  var app = this.app;

  if (typeof(gain) === 'function') {
    var callback = gain;
    var gain = 0;
  }

  // remove the first track in the playlist...
  var lastTrack = app.room.playlist.shift();
  console.log('room queue length is ' , app.room.playlist.length);

  if (app.room.playlist.length === 0) {
    var query = { _curator: { $exists: true } };

    query = _.extend( query , {
      $or: util.timeSeries('timestamp', 3600*3*1000, 24*60*1000*60, 7 + gain ),
      timestamp: { $lt: (new Date()) - 3600 * 3 * 1000 }
    });

    Play.find( query ).limit(4096).sort('timestamp').exec(function(err, plays) {
      if (err) { console.log(err); }

      if (err || !plays || !plays.length || plays.length < 10) {
        return self.ensureQueue( gain + 7 , callback );
      }

      console.log('plays are ' + plays.length + ' long.');

      var randomSelection = plays[ _.random(0, plays.length - 1 ) ];
      Track.findOne({ _id: randomSelection._track }).populate('_artist').exec(function(err, track) {
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
Soundtrack.prototype.nextSong = function(room) {
  var self = this;
  var app = this.app;

  self.ensureQueue(function() {
    app.room.playlist[0].startTime = Date.now();
    app.room.track = app.room.playlist[0];

    app.redis.set(app.config.database.name + ':playlist', JSON.stringify( app.room.playlist ) );
    //app.redis.set(app.config.database.name + ':'+room.slug+':playlist', JSON.stringify( app.room.playlist ) );

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
Soundtrack.prototype.startMusic = function( cb ) {
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
    // temporary collect exact matches... 
    // testing for future merging of track data for advances
    var query = { _artist: track._artist._id , title: track.title, _id: { $ne: track._id } };
    console.log(query);

    Track.find( query ).lean().exec(function(err, tracks) {

      console.log('HEYYYYYYYYYYYYYYYYYY YOUUUUUUUUUUUUUUUUUUUUUUUUU')
      console.log(err || tracks);

      var sources = track.sources;
      tracks.forEach(function(t) {
        for (var source in t.sources) {
          sources[ source ] = _.union( sources[ source ] , t.sources[ source ] );
        }
      });

      if (track) {
        self.broadcast({
            type: 'track'
          , data: _.extend( firstTrack , track )
          , sources: sources
          , seekTo: seekTo
        });
      } else {
        console.log('uhhh... broken: ' + app.room.playlist[0].sources['youtube'][0].id + ' and ' +track);
      }
    });
  });

  clearTimeout( self.timeout );
  self.timeout = setTimeout(function() {
    self.nextSong(); 
  }, (app.room.playlist[0].duration - seekTo) * 1000 );

  // TODO: delay by 30 seconds
  if (app.lastfm) {
    self.scrobbleActive( app.room.playlist[0] , function() {
      console.log('scrobbling complete!');
    });
  }

  return cb();

};

Soundtrack.prototype.trackFromSource = function(source, id, sourceCallback) {
  var self = this;
  var app = self.app;

  if (self.DEBUG) console.log('trackFromSource() : ' + source + ' ' + id );

  switch (source) {
    default:
      sourceCallback('Unknown source: ' + source);
    break;      
    case 'soundtrack':
      Track.findOne({ _id: id }).populate('_artist').exec( sourceCallback );
    break;
    case 'bandcamp':
      var obj = id;
      Artist.findOne({ slug: slug(obj.artist) }).exec(function(err, artist) {
        if (err || !artist) var artist = new Artist({ name: obj.artist });
        
        Track.findOne({
          slug: slug(obj.title),
          _artist: artist._id
        }).exec(function(err, track) {
          if (err || !track) var track = new Track({ title: obj.title, sources: obj.sources });
          
          track._artist = artist._id;
          track.duration = obj.duration;

          if (obj.thumbnail) {
            track.images.thumbnail = obj.thumbnail;
          }
          track.sources.bandcamp = [ {
            id: obj.id,

            data: {
              track: obj.id,
              url: obj.url,
              artwork_url: obj.artwork_url,
              size: 'large',
              bgcol: 'ffffff',
              linkcol: '0687f5',
              tracklist: false,
              transparent: true,
              baseUrl: 'http://bandcamp.com/EmbeddedPlayer/'
            }
          } ]

          console.log(track);
          
          artist.save(function(err) {
            if (err) console.log(err);
            track.save(function(err) {
              if (err) console.log(err);
              track._artist = artist;
              sourceCallback( err , track );
            });
          });
          
        });
        
      });
      break;
    case 'object':
      var obj = id;
      Artist.findOne({ slug: slug(obj.artist) }).exec(function(err, artist) {
        if (err || !artist) var artist = new Artist({ name: obj.artist });
        
        Track.findOne({
          slug: slug(obj.title),
          _artist: artist._id
        }).exec(function(err, track) {
          if (err || !track) var track = new Track({ title: obj.title });
          
          track._artist = artist._id;
          track.duration = obj.duration;
          
          artist.save(function(err) {
            if (err) console.log(err);
            track.save(function(err) {
              if (err) console.log(err);
              track._artist = artist;
              sourceCallback( err , track );
            });
          });
          
        });
        
      });
    break;
    case 'lastfm':
      // TODO: make this work at top level of this function
      var data = id;

      if (!data.url) { return sourceCallback('no url (id used for lastfm)'); }
      if (!data.name) { return sourceCallback('no title'); }
      
      Track.findOne({ 'sources.lastfm.id': data.url }).exec(function(err, track) {
        if (err) { return sourceCallback(err); }
        
        Artist.findOne({ $or: [
              { slug: slug( data.artist.name ) }
            , { name: data.artist.name }
        ] }).exec(function(err, artist) {
          if (err) { return sourceCallback(err); }
          
          if (!artist) {
            var artist = new Artist({ name: data.artist.name });
          }
          
          artist.tracking.tracks.updated = new Date();
          
          artist.save(function(err) {
            if (err) { return sourceCallback(err); }
            
            if (!track) {
              var track = new Track({
                  title: data.name
                , _artist: artist._id
                , duration: data.duration
                , sources: {
                    lastfm: [ {
                        id: data.url
                      , duration: data.duration
                      , data: data
                    } ]
                  }
              });
            }

            self.gatherSources( track , function(err, gatheredTrack) {
              // if there was an error, do NOT save!
              // this prevents tracks with no playable sources from saving to 
              // the database.
              if (err) {
                console.log( err );
                return sourceCallback(err);
              }
              
              track.save(function(err) {
                return sourceCallback( err , track );
              });
            });
            
          });
        });
      });
    break;
    case 'soundcloud':
      rest.get('https://api.soundcloud.com/tracks/'+parseInt(id)+'.json?client_id='+app.config.soundcloud.id).on('complete', function(data, response) {

        if (!data.title) { return sourceCallback('No video found.'); }

        var TRACK_SEPARATOR = ' - ';
        var stringToParse = (data.title.split( TRACK_SEPARATOR ).length > 1) ? data.title : data.user.username + ' - ' + data.title;

        util.parseTitleString( stringToParse , function(parts) {

          //console.log('parts: ' + JSON.stringify(parts) );

          // does the track already exist?
          Track.findOne({ $or: [
            { 'sources.soundcloud.id': data.id }
          ] }).exec(function(err, track) {
            if (!track) { var track = new Track({}); } // no? create a new one.

            // does the artist already exist?
            Artist.findOne({ $or: [
                  { _id: track._artist }
                , { slug: slug( parts.artist ) }
            ] }).exec(function(err, artist) {
              if (err) { console.log(err); }
              if (!artist) { var artist = new Artist({}); } // no? create a new one.

              artist.name = artist.name || parts.artist;

              artist.save(function(err) {
                if (err) { console.log(err); }

                track.title    = track.title    || parts.title;
                track._artist  = track._artist  || artist._id;
                track.duration = track.duration || data.duration / 1000;

                var sourceIDs = track.sources[ source ].map(function(x) { return x.id; });
                var index = sourceIDs.indexOf( data.id );
                if (index == -1) {
                  track.sources[ source ].push({
                      id: data.id
                    , data: data
                  });
                } else {
                  track.sources[ source ][ index ].data = data;
                }

                track.save(function(err) {
                  Artist.populate(track, {
                    path: '_artist'
                  }, function(err, track) {
                    sourceCallback(err, track);
                  });
                });

              });

            });

          });
        });
      });
    break;
    case 'youtube':
      self.getYoutubeVideo( id , function(track) {
        if (track) {
          return sourceCallback(null, track);
        } else {
          return sourceCallback('No track returned.');
        }
      });
    break;
  }
};

Soundtrack.prototype.getYoutubeVideo = function(videoID, internalCallback) {
  var self = this;
  var app = self.app;

  console.log('getYoutubeVideo() : ' + videoID );
  rest.get('http://gdata.youtube.com/feeds/api/videos/'+videoID+'?v=2&alt=jsonc').on('complete', function(data, response) {
    if (!data || !data.data) { return internalCallback('error retrieving video from youtube: ' + JSON.stringify(data) ); }

    var video = data.data;
    Track.findOne({
      'sources.youtube.id': video.id
    }).exec(function(err, track) {
      if (!track) { var track = new Track({ title: video.title }); }

      util.parseTitleString( video.title , function(parts) {

        if (self.DEBUG) console.log( video.title + ' was parsed into:');
        if (self.DEBUG) console.log(parts);

        async.mapSeries( parts.credits , function( artistName , artistCollector ) {
          Artist.findOne({ $or: [
                { slug: slug( artistName ) }
              , { name: artistName }
          ] }).exec( function(err, artist) {
            if (!artist) { var artist = new Artist({ name: artistName }); }
            artist.save(function(err) {
              if (err) { console.log(err); }
              artistCollector(err, artist);
            });
          });
        }, function(err, results) {

          Artist.findOne({ $or: [
                { _id: track._artist }
              , { slug: slug( parts.artist ) }
              , { name: parts.artist }
          ] }).exec(function(err, artist) {
            if (!artist) { var artist = new Artist({ name: parts.artist }); }
            artist.save(function(err) {
              if (err) { console.log(err); }

              // only use parsed version if original title is unchanged
              track.title = (track.title == video.title) ? parts.title : track.title;
              track._artist = artist._id;
              track._credits = results.map(function(x) { return x._id; });

              track.duration             = (track.duration) ? track.duration : video.duration;
              track.images.thumbnail.url = (track.images.thumbnail.url) ? track.images.thumbnail.url : video.thumbnail.sqDefault;

              var youtubeVideoIDs = track.sources.youtube.map(function(x) { return x.id; });
              var index = youtubeVideoIDs.indexOf( video.id );
              if (index == -1) {
                track.sources.youtube.push({
                    id: video.id
                  , data: video
                });
              } else {
                track.sources.youtube[ index ].data = video;
              }

              track.save(function(err) {
                if (err) { console.log(err); }

                // begin cleanup
                //track = track.toObject();
                track._artist = {
                    _id: artist._id
                  , name: artist.name
                  , slug: artist.slug
                };

                for (var source in track.sources.toObject()) {
                  for (var i = 0; i < track.sources[ source ].length; i++) {
                    delete track.sources[ source ].data;
                  }
                }
                // end cleanup

                internalCallback( track );
              });
            });
          });
        });
      });
    });
  });
};

Soundtrack.prototype.gatherSources = function(track , callback) {
  var self = this;

  var now = new Date();

  Artist.populate( track , {
    path: '_artist'
  }, function(err, track) {
    if (err) return callback(err);
    if (!track._artist) return callback('no artist provided');

    var fullTitle = track._artist.name + ' - ' + track.title;
    var query = encodeURIComponent( fullTitle );
    var lenMax = track.duration + (track.duration * 0.05);
    var lenMin = track.duration - (track.duration * 0.05);

    var maxTracks = 5;

    async.parallel([
      function(done) {
        rest.get('https://gdata.youtube.com/feeds/api/videos?max-results='+maxTracks+'&v=2&alt=jsonc&q=' + query ).on('complete', function(data) {
          var functions = [];

          if (data.data && data.data.items) {

            console.log('youtube videos gathered, %d videos', data.data.items.length);

            for (var i = 0; i < data.data.items.length; i++) {
              if (self.DEBUG) console.log('trying youtube %d', i );

              var item = data.data.items[ i ];
              if (item.title != fullTitle) { continue; }

              if (item.duration > lenMin && item.duration < lenMax) {
                functions.push( function(cb) {
                  self.trackFromSource( 'youtube' , item.id , cb );
                } );
              }
            }

            console.log('%d items, %e functions', data.data.items.length , functions.length );

          }

          async.parallel( functions , function( err , youtubeTracks ) {
            youtubeTracks.forEach(function(singleTrack) {
              if (!singleTrack.sources) {
                console.log('wattttttttttttttt', singleTrack);
                return;
              }
              singleTrack.sources.youtube.forEach(function(youtubeSource) {
                track.sources.youtube.push( youtubeSource );
              });
            });
            
            console.log('youtube complete!');
            done( err , youtubeTracks );
          });

        });
      },
      function(done) {
        rest.get('https://api.soundcloud.com/tracks.json?limit='+maxTracks+'&client_id=7fbc3f4099d3390415d4c95f16f639ae&q='+query).on('complete', function(data) {
          var functions = [];

          if (data instanceof Array) {

            console.log('soundcloud gathered, %d tracks', data.length);
            for (var i = 0; i < data.length; i++) {
              if (self.DEBUG) console.log('trying soundcloud %d', i );

              var item = data[ i ];
              item.duration = item.duration / 1000;
              if (item.duration > lenMin && item.duration < lenMax) {
                if (item.title != fullTitle) { continue; }

                functions.push( function(cb) {
                  self.trackFromSource( 'soundcloud' , item.id , cb );
                } );
              }
            }

            console.log('%d items, %e functions', data.length , functions.length );
          }

          async.parallel( functions , function( err , soundcloudTracks ) {
            
            soundcloudTracks.forEach(function(singleTrack) {
              if (!singleTrack) return;
              singleTrack.sources.soundcloud.forEach(function(soundcloudSource) {
                track.sources.soundcloud.push( soundcloudSource );
              });
            });
            
            console.log('soundcloud complete!');
            done( err , soundcloudTracks );
          });

        });
      }
    ], function(err, results) {
      console.log('all sources complete!');

      track.updated = new Date();
  
      var playableSources = 0;
      for (var source in track.sources) {
        if (!track.sources[ source ]) continue;
        for (var i = 0; i < track.sources[ source ].length; i++) {
          if (['soundcloud', 'youtube'].indexOf( source ) >= 0) playableSources += 1;
        }
      }
      
      if (!playableSources) {
        if (self.DEBUG) console.log('HEYYYYYYYYY NONE');
        return callback('No playable sources.');
      }

      if (self.DEBUG) console.log('saving...');

      track.save(function(err) {
        console.log('saved!', err);
        callback(err, results);
      });

    });
  });
}


Soundtrack.prototype.lastfmAuthSetup = function(req, res) {
  var self = this;
  var app = this.app;

  //var authUrl = lastfm.getAuthenticationUrl({ cb: ((config.app.safe) ? 'http://' : 'http://') + config.app.host + '/auth/lastfm/callback' });
  var authUrl = app.lastfm.getAuthenticationUrl({ cb: 'https://soundtrack.io/auth/lastfm/callback' });
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
