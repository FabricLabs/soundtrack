var config = require('./config');
var database = require('./db');
var util = require('./util');
var express = require('express');
var app = express();
var sys = require('sys');
var http = require('http');
var rest = require('restler');
var slug = require('speakingurl');
var async = require('async');
var redis = require('redis');
var sockjs = require('sockjs');
var LastFM = require('lastfmapi');
var _ = require('underscore');
var mongoose = require('mongoose');
var flashify = require('flashify');
var passport = require('passport');
var pkgcloud = require('pkgcloud');
var LocalStrategy = require('passport-local').Strategy;
var SpotifyStrategy = require('passport-spotify').Strategy;
var mongooseRedisCache = require('mongoose-redis-cache');
var RedisStore = require('connect-redis')(express);
var sessionStore = new RedisStore();
var cachify = require('connect-cachify');
var crypto = require('crypto');
var marked = require('marked');
var validator = require('validator');
  
/* var Agency = require('mongoose-agency');
app.agency = new Agency( database.source , {
  // timeout: 0.01
}); */

app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.set('strict routing', true);
app.use(cachify.setup( require('./assets') , {
  root: __dirname + '/public',
  production: true
}));
app.use(express.static(__dirname + '/public'));

app.use(express.methodOverride());
app.use(express.cookieParser(config.sessions.key));
app.use(express.bodyParser());
app.use(express.errorHandler());
app.use(express.session({
    key: 'sid'
  , secret: config.sessions.key
  , store: sessionStore
  , cookie: { maxAge : 604800000 , domain: '.' + config.app.host }
}));

app.use(passport.initialize());
app.use(passport.session());

Person       = require('./models/Person').Person;
Track        = require('./models/Track').Track;
Artist       = require('./models/Artist').Artist;
Play         = require('./models/Play').Play;
Playlist     = require('./models/Playlist').Playlist;
Source       = require('./models/Source').Source;
Chat         = require('./models/Chat').Chat;
Room         = require('./models/Room').Room;

passport.use(Person.createStrategy());

passport.serializeUser(function(user, done) {
  done(null, user._id);
});

passport.deserializeUser(function(userID, done) {
  Person.findOne({ _id: userID }).populate('_playlists').exec(function(err, user) {
    Playlist.find({ _creator: user._id }).exec(function(err, playlists) {
      if (user._playlists && !user._playlists.length && playlists.length) {
        user._playlists = playlists.map(function(x) { return x._id; });
        user.save(function(err) {
          done(null, user);
        });
      } else {
        done(null, user);
      }
    });
  });
});
app.use(function(req, res, next) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('X-Powered-By', 'beer.');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')

  res.locals.config = config;
  res.locals.user = req.user;
  res.charset = 'utf-8';
  
  var parts = req.headers.host.split('.');
  req.room = parts[0];

  if (req.param('iframe')) return res.render('iframe');

  Room.findOne({ slug: req.room }).exec(function(err, room) {

    req.roomObj = room;
    res.locals.room = room;
    
    if (!req.user) return next();
    
    Playlist.find({
      _creator: req.user._id
    }).sort('name').exec(function(err, playlists) {
      if (err) console.log(err);
      if (req.user && !req.user.username) {
        return res.redirect('/set-username');
      }
      
      res.locals.user.playlists = playlists;
      
      var listeningIn = [];
      for (var name in app.rooms) {
        listeningIn = _.union( listeningIn , _.toArray(app.rooms[ name ].listeners).map(function(x) {
          return x._id;
        }).filter(function(x) {
          return x.toString() == req.user._id.toString();
        }).map(function(x) {
          return name;
        }) );
      }
      res.locals.user.rooms = listeningIn;
      
      next();
    });
  });

});
app.use( flashify );

function requireRoom(req, res, next) {
  if (!req.roomObj) return res.status(404).render('404-room');
  return next();
}
function redirectToMainSite(req, res, next) {
  if (req.headers.host.split(':')[0] !== config.app.host) return res.redirect( ((config.app.safe) ? 'https://' : 'http://') + config.app.host + req.path );
  return next();
}

