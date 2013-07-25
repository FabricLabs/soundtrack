var config = require('./config')
  , database = require('./db')
  , express = require('express')
  , app = express()
  , sys = require('sys')
  , http = require('http')
  , rest = require('restler')
  , slug = require('slug-component')
  , async = require('async')
  , redis = require('redis')
  , sockjs = require('sockjs')
  , _ = require('underscore')
  , mongoose = require('mongoose')
  , flashify = require('flashify')
  , passport = require('passport')
  , pkgcloud = require('pkgcloud')
  , LocalStrategy = require('passport-local').Strategy
  , mongooseRedisCache = require('mongoose-redis-cache')
  , RedisStore = require('connect-redis')(express)
  , sessionStore = new RedisStore({ client: database.client })
  , crypto = require('crypto')
  , marked = require('marked')
  , validator = require('validator');

app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.set('strict routing', true);
app.use(express.static(__dirname + '/public'));

app.use(express.methodOverride());
app.use(express.cookieParser(config.sessions.key));
app.use(express.bodyParser());
app.use(express.errorHandler());
app.use(express.session({
    key: 'sid'
  , secret: config.sessions.key
  , store: sessionStore
}));
app.use(passport.initialize());
app.use(passport.session());

Person       = require('./models/Person').Person;
Track        = require('./models/Track').Track;
Artist       = require('./models/Artist').Artist;
Play         = require('./models/Play').Play;
Playlist     = require('./models/Playlist').Playlist;
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
  app.locals.user = req.user;
  next();
});
app.use( flashify );

