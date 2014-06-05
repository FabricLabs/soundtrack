var config = require('./config')
  , database = require('./db')
  , util = require('./util')
  , express = require('express')
  , app = express()
  , sys = require('sys')
  , http = require('http')
  , rest = require('restler')
  , slug = require('speakingurl')
  , async = require('async')
  , redis = require('redis')
  , sockjs = require('sockjs')
  , LastFM = require('lastfmapi')
  , _ = require('underscore')
  , mongoose = require('mongoose')
  , flashify = require('flashify')
  , passport = require('passport')
  , pkgcloud = require('pkgcloud')
  , LocalStrategy = require('passport-local').Strategy
  , mongooseRedisCache = require('mongoose-redis-cache')
  , RedisStore = require('connect-redis')(express)
  , sessionStore = new RedisStore()
  , cachify = require('connect-cachify')
  , crypto = require('crypto')
  , marked = require('marked')
  , validator = require('validator');

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
  , cookie: { maxAge : 604800000 }
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

passport.use(Person.createStrategy());

passport.serializeUser(function(user, done) {
  done(null, user._id);
});

passport.deserializeUser(function(userID, done) {
  Person.findOne({ _id: userID }).exec(function(err, user) {
    done(null, user);
  });
});
app.use(function(req, res, next) {
  res.setHeader("X-Powered-By", 'beer.');
  res.locals.user = req.user;

  if (req.user && !req.user.username) {
    return res.redirect('/set-username');
  }

  next();
});
app.use( flashify );

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
  , pages = require('./controllers/pages')
  , people = require('./controllers/people')
  , playlists = require('./controllers/playlists')
  , artists = require('./controllers/artists')
  , tracks = require('./controllers/tracks')
  , chat = require('./controllers/chat');

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

if (config.lastfm && config.lastfm.key && config.lastfm.secret) {
  var lastfm = new LastFM({
      api_key: config.lastfm.key
    , secret:  config.lastfm.secret
  });
  app.LastFM = LastFM;
  app.lastfm = lastfm;
  app.get('/auth/lastfm', function(req, res) {
    //var authUrl = lastfm.getAuthenticationUrl({ cb: ((config.app.safe) ? 'http://' : 'http://') + config.app.host + '/auth/lastfm/callback' });
    var authUrl = lastfm.getAuthenticationUrl({ cb: ((config.app.safe) ? 'http://' : 'http://') + 'soundtrack.io/auth/lastfm/callback' });
    res.redirect(authUrl);
  });
  app.get('/auth/lastfm/callback', function(req, res) {
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
  });
}

var Soundtrack = require('./lib/soundtrack');
var soundtrack = new Soundtrack(app);