// 
var otherMarked = require('./lib/marked');
otherMarked.setOptions({
    sanitize: true
  , smartypants: true
});
var lexers = {
    chat: new marked.InlineLexer([], {sanitize: true, smartypants:true, gfm:true})
  , content: otherMarked
};
lexers.chat.rules.link = /^\[((?:\[[^\]]*\]|[^\]]|\](?=[^\[]*\]))*)\]\(\s*<?([^\s]*?)>?(?:\s+['"]([\s\S]*?)['"])?\s*\)/;

app.locals.pretty   = true;
app.locals.moment   = require('moment');
app.locals.marked   = otherMarked;
app.locals.lexers   = lexers;
app.locals.lexer    = lexers.content;
app.locals.sanitize = validator.sanitize;
app.locals._        = _;
app.locals.helpers  = require('./helpers').helpers;
String.prototype.capitalize = function(){
  return this.replace( /(^|\s)([a-z])/g , function(m,p1,p2){ return p1+p2.toUpperCase(); } );
};

var auth = require('./controllers/auth')
var pages = require('./controllers/pages')
var people = require('./controllers/people')
var playlists = require('./controllers/playlists')
var artists = require('./controllers/artists')
var tracks = require('./controllers/tracks')
var chat = require('./controllers/chat');
var rooms = require('./controllers/rooms');

function requireLogin(req, res, next) {
  if (req.user) {
    next(); // allow the next route to run
  } else {
    // require the user to log in
    res.status(401).render('login', {
      next: req.path
    })
  }
}

function authorize(role) {
  switch (role) {
    case 'editor':
    case 'admin':
      return function(req, res, next) {
        if (!req.user || !req.user.roles || req.user.roles.indexOf( role ) == -1) {
          res.status(401).send({
              status: 'error'
            , message: 'Not authorized.'
          });
        } else {
          return next();
        }
      };
    break;
  }
}

var sock = sockjs.createServer();
var server = http.createServer(app);

app.clients = {};

var backupTracks = [];
app.socketAuthTokens = [];

app.config = config;

var Soundtrack = require('./lib/soundtrack');
var soundtrack = new Soundtrack(app);
soundtrack.start();

app.post('/skip', requireLogin, function(req, res) {
  console.log('skip received from ' +req.user.username);
  var room = app.rooms[ req.room ];
  
  /* When first starting server, track is undefined, prevent this from erroring */
  var title;
  if (room.track) {
    title = room.track.title;
  } else {
    title = "Unknown";
  }

  room.nextSong(function() {
    console.log('skip.nextSong() called');
    res.send({ status: 'success' });
  
  
    //Announce who skipped this song
    res.render('partials/announcement', {
        message: {
            message: "&ldquo;" + title + "&rdquo; was skipped by " + req.user.username + "."
          , created: new Date()
        }
      }, function(err, html) {
        room.broadcast({
            type: 'announcement'
          , data: {
                formatted: html
              , created: new Date()
            }
        });
      }
    );

  });
  
});

/* temporary: generate top 10 playlist (from coding soundtrack's top 10) */
/* this will be in MongoDB soon...*/
/*/ async.parallel([
  function(done) {
    var fallbackVideos = ['meBNMk7xKL4', 'KrVC5dm5fFc', '3vC5TsSyNjU', 'vZyenjZseXA', 'QK8mJJJvaes', 'wsUQKw4ByVg', 'PVzljDmoPVs', 'YJVmu6yttiw', '7-tNUur2YoU', '7n3aHR1qgKM', 'lG5aSZBAuPs'];
    async.series(fallbackVideos.map(function(videoID) {
      return function(callback) {
        util.getYoutubeVideo(videoID, function(track) {
          if (track) { backupTracks.push( track.toObject() ); }
          callback();
        });
      };
    }), done);
  },
  function(done) {
    Track.find({}).limit(100).exec(function(err, fallbackVideos) {
      fallbackVideos.forEach(function(track) {
        if (track) { backupTracks.push( track.toObject() ); }
      });
      done();
    });
  }
], function(err, trackLists) {
  //app.nextSong();
}); /**/

sock.on('connection', function(conn) {
  
  app.clients[ conn.id ] = conn;
  var room = conn.headers.host.split('.')[0];
  if (!app.rooms[ room ]) return;
  var connRoom = app.rooms[ room ];

  conn.pongTime = (new Date()).getTime();

  conn.on('data', function(message) {
    var data = JSON.parse(message);
    switch (data.type) {
      //respond to pings
      case 'pong':
        conn.pongTime = (new Date()).getTime();
      break;

      //user is trying to authenticate their socket...
      //so we go ahead and look up the token they've sent us.
      //if they get it wrong, we just hang up :).
      case 'auth':
        var authData = data.authData;
        var matches = app.socketAuthTokens.filter(function(o){
          return o.token == authData;
        });

        if (1 == matches.length && matches[0].time > (new Date()).getTime() - 10000) {
          console.log("Connection auth success!", conn.id, matches[0].user.username);
          //TODO: I don't know where we want to store this information
          matches[0].user.connId = conn.id;
          matches[0].time = 0; //prohibit reuse
          conn.user = matches[0].user; //keep information for quits

          // TODO: strip salt, hash, etc.
          // We do this on /listeners.json, but if nothing else, we save memory.
          var previous = connRoom.listeners[ matches[0].user._id ] || { ids: [] };
          connRoom.listeners[ matches[0].user._id ] = {
              _id: matches[0].user._id
            , slug: matches[0].user.slug
            , username: matches[0].user.username
            , ids: _.union( previous.ids , [ conn.id ] ) // TODO: rename this to 'clients'
            , role: (matches[0].user.roles && matches[0].user.roles.indexOf('editor') >= 0) ? 'editor' : 'listener'
            , roles: matches[0].user.roles
            , avatar: matches[0].user.avatar
          };
          
          connRoom.broadcast({
              type: 'join'
            , data: {
                  _id: matches[0].user._id
                , username: matches[0].user.username
                , slug: matches[0].user.slug
              }
          });

        } else {
          console.log("Connection auth failure!");
          conn.close();
        }
      break;

      //echo anything else
      default:
        conn.write(message);
      break;
    }
  });

  if (app.rooms[ room ].playlist[0]) {
    Track.findOne({ _id: app.rooms[ room ].playlist[0]._id }).populate('_artist _artists').exec(function(err, track) {
      if (err) { console.log(err); }
      if (!track) { return; }

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

        conn.write(JSON.stringify({
            type: 'track'
          , data: _.extend( app.rooms[ room ].playlist[0] , track )
          , seekTo: (Date.now() - app.rooms[ room ].playlist[0].startTime) / 1000
          , sources: sources
        }));

      });
    });
  }

  conn.on('close', function() {
    if (conn.user) {
      console.log("connection closed for user " + conn.user.username);

      if (conn.user && app.rooms[ room ].listeners[ conn.user._id ]) {
        app.rooms[ room ].listeners[ conn.user._id ].ids = _.reject( app.rooms[ room ].listeners[ conn.user._id ].ids , function(x) {
          return x == conn.id;
        });
      }

      for (var userID in app.rooms[ room ].listeners) {
        if (app.rooms[ room ].listeners[ userID ].ids.length === 0) {
          delete app.rooms[ room ].listeners[ userID ];
          connRoom.broadcast({
              type: 'part'
            , data: {
                _id: userID
              }
          });

        }
      }
    }

    delete app.clients[conn.id];

  });
});
sock.installHandlers(server, {prefix:'/stream'});

var soundtracker = function(req, res, next) {
  req.soundtrack = soundtrack;
  next();
};


if (config.spotify && config.spotify.id && config.spotify.secret) {
  passport.use(new SpotifyStrategy({
    clientID: config.spotify.id,
    clientSecret: config.spotify.secret,
    callbackURL: ((config.app.safe) ? 'https://' : 'http://') + config.app.host + '/auth/spotify/callback',
    passReqToCallback: true
  }, function(req, accessToken, refreshToken, profile, done) {
    console.log('spotify profile', profile);
    console.log('access token', accessToken);
    console.log('refreshToken', refreshToken);
    
    Person.findOne({ $or: [
        { _id: (req.user) ? req.user._id : undefined }
      , { 'profiles.spotify.id': profile.id }
    ]}).exec(function(err, person) {
      if (!person) var person = new Person({ username: profile.username });
      
      person.profiles.spotify = {
        id: profile.id,
        token: accessToken,
        updated: new Date(),
        expires: null
      }
      
      person.save(function(err) {
        if (err) console.log('serious error', err );
        done(err, person);
      });
      
    });
  }));
  
  app.get('/auth/spotify', passport.authenticate('spotify') );
  app.get('/auth/spotify/callback', passport.authenticate('spotify') , function(req, res) {
    res.redirect('/');
  });
  
  app.get('/sets/sync/spotify', soundtracker , playlists.syncSetup );
  
}

if (config.lastfm && config.lastfm.key && config.lastfm.secret) {
  var lastfm = new LastFM({
      api_key: config.lastfm.key
    , secret:  config.lastfm.secret
  });
  app.LastFM = LastFM;
  app.lastfm = lastfm;
  app.get('/auth/lastfm', function(req, res) {
    var authUrl = lastfm.getAuthenticationUrl({ cb: ((config.app.safe) ? 'https://' : 'http://') + config.app.host + '/auth/lastfm/callback' });
    //var authUrl = lastfm.getAuthenticationUrl({ cb: ((config.app.safe) ? 'http://' : 'http://') + 'soundtrack.io/auth/lastfm/callback' });
    res.redirect(authUrl);
  });
  app.get('/auth/lastfm/callback', function(req, res) {
    lastfm.authenticate( req.param('token') , function(err, session) {
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
  });
}

app.get('/', function(req, res, next) {
  if (req.roomObj) return next();
  if (req.headers.host.split(':')[0] === config.app.host) return next();

  return res.render('404-room');
}, pages.index );
app.get('/about', redirectToMainSite , pages.about );

app.get('/playlist.json', requireRoom , function(req, res) {
  res.send( app.rooms[ req.room ].playlist );
});

app.get('/listeners.json', requireRoom , function(req, res) {
  res.send( _.toArray( soundtrack.app.rooms[ req.room ].listeners ) );
});

app.get('/listening', requireLogin , function(req, res) {
  res.send( res.locals.user.rooms );
});

//client requests that we give them a token to auth their socket
//we generate a 32 byte (256bit) token and send that back.
//But first we record the token's authData, user and time.
//We use the recorded time to make sure we issued the token recently
app.post('/socket-auth', requireLogin, auth.configureToken);

app.post('/chat', requireLogin, function(req, res) {
  var room = app.rooms[ req.room ];
  if (!room) return next();
  
  var chat = new Chat({
      _author: req.user._id
    , message: req.param('message')
    , _track: (room.playlist[0]) ? room.playlist[0]._id : undefined
    , _room: (room) ? room._id : undefined
  });
  chat.save(function(err) {
    res.render('partials/message', {
      message: {
          _author: req.user
        , message: req.param('message')
        , created: chat.created
        , _track: room.playlist[0]
      }
    }, function(err, html) {
      room.broadcast({
          type: 'chat'
        , data: {
              _id: chat._id
            , _author: {
                  _id: req.user._id
                , username: req.user.username
                , slug: req.user.slug
              }
            , message: req.param('message')
            , formatted: html
            , created: new Date()
            , _track: room.playlist[0]
          }
      });
      res.send({ status: 'success' });
    });
  });
});

app.del('/playlist/:trackID', requireLogin, authorize('admin'), function(req, res, next) {
  if (!req.param('index') || req.param('index') == 0) { return next(); }

  var room = app.rooms[ req.room ];

  room.playlist.splice( req.param('index') , 1 );
  room.sortPlaylist();

  soundtrack.broadcast({
    type: 'playlist:update'
  });

  res.send({
    status: 'success'
  });

});

app.post('/playlist/:trackID', requireLogin, function(req, res, next) {
  var room = app.rooms[ req.room ];
  
  var playlistMap = room.playlist.map(function(x) {
    return x._id.toString();
  });
  var index = playlistMap.indexOf( req.param('trackID') );

  if (!index) { return next(); }
  if (!room.playlist[ index ].votes) { room.playlist[ index ].votes = {}; }

  room.playlist[ index ].votes[ req.user._id ] = (req.param('v') == 'up') ? 1 : -1;
  room.playlist[ index ].score = _.reduce( room.playlist[ index ].votes , function(score, vote) {
    return score + vote;
  }, 0);

  console.log('track score: ' + room.playlist[ index ].score);
  console.log('track votes: ' + JSON.stringify(room.playlist[ index ].votes));

  room.sortPlaylist();
  room.savePlaylist(function() {
    room.broadcast({
      type: 'playlist:update'
    });
  
    res.send({
      status: 'success'
    });
  });
});

app.post('/playlist', requireLogin , function(req, res) {
  console.log('playlist endpoint hit with POST...');
  
  if (!req.room) res.send({ status: 'error', message: 'No room to queue to.' });
  if (!app.rooms[ req.room ]) res.send({ status: 'error', message: 'No room to queue to.' });
  
  if (!req.roomObj && res.locals.user.rooms.length) {
    req.room = res.locals.user.rooms[ 0 ];
  }

  soundtrack.trackFromSource( req.param('source') , req.param('id') , function(err, track) {
    console.log('trackFromSource() callback executing...')
    if (err || !track) {
      console.log(err);
      return res.send({ status: 'error', message: 'Could not add that track.' });
    }
    
    app.rooms[ req.room ].queueTrack(track, req.user, function() {
      console.log( 'queueTrack() callback executing... ');
      res.send({ status: 'success', message: 'Track added successfully!' });
    });
  });
});

app.post('/:usernameSlug/playlists', requireLogin, playlists.create );
app.post('/:usernameSlug/playlists/:playlistID', requireLogin, playlists.addTrack );
app.post('/:usernameSlug/playlists/:playlistID/edit', requireLogin, playlists.edit ); // TODO: fix URL

app.post('/:usernameSlug/sets', requireLogin, playlists.create );
app.post('/:usernameSlug/sets/:playlistID', requireLogin, playlists.addTrack );
app.post('/:usernameSlug/sets/:playlistID/edit', requireLogin, playlists.edit ); // TODO: fix URL

app.get('/register', redirectToMainSite , function(req, res) {
  res.render('register');
});

app.post('/register', function(req, res) {
  async.parallel([
    function(done) {
      Person.count({ slug: slug( req.body.username ) }).exec(function(err, count) {
        done( count );
      });
    },
    function(done) {
      Artist.count({
        slug: slug( req.body.username ),
        slugs: slug( req.body.username )
      }).exec(function(err, count) {
        done( count );
      });
    }
  ], function(err) {
    if (err) {
      req.flash('error', 'That username is already taken!');
      return res.redirect('/register');
    }

    Person.register(new Person({ username : req.body.username }), req.body.password, function(err, user) {
      if (err) {
        console.log(err);
        req.flash('error', 'Something went wrong: ' + err);
        return res.render('register', { user : user });
      } else {
        req.logIn(user, function(err) {
          req.flash('info', 'Welcome to soundtrack.io!');
          res.redirect('/');
        });
      }
    });
    
  });
});

app.get('/set-username', requireLogin, people.setUsernameForm);
app.post('/set-username', requireLogin, people.setUsername);

app.post('/settings', requireLogin, function(req, res, next) {
  Person.findOne({ _id: req.user._id }).exec(function(err, person) {
    person.preferences.scrobble = (req.param('scrobble')) ? true: false;
    person.save(function(err) {
      res.send({
          status: 'success'
        , message: 'Preferences updated successfully!'
      });
    });
  });
});

app.get('/login', function(req, res) {
  res.render('login', {
    next: req.param('next')
  });
});

app.post('/login', passport.authenticate('local', {
    failureRedirect: '/login'
  , failureFlash: true
}), function(req, res) {
  req.flash('info', 'Welcome to soundtrack.io!');
  res.redirect('/');
});

app.get('/logout', function(req, res) {
  req.logout();
  req.flash('info', 'You\'ve been logged out.');
  res.redirect('/');
});

app.get('/history', requireRoom , pages.history);
app.get('/people', redirectToMainSite , people.list);
app.get('/artists', artists.list);
app.get('/tracks', tracks.list);
app.get('/pool', requireRoom , tracks.pool);
app.get('/chat', requireRoom , chat.view);
app.get('/chat/since.json', requireRoom , chat.since);
app.get('/rooms', rooms.list );
app.post('/rooms', requireLogin , soundtracker , rooms.create );
app.get('/sets', redirectToMainSite , playlists.list );
app.get('/stats', pages.stats );

app.get('/:artistSlug/:trackSlug/:trackID',  redirectToMainSite ,  soundtracker , tracks.view);
app.post('/:artistSlug/:trackSlug/:trackID', authorize('editor') , soundtracker , tracks.edit);
app.get('/tracks/:trackID', redirectToMainSite ,                   soundtracker , tracks.view );
app.post('/tracks/:trackID',                 authorize('editor') , soundtracker , tracks.edit);

app.get('/:artistSlug',  redirectToMainSite , soundtracker , artists.view);
app.del('/:artistSlug', soundtracker , authorize('admin') , artists.delete);
app.put('/:artistSlug', soundtracker , authorize('editor') , artists.edit);
app.post('/:artistSlug', soundtracker , authorize('editor') , artists.edit);

app.del('/playlists/:playlistID/:index', playlists.removeTrackFromPlaylist);
app.del('/playlists/:playlistID', playlists.delete);
app.get('/:usernameSlug/sets/new',  redirectToMainSite , playlists.createForm);
app.get('/:usernameSlug/sets',  redirectToMainSite , playlists.listPerson);
app.get('/:usernameSlug/playlists/new', redirectToMainSite , playlists.createForm);

app.get('/:usernameSlug/:playlistSlug', playlists.view);
app.get('/:usernameSlug/plays', people.listPlays);
app.get('/:usernameSlug/mentions', people.mentions);
app.get('/:usernameSlug', redirectToMainSite , people.profile);
app.post('/:usernameSlug', people.edit);

// catch-all route (404)
app.get('*', function(req, res) {
  res.status(404).render('404');
});

function getTop100FromCodingSoundtrack(done) {
  rest.get('http://codingsoundtrack.org/songs/100.json').on('complete', function(data) {
    async.parallel(data.map(function(song) {
      return function(callback) {
        if (song.format == '1') {
          util.getYoutubeVideo( song.cid , function(track) {
            if (track) {
              callback( track.toObject() );
            } else {
              callback('not a youtube video');
            }
          });
        } else {
          callback();
        }
      }
    }), function(err, songs) {
      done();
    });
  });
}

app.redis = redis.createClient();
app.redis.on('error', function(err) {
  console.error("Error connecting to redis", err);
});

Room.find().exec(function(err, rooms) {
  if (!rooms.length) {
    console.log('no known rooms.  configuring...');
    var room = new Room({
      name: 'Coding Soundtrack',
      slug: 'coding'
    });
    
    async.series([
      function(done) { Chat.update({}, { $set: { _room: room._id } }, { multi: true }).exec( done ); },
      function(done) { Play.update({}, { $set: { _room: room._id } }, { multi: true }).exec( done ); }
    ], function(err, results) {
      if (err) throw new Error( err );
      
      room.save(function(err) {
        room.bind( soundtrack );
        // port queue, if any
        app.redis.get(config.database.name + ':playlist', function(err, playlist) {
          room.playlist = JSON.parse( playlist );
          room.savePlaylist(function() {
            console.log('all configured.  start the process again.');
            process.exit();
          });
        });
      });
    });

  } else {
      
      // monolithic core for now.
      app.rooms = {};
      var jobs = rooms.map(function(room) {
        return function(done) {
          app.redis.get(config.database.name + ':rooms:' + room.slug + ':playlist', function(err, playlist) {
            playlist = JSON.parse(playlist);
            room.playlist = playlist;
            //console.log('room playlist:', room.playlist );// process.exit();
        
            if (!playlist || !playlist.length) playlist = [];
            
            app.rooms[ room.slug ] = room;
            app.rooms[ room.slug ].playlist = playlist;
            app.rooms[ room.slug ].listeners = {};
            
            app.rooms[ room.slug ].bind( soundtrack );
            
            function errorHandler(err) {
              if (err) {
                return app.rooms[ room.slug ].retryTimer = setTimeout(function() {
                  app.rooms[ room.slug ].startMusic( errorHandler );
                }, 5000 );
              }
              
              return done();
            }
            
            app.rooms[ room.slug ].startMusic( errorHandler );
    
          });
        };
      });
      
      console.log( jobs.length.toString() , 'rooms found, configuring...');
    
      async.parallel( jobs , function(err, results) {
        
        app.locals.rooms = app.rooms;
        
        server.listen(config.app.port, function(err) {
          console.log('Listening on port ' + config.app.port + ' for HTTP');
          console.log('Must have redis listening on port 6379');
          console.log('Must have mongodb listening on port 27017');
        });
      });
  }

});