var lexers = {
    chat: new marked.InlineLexer([], {sanitize: true, smartypants:true, gfm:true})
  , content: new marked.InlineLexer([], {sanitize: true, smartypants:true, gfm:true})
};
lexers.chat.rules.link = /^\[((?:\[[^\]]*\]|[^\]]|\](?=[^\[]*\]))*)\]\(\s*<?([^\s]*?)>?(?:\s+['"]([\s\S]*?)['"])?\s*\)/;

app.locals.pretty   = true;
app.locals.moment   = require('moment');
app.locals.marked   = marked;
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
  , tracks = require('./controllers/tracks');

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

var sock = sockjs.createServer();
var server = http.createServer(app);

app.clients = {};

var backupTracks = [];
var fallbackVideos = ['meBNMk7xKL4', 'KrVC5dm5fFc', '3vC5TsSyNjU', 'vZyenjZseXA', 'QK8mJJJvaes', 'wsUQKw4ByVg', 'PVzljDmoPVs', 'YJVmu6yttiw', '7-tNUur2YoU', '7n3aHR1qgKM', 'lG5aSZBAuPs'];

app.redis = redis.createClient();
app.redis.get('soundtrack:playlist', function(err, playlist) {
  console.log('playlist: ' + playlist);
  playlist = JSON.parse(playlist);

  if (!playlist || !playlist.length) {
    playlist = ['ONyAv1HWDo0'];
  }

  app.room = {
      track: undefined
    , playlist: playlist
    , listeners: {}
  };

  async.series(fallbackVideos.map(function(videoID) {
    return function(callback) {
      getYoutubeVideo(videoID, function(track) {
        backupTracks.push( track.toObject() );
        callback();
      });
    };
  }), function(err, results) {
    // start streaming. :)
    startMusic();
  });
  
});
app.socketAuthTokens = [];

//Send a message to all connected sockets
app.broadcast = function(msg) {
  var json = JSON.stringify(msg);
  for (var id in app.clients) {
    app.clients[id].write(json);
  }
};

//Send a message to a specific socket
app.whisper = function(id, msg) {
  var json = JSON.stringify(msg);
  app.clients[id].write(json);
}

//Ping all connected clients
app.markAndSweep = function(){
  app.broadcast({type: 'ping'}); // we should probably not do this globally... instead, start interval after client connect?
  var time = (new Date()).getTime();
  app.forEachClient(function(client, id){
    if (client.pongTime < time - config.connection.clientTimeout) {
      client.close('', 'Timeout');
      // TODO: broadcast part message
      /*/app.broadcast({
          type: 'part'
        , data: {
            id: conn.id
          }
      });/**/
    }
  });
}

setInterval(app.markAndSweep, config.connection.checkInterval);

app.forEachClient = function(fn) {
  for (var id in app.clients) {
    fn(app.clients[id], id)
  }
}

//Get data from youtube for a specified videoID
function getYoutubeVideo(videoID, callback) {
  rest.get('http://gdata.youtube.com/feeds/api/videos/'+videoID+'?v=2&alt=jsonc').on('complete', function(data) {
    if (data && data.data) {
      var video = data.data;
      Track.findOne({
        'sources.youtube.id': video.id
      }).exec(function(err, track) {
        if (!track) { var track = new Track({}); }

        // this is bad for now, until we have an importer...
        // it'll be slow.
        rest.get('http://codingsoundtrack.org/songs/1:'+video.id+'.json').on('complete', function(data) {

          // hack to allow title re-parsing
          // be cautious here if we ever store the video titles
          //video.title = track.title || video.title;

          // TODO: load from datafile
          var baddies = ['[hd]', '[dubstep]', '[electro]', '[edm]', '[house music]', '[glitch hop]', '[video]', '[official video]', '[free download]', '[free DL]', '[monstercat release]'];
          baddies.forEach(function(token) {
            video.title = video.title.replace(token + ' - ', '').trim();
            video.title = video.title.replace(token.toUpperCase() + ' - ', '').trim();
            video.title = video.title.replace(token.capitalize() + ' - ', '').trim();

            video.title = video.title.replace(token, '').trim();
            video.title = video.title.replace(token.toUpperCase(), '').trim();
            video.title = video.title.replace(token.capitalize(), '').trim();
          });

          // if codingsoundtrack.org isn't aware of it...
          if (!data.author) {
            var parts = video.title.split(' - ');
            data = {
                author: parts[0].trim()
              , title: (track.title) ? track.title : video.title
            };
          }

          Artist.findOne({ $or: [
                { _id: track._artist }
              , { slug: slug( data.author ) }
              , { name: data.author }
          ] }).exec(function(err, artist) {

            if (!artist) { var artist = new Artist({
              name: data.author
            }); }

            track._artist = artist._id;

            var youtubeVideoIDs = track.sources.youtube.map(function(x) { return x.id; });
            var index = youtubeVideoIDs.indexOf( video.id );
            if (index == -1) {
              track.sources.youtube.push({
                id: video.id
              });
            }

            // if the track doesn't already have a title, set it from 
            if (!track.title) {
              track.title = data.title || video.title;
            }

            track.duration             = (track.duration) ? track.duration : video.duration;
            track.images.thumbnail.url = video.thumbnail.hqDefault;

            // TODO: use CodingSoundtrack.org's lookup for artist creation
            //Author.findOne()
            artist.save(function(err) {
              if (err) { console.log(err); }
              track.save(function(err) {
                if (err) { console.log(err); }

                Artist.populate(track, {
                  path: '_artist'
                }, function(err, track) {

                  console.log( 'being sent back:')
                  console.log( track );

                  callback( track );
                });

              });
            });
          });
        });
      });
    } else {
      console.log('waaaaaaaaaaat  videoID: ' + videoID);
      console.log(data);

      callback();
    }
  });
};


function nextSong() {
  // remove the first track in the playlist...
  var lastTrack = app.room.playlist.shift();

  if (app.room.playlist.length == 0) {
    app.room.playlist.push( _.extend( backupTracks[ _.random(0, backupTracks.length - 1 ) ] , {
        score: 0
      , votes: {}
    } ) );
  }

  app.room.playlist[0].startTime = Date.now();
  app.room.track = app.room.playlist[0];

  app.redis.set("soundtrack:playlist", JSON.stringify( app.room.playlist ) );

  var play = new Play({
      _track: app.room.playlist[0]._id
    , _curator: (app.room.playlist[0].curator) ? app.room.playlist[0].curator._id : undefined
  });
  play.save(function(err) {
    // ...then start the music.
    startMusic();
  });

}

function startMusic() {
  console.log('startMusic() called, current playlist is: ' + JSON.stringify(app.room.playlist));

  var seekTo = (Date.now() - app.room.playlist[0].startTime) / 1000;
  app.room.track = app.room.playlist[0];
  
  getYoutubeVideo(app.room.playlist[0].sources['youtube'][0].id, function(track) {
    app.broadcast({
        type: 'track'
      , data: _.extend( track.toObject(), app.room.playlist[0] )
      , seekTo: seekTo
    });
  });

  clearTimeout( app.timeout );

  app.timeout = setTimeout( nextSong , (app.room.playlist[0].duration - seekTo) * 1000 );

}

function sortPlaylist() {
  app.room.playlist = _.union( [ app.room.playlist[0] ] , app.room.playlist.slice(1).sort(function(a, b) {
    if (b.score == a.score) {
      return a.timestamp - b.timestamp;
    } else {
      return b.score - a.score;
    }
  }) );
}

//Skip the currently playing song
app.post('/skip', /*/requireLogin,/**/ function(req, res) {
  console.log('skip received:');
  console.log(req.user);
  console.log(req.headers);
  
  //Announce who skipped this song
  app.broadcast({
      type: 'announcement'
    , data: {
          message: "'" + app.room.track.title + "' was skipped by " + req.user.username + "."
        , created: new Date()
      }
  });
  
  nextSong();
  res.send({ status: 'success' });
});

/* temporary: generate top 10 playlist (from coding soundtrack's top 10) */
/* this will be in MongoDB soon...*/
async.parallel([
  function(done) {
    var fallbackVideos = ['meBNMk7xKL4', 'KrVC5dm5fFc', '3vC5TsSyNjU', 'vZyenjZseXA', 'QK8mJJJvaes', 'wsUQKw4ByVg', 'PVzljDmoPVs', 'YJVmu6yttiw', '7-tNUur2YoU', '7n3aHR1qgKM', 'lG5aSZBAuPs'];
    async.series(fallbackVideos.map(function(videoID) {
      return function(callback) {
        getYoutubeVideo(videoID, function(track) {
          backupTracks.push( track.toObject() );
          callback();
        });
      };
    }), done);
  },
  function(done) {
    Track.find({}).limit(100).exec(function(err, fallbackVideos) {
      fallbackVideos.forEach(function(track) {
        backupTracks.push( track.toObject() );
      });
      done();
    });
  }
], function(err, trackLists) {
  //nextSong();
});

sock.on('connection', function(conn) {
  
  app.clients[ conn.id ] = conn;

  conn.pongTime = (new Date()).getTime();

  conn.on('data', function(message) {
    try {
      var data = JSON.parse(message);
    }
    catch (e) {
      //http://tools.ietf.org/html/rfc6455#section-7.4
      conn.close(1003, "Invalid JSON");
      return;
    }
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
          app.room.listeners[ matches[0].user._id ] = {
              _id: matches[0].user._id
            , slug: matches[0].user.slug
            , username: matches[0].user.username
            , id: conn.id
          };
          
          app.broadcast({
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
        
      case 'chat':
        if (conn.user) {
          var chat = new Chat({
              _author: conn.user._id
            , message: data.chat
          });
          
          chat.save(function(err) {
            res.render('partials/message', {
              message: data.chat
            }, function(err, html) {
              console.log('got socket chat', html);
              app.broadcast({
                  type: 'chat'
                , data: {
                      message: data.chat
                    , _author: {
                          _id: conn.user._id
                        , username: conn.user.username
                        , slug: conn.user.slug
                        , avatar: conn.user.avatar
                      }
                    , formatted: html
                    , created: new Date()
                  }
              });
              conn.write(JSON.stringify({ status: 'success' }));
            });
          });
        }
        else {
          conn.write(JSON.stringify({"error":"User not authenticated"}));
        }
        break;
        
      //echo anything else
      default:
        conn.write(message);
        break;
    }

  });

  //Send the newly connected client the current track data
  conn.write(JSON.stringify({
      type: 'track'
    , data: app.room.playlist[0]
    , seekTo: (Date.now() - app.room.playlist[0].startTime) / 1000
  }));

  conn.on('close', function() {
  
    //If this was an authenticated client then we should remove them from the listeners array
    if (conn.user) {
      console.log("connection closed for user " + conn.user.username);
      
      //Remove user from listeners array if this is their connection
      if (app.room.listeners[conn.user._id] && app.room.listeners[conn.user._id].id == conn.id) {
        delete app.room.listeners[conn.user._id];
      };
    }
    
    //Tell all connected clients about this disconnect
    app.broadcast({
        type: 'part'
      , data: {
            id: conn.id
          , _id: (conn.user) ? conn.user._id : undefined
        }
    });
    delete app.clients[conn.id];
  });
});
sock.installHandlers(server, {prefix:'/stream'});

app.get('/', pages.index);
app.get('/about', pages.about);
app.get('/angular/:view', function(req, res) {
  res.render('angular/'+req.param('view'));
});

//Get the list of songs currently in the playlist
app.get('/playlist.json', function(req, res) {
  res.send(app.room.playlist);
});

//Get list of users currently listening in the room
app.get('/listeners.json', function(req, res) {
  res.send( _.toArray( app.room.listeners ) );
});

//Get a list of connected clients
app.get('/clients.json', function(req, res) {
  res.send( _.toArray( app.clients ).map(function(client) {
    return client.user;
  }) );
});

//Get chat history
app.get('/chat.json', function(req, res) {
  Chat.find({}).lean().limit(20).sort('-created').populate('_author', {hash: 0, salt:0}).exec(function(err, messages) {
    async.map(messages, function(message, callback) {
      res.render('partials/message', {
        message: message.message
      }, function(err, html) {
        message.formatted = html;
        callback(false, message);
      });
    }, function(err, results) {;
      res.send(results);
    });
  });
});

//client requests that we give them a token to auth their socket
//we generate a 32 byte (256bit) token and send that back.
//But first we record the token's authData, user and time.
//We use the recorded time to make sure we issued the token recently
app.post('/socket-auth', requireLogin, auth.configureToken);

//Send a chat message
app.post('/chat', requireLogin, function(req, res) {
  var chat = new Chat({
      _author: req.user._id
    , message: req.param('message')
  });
  chat.save(function(err) {
    res.render('partials/message', {
      message: req.param('message')
    }, function(err, html) {
      app.broadcast({
          type: 'chat'
        , data: {
              message: req.param('message')
            , _author: {
                  _id: req.user._id
                , username: req.user.username
                , slug: req.user.slug
                , avatar: req.user.avatar
              }
            , formatted: html
            , created: new Date()
          }
      });
      res.send({ status: 'success' });
    });
  });
});

//Vote on a track
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

  sortPlaylist();

  app.broadcast({
    type: 'playlist:update'
  });

  res.send({
    status: 'success'
  });

});

//Add a track to the room playlist
app.post('/playlist', requireLogin, function(req, res) {
  switch(req.param('source')) {
    default:
      console.log('unrecognized source: ' + req.param('source'));
    break;
    case 'youtube':
      getYoutubeVideo(req.param('id'), function(track) {
        if (track) {
          console.log('HEYYYYY');
          console.log(track);

          app.room.playlist.push( _.extend( track.toObject() , {
              score: 0
            , votes: {} // TODO: auto-upvote?
            , timestamp: new Date()
            , curator: {
                  _id: req.user._id
                , id: (req.app.room.listeners[ req.user._id.toString() ]) ? req.app.room.listeners[ req.user._id.toString() ].connId : undefined
                , username: req.user.username
                , slug: req.user.slug
              }
          } ) );

          sortPlaylist();

          app.redis.set("soundtrack:playlist", JSON.stringify( app.room.playlist ) );

          app.broadcast({
              type: 'playlist:add'
            , data: track
          });
        }

        res.send({ status: 'success' });
      });
    break;
    // add a track via its soundtack _id
    case 'id':
      Track.findOne({'_id':req.param('id')}).exec(function(err, track) {
        if (track) {
          app.room.playlist.push( _.extend( track.toObject() , {
              score: 0
            , votes: {} // TODO: auto-upvote?
            , timestamp: new Date()
            , curator: {
                  _id: req.user._id
                , id: (req.app.room.listeners[ req.user._id.toString() ]) ? req.app.room.listeners[ req.user._id.toString() ].connId : undefined
                , username: req.user.username
                , slug: req.user.slug
              }
          } ) );
          
          sortPlaylist();

          app.redis.set("soundtrack:playlist", JSON.stringify( app.room.playlist ) );

          app.broadcast({
              type: 'playlist:add'
            , data: track
          });
          
          res.send({status: 'success'});
        }
        else {
          res.send(500, {status: 'error'})
        }
      });
    break;
  }
});

app.post('/:usernameSlug/playlists', requireLogin, playlists.create );
app.post('/:usernameSlug/playlists/:playlistID', requireLogin, playlists.addTrack );
app.get('/:usernameSlug/playlists', requireLogin, playlists.getPlaylists );

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

app.get('/:artistSlug/:trackSlug/:trackID', tracks.view);

app.get('/:artistSlug', artists.view);

app.get('/:usernameSlug', people.profile);
app.post('/:usernameSlug', people.edit);

function getTop100FromCodingSoundtrack(done) {
  rest.get('http://codingsoundtrack.org/songs/100.json').on('complete', function(data) {
    async.parallel(data.map(function(song) {
      return function(callback) {
        if (song.format == '1') {
          getYoutubeVideo( song.cid , function(track) {
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

server.listen(13000);
console.log('Listening on port 13000 for HTTP');
console.log('Must have redis listening on port 6379');
console.log('Must have mongodb listening on port 27017');