app.post('/skip', requireLogin, function(req, res) {
  console.log('skip received from ' +req.user.username);

  //Announce who skipped this song
  res.render('partials/announcement', {
      message: {
          message: "&ldquo;" + app.room.track.title + "&rdquo; was skipped by " + req.user.username + "."
        , created: new Date()
      }
    }, function(err, html) {
      soundtrack.broadcast({
          type: 'announcement'
        , data: {
              formatted: html
            , created: new Date()
          }
      });
    }
  );
  
  soundtrack.nextSong();
  res.send({ status: 'success' });
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
          var previous = soundtrack.app.room.listeners[ matches[0].user._id ] || { ids: [] };
          soundtrack.app.room.listeners[ matches[0].user._id ] = {
              _id: matches[0].user._id
            , slug: matches[0].user.slug
            , username: matches[0].user.username
            , ids: _.union( previous.ids , [ conn.id ] ) // TODO: rename this to 'clients'
            , role: (matches[0].user.roles && matches[0].user.roles.indexOf('editor') >= 0) ? 'editor' : 'listener'
            , avatar: matches[0].user.avatar
          };
          
          soundtrack.broadcast({
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

  if (app.room.playlist[0]) {
    Track.findOne({ _id: app.room.playlist[0]._id }).populate('_artist _artists').exec(function(err, track) {
      conn.write(JSON.stringify({
          type: 'track'
        , data: _.extend( app.room.playlist[0] , track )
        , seekTo: (Date.now() - app.room.playlist[0].startTime) / 1000
      }));
    });
  }

  conn.on('close', function() {
    if (conn.user) {
      console.log("connection closed for user " + conn.user.username);

      if (conn.user && app.room.listeners[ conn.user._id ]) {
        app.room.listeners[ conn.user._id ].ids = _.reject( app.room.listeners[ conn.user._id ].ids , function(x) {
          return x == conn.id;
        });
      }

      for (var userID in app.room.listeners) {
        if (app.room.listeners[ userID ].ids.length === 0) {
          delete app.room.listeners[ userID ];
          soundtrack.broadcast({
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

app.get('/', function(req, res, next) {
  console.log( 'HOSTNAME: ' + req.headers.host );
  //console.log(req);
  next();
}, pages.index);
app.get('/about', pages.about);

app.get('/playlist.json', function(req, res) {
  res.send( app.room.playlist );
});

app.get('/listeners.json', function(req, res) {
  res.send( _.toArray( soundtrack.app.room.listeners ) );
});

//client requests that we give them a token to auth their socket
//we generate a 32 byte (256bit) token and send that back.
//But first we record the token's authData, user and time.
//We use the recorded time to make sure we issued the token recently
app.post('/socket-auth', requireLogin, auth.configureToken);

app.post('/chat', requireLogin, function(req, res) {
  var chat = new Chat({
      _author: req.user._id
    , message: req.param('message')
    , _track: (app.room.playlist[0]) ? app.room.playlist[0]._id : undefined
  });
  chat.save(function(err) {
    res.render('partials/message', {
      message: {
          _author: req.user
        , message: req.param('message')
        , created: chat.created
        , _track: app.room.playlist[0]
      }
    }, function(err, html) {
      soundtrack.broadcast({
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
            , _track: app.room.playlist[0]
          }
      });
      res.send({ status: 'success' });
    });
  });
});

app.del('/playlist/:trackID', requireLogin, authorize('admin'), function(req, res, next) {
  if (!req.param('index') || req.param('index') == 0) { return next(); }

  app.room.playlist.splice( req.param('index') , 1 );
  soundtrack.sortPlaylist();
  app.redis.set( app.config.database.name + ':playlist', JSON.stringify( app.room.playlist ) );

  soundtrack.broadcast({
    type: 'playlist:update'
  });

  res.send({
    status: 'success'
  });

});

app.post('/playlist/:trackID', requireLogin, function(req, res, next) {

  var playlistMap = app.room.playlist.map(function(x) {
    return x._id.toString();
  });
  var index = playlistMap.indexOf( req.param('trackID') );

  if (!index) { return next(); }
  if (!app.room.playlist[ index].votes) { app.room.playlist[ index].votes = {}; }

  app.room.playlist[ index].votes[ req.user._id ] = (req.param('v') == 'up') ? 1 : -1;
  app.room.playlist[ index].score = _.reduce( app.room.playlist[ index].votes , function(score, vote) {
    return score + vote;
  }, 0);

  console.log('track score: ' + app.room.playlist[ index].score);
  console.log('track votes: ' + JSON.stringify(app.room.playlist[ index].votes));

  soundtrack.sortPlaylist();

  soundtrack.broadcast({
    type: 'playlist:update'
  });

  res.send({
    status: 'success'
  });

});

app.post('/playlist', requireLogin, function(req, res) {
  console.log('playlist endpoint hit with POST...')

  soundtrack.trackFromSource( req.param('source') , req.param('id') , function(err, track) {
    console.log('trackFromSource() callback executing...')
    if (err || !track) {
      console.log(err);
      return res.send({ status: 'error', message: 'Could not add that track.' });
    }

    soundtrack.queueTrack(track, req.user, function() {
      console.log( 'queueTrack() callback executing... ');
      res.send({ status: 'success', message: 'Track added successfully!' });
    });
  });
});

app.post('/:usernameSlug/playlists', requireLogin, playlists.create );
app.post('/:usernameSlug/playlists/:playlistID', requireLogin, playlists.addTrack );
app.post('/:usernameSlug/playlists/:playlistID/edit', requireLogin, playlists.edit ); // TODO: fix URL

app.get('/register', function(req, res) {
  res.render('register');
});

app.post('/register', function(req, res) {
  Person.findOne({ slug: slug( req.body.username ) }).exec(function(err, user) {
    if (user) {
      req.flash('error', 'That username is already taken!');
      return res.render('register', { user : user });
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

app.get('/history', pages.history);
app.get('/people', people.list);
app.get('/artists', artists.list);
app.get('/tracks', tracks.list);
app.get('/pool', tracks.pool);
app.get('/chat', chat.view);
app.get('/chat/since.json', chat.since);

app.get('/:artistSlug/:trackSlug/:trackID',                        soundtracker , tracks.view);
app.post('/:artistSlug/:trackSlug/:trackID', authorize('editor') , soundtracker , tracks.edit);
app.get('/tracks/:trackID',                                        soundtracker , tracks.view );
app.post('/tracks/:trackID',                 authorize('editor') , soundtracker , tracks.edit);

app.get('/:artistSlug', soundtracker , artists.view);

app.get('/:usernameSlug/:playlistSlug', playlists.view);
app.get('/:usernameSlug/plays', people.listPlays);
app.get('/:usernameSlug', people.profile);
app.post('/:usernameSlug', people.edit);

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

app.redis.get(config.database.name + ':playlist', function(err, playlist) {
  playlist = JSON.parse(playlist);

  if (!playlist || !playlist.length) {
    playlist = [];
  }

  app.room = {
      track: undefined
    , playlist: playlist
    , listeners: {}
  };

  server.listen(config.app.port, function(err) {
    console.log('Listening on port ' + config.app.port + ' for HTTP');
    console.log('Must have redis listening on port 6379');
    console.log('Must have mongodb listening on port 27017');

    soundtrack.startMusic(function(err, track) {
      /*/var seekTo = (Date.now() - app.room.playlist[0].startTime) / 1000;

      clearTimeout( soundtrack.timeout );
      soundtrack.timeout = setTimeout( soundtrack.nextSong , (app.room.playlist[0].duration - seekTo) * 1000 ); /**/
    });
  });

});
