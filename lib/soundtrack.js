var _ = require('underscore');
var util = require('../util');
var rest = require('restler');
var async = require('async');
var slug = require('speakingurl');

var YouTube = require('./YouTube');

var Soundtrack = function(app) {
  var self = this;

  this.app = app;
  this.app.rooms = {};
  this.backupTracks = [];
  this.timers = {
    scrobble: {}
  };

  this.DEBUG = false;

  this.youtube = new YouTube('AIzaSyBnCN68b8W5oGgBKKkM2cSQhSygnLPApEs');

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
          if (!room.playlist[ i ]._id || !msg.track._id) return console.error('no id somewhere...');
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

Soundtrack.prototype.trackFromSource = function(source, id, data, sourceCallback) {
  var self = this;
  var app = self.app;

  if (self.DEBUG) console.log('trackFromSource() : ' + source + ' ' + id );

  if (typeof data === 'function') {
    sourceCallback = data;
    data = {};
  }

  switch (source) {
    default:
      sourceCallback('Unknown source: ' + source);
    break;
    case 'direct':
      Track.findOne({ 'sources.direct.uri': id  }).populate('_artist').exec(function(err, track) {
        if (track) return sourceCallback(err, track);
        
        var track = new Track({
          title: data.title || 'Unknown',
          duration: data.duration || 300
        });
        
        var artistName = data.artist || 'unknown';
        
        Artist.findOne({ slug: slug(artistName) }).exec(function(err, artist) {
          track._artist = (artist && artist._id) ? artist._id : new Artist({ name: artistName });
          track.sources.direct = [{ uri: id }];
          track.save(function(err) {
            console.log('TRACK SAVED', err);
            sourceCallback(err, track);            
          });
        });
        
      });
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

              if (app.config.jobs && app.config.jobs.enabled) {
                app.agency.publish('track:crawl', {
                  id: track._id
                }, function(err) {
                  console.log('track crawling completed');
                });
              }

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
        console.log(response);
        if (!data.title) return sourceCallback('No Soundcloud track found in ' , data );

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

  self.youtube._getVideo( videoID , function(err, video) {
    if (err || !video) return internalCallback('error retrieving video from youtube, ' + (err || video));

    Track.findOne({
      'sources.youtube.id': video.id
    }).exec(function(err, track) {
      if (err) console.error( err );
      if (track) {
        return Artist.populate( track , {
          path: '_artist'
        }, function(err, track) {
          internalCallback( track );
        });
      }

      var track = new Track({ title: video.title });

      util.parseTitleString( video.title , function(parts) {

        if (self.DEBUG) console.log( video.title + ' was parsed into:');
        if (self.DEBUG) console.log(parts);

        async.mapSeries( parts.credits , function( artistName , artistCollector ) {
          Artist.findOne({ $or: [
                { slug: slug( artistName ) }
              , { name: artistName }
          ] }).exec( function(err, artist) {
            if (!artist) var artist = new Artist({ name: artistName });

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
            if (!artist) var artist = new Artist({ name: parts.artist });
            artist.save(function(err) {
              if (err) console.log(err);

              // only use parsed version if original title is unchanged
              track.title = (track.title == video.title) ? parts.title : track.title;
              track._artist = artist._id;
              track._credits = results.map(function(x) { return x._id; });
              console.log(video);
              track.duration             = (track.duration) ? track.duration : video.duration;
              track.images.thumbnail.url = (track.images.thumbnail.url) ? track.images.thumbnail.url : video.images.default.url;

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
                if (err) console.log(err);

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
