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

if (config.lastfm && config.lastfm.key && config.lastfm.secret) {
  var lastfm = new LastFM({
      api_key: config.lastfm.key
    , secret:  config.lastfm.secret
  });
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
app.redis = redis.createClient();
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

  startMusic();

});
app.socketAuthTokens = [];

app.broadcast = function(msg) {
  var json = JSON.stringify(msg);
  for (var id in app.clients) {
    app.clients[id].write(json);
  }
};

app.whisper = function(id, msg) {
  var json = JSON.stringify(msg);
  app.clients[id].write(json);
}

app.markAndSweep = function(){
  app.broadcast({type: 'ping'}); // we should probably not do this globally... instead, start interval after client connect?
  var time = (new Date()).getTime();
  app.forEachClient(function(client, id){
    if (client.pongTime < time - config.connection.clientTimeout) {
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
}

setInterval(app.markAndSweep, config.connection.checkInterval);

app.forEachClient = function(fn) {
  for (var id in app.clients) {
    fn(app.clients[id], id)
  }
}

function getYoutubeVideo(videoID, internalCallback) {
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
          var baddies = ['[hd]', '[dubstep]', '[electro]', '[edm]', '[house music]', '[glitch hop]', '[video]', '[official video]', '(official video)', '[ official video ]', '[free download]', '[free DL]', '[monstercat release]'];
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
            if (parts.length == 2) {
              data.title = data.title.replace(data.author + ' - ', '').trim();

            }
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
                  internalCallback( track );
                });

              });
            });
          });
        });
      });
    } else {
      console.log('waaaaaaaaaaat  videoID: ' + videoID);
      console.log(data);

      internalCallback();
    }
  });
};

function ensureQueue(callback) {
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
        getYoutubeVideo( 'dQw4w9WgXcQ‎' , function(track) {
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
}

function nextSong() {
  ensureQueue(function() {
    app.room.playlist[0].startTime = Date.now();
    app.room.track = app.room.playlist[0];

    app.redis.set(config.database.name + ':playlist', JSON.stringify( app.room.playlist ) );

    var play = new Play({
        _track: app.room.playlist[0]._id
      , _curator: (app.room.playlist[0].curator) ? app.room.playlist[0].curator._id : undefined
    });
    play.save(function(err) {
      // ...then start the music.
      startMusic();
    });
  });
}

function startMusic() {
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
    return setTimeout(startMusic, 5000);
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

  app.timeout = setTimeout( nextSong , (app.room.playlist[0].duration - seekTo) * 1000 );

  scrobbleActive( app.room.playlist[0] , function() {
    console.log('scrobbling complete!');
  });

}

function scrobbleActive(track, cb) {
  console.log('scrobbling to active listeners...');
  console.log(track);
  if (track._artist.name.toLowerCase() == 'gobbly') { return false; }

  Person.find({ _id: { $in: _.toArray(app.room.listeners).map(function(x) { return x._id; }) } }).exec(function(err, people) {
    _.filter( people , function(x) {
      console.log('evaluating listener:');
      console.log(x);
      return (x.profiles && x.profiles.lastfm && x.profiles.lastfm.username && x.preferences.scrobble);
    } ).forEach(function(user) {
      console.log('listener available:');
      console.log(user);

      var lastfm = new LastFM({
          api_key: config.lastfm.key
        , secret:  config.lastfm.secret
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

app.post('/skip', /*/requireLogin,/**/ function(req, res) {
  console.log('skip received:');
  console.log(req.user);
  console.log(req.headers);
  
  //Announce who skipped this song
  res.render('partials/announcement', {
      message: {
          message: "&ldquo;" + app.room.track.title + "&rdquo; was skipped by " + req.user.username + "."
        , created: new Date()
      }
    }, function(err, html) {
      app.broadcast({
          type: 'announcement'
        , data: {
              formatted: html
            , created: new Date()
          }
      });
    }
  );
  
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
  //nextSong();
});

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
      
      //Remove user from listeners array if this is their connection
      if (app.room.listeners[conn.user._id] && app.room.listeners[conn.user._id].id == conn.id) {
        //delete app.room.listeners[conn.user._id];
      };
    }
    
    /*app.broadcast({
        type: 'part'
      , data: {
            id: conn.id
          , _id: (conn.user) ? conn.user._id : undefined
        }
    });
    delete app.clients[conn.id];*/
  });
});
sock.installHandlers(server, {prefix:'/stream'});

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
  res.send( _.toArray( app.room.listeners ) );
});

app.get('/android', function(req, res) {
  res.render('android');
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
  });
  chat.save(function(err) {
    res.render('partials/message', {
      message: {
          _author: req.user
        , message: req.param('message')
        , created: chat.created
      }
    }, function(err, html) {
      app.broadcast({
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
          }
      });
      res.send({ status: 'success' });
    });
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

  sortPlaylist();

  app.broadcast({
    type: 'playlist:update'
  });

  res.send({
    status: 'success'
  });

});

function queueTrack(track, curator, queueCallback) {
  app.room.playlist.push( _.extend( track.toObject() , {
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

  sortPlaylist();

  app.redis.set(config.database.name + ':playlist', JSON.stringify( app.room.playlist ) );

  app.broadcast({
      type: 'playlist:add'
    , data: track
  });

  queueCallback();
}

var TRACK_SEPARATOR = ' - ';
function parseTitleString(string, partsCallback) {
  var artist, title, credits = [];
  var string = string || '';

  console.log('parseTitleString(): ' + string);

  // TODO: load from datafile
  var baddies = ['[hd]', '[dubstep]', '[electro]', '[edm]', '[house music]',
    '[glitch hop]', '[video]', '[official video]', '(official video)',
    '[ official video ]', '[official music video]', '[free download]',
    '[free DL]', '( 1080p )', '(with lyrics)', '(High Res / Official video)',
    '[monstercat release]', '(hd)'];
  baddies.forEach(function(token) {
    string = string.replace(token + ' - ', '').trim();
    string = string.replace(token.toUpperCase() + ' - ', '').trim();
    string = string.replace(token.capitalize() + ' - ', '').trim();

    string = string.replace(token, '').trim();
    string = string.replace(token.toUpperCase(), '').trim();
    string = string.replace(token.capitalize(), '').trim();
  });
  console.log('baddies parsed: ' + string);

  var parts = string.split( TRACK_SEPARATOR );

  if (parts.length == 2) {
    artist = parts[0];
    title = parts[1];
  } else if (parts.length > 2) {
    // uh...
    artist = parts[0];
    title = parts[1];
  } else {
    artist = parts[0];
    title = parts[0];
  }

  // look for certain patterns in the string
  credits.push(  title.replace(/(.*)\((.*) remix\)/i, '$2') );
  credits.push( artist.replace(/ ft\. (.*)/i,         '$1') );
  credits.push( artist.replace(/ feat\. (.*)/i,       '$1') );

  var output = {
      artist: artist
    , title: title
    , credits: credits
  };

  console.log('output parts: ' + output);
  console.log('artist: ' + artist);
  console.log('title: ' + title);
  console.log('credits: ' + credits);

  partsCallback(output);
}

function trackFromSource(source, id, sourceCallback) {
  switch (source) {
    default:
      callback('Unknown source: ' + source);
    break;
    case 'soundcloud':
      rest.get('https://api.soundcloud.com/tracks/'+parseInt(id)+'.json?client_id='+config.soundcloud.id).on('complete', function(data) {
        console.log(data);
        if (!data.title) { return sourceCallback('No video found.'); }

        var stringToParse = (data.title.split( TRACK_SEPARATOR ).length > 1) ? data.title : data.user.username + ' - ' + data.title;

        parseTitleString( stringToParse , function(parts) {

          //console.log('parts: ' + JSON.stringify(parts) );

          Track.findOne({ $or: [
            { 'sources.soundcloud.id': data.id }
          ] }).exec(function(err, track) {
            if (!track) { var track = new Track({}); }

            Artist.findOne({ $or: [
                  { _id: track._artist }
                , { slug: slug( parts.artist ) }
            ] }).exec(function(err, artist) {
              if (err) { console.log(err); }
              if (!artist) { var artist = new Artist({}); }

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
                  });
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
      getYoutubeVideo( id , function(track) {
        if (track) {
          sourceCallback(null, track);
        } else {
          sourceCallback('No track returned.');
        }
      });
    break;
  }
}

app.post('/playlist', requireLogin, function(req, res) {
  trackFromSource( req.param('source') , req.param('id') , function(err, track) {
    if (!err && track) {
      queueTrack(track, req.user, function() {
        res.send({ status: 'success', message: 'Track added successfully!' });
      });
    } else {
      res.send({ status: 'error', message: 'Could not add that track.' });
    }
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
    console.log(req.param('scrobble'));
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
app.get('/chat', chat.view);
app.get('/chat/since.json', chat.since);

app.get('/:artistSlug/:trackSlug/:trackID', tracks.view);
app.post('/:artistSlug/:trackSlug/:trackID', authorize('editor') , tracks.edit);
app.get('/tracks/:trackID', tracks.view );
app.post('/tracks/:trackID',                 authorize('editor') , tracks.edit);

app.get('/:artistSlug', artists.view);

app.get('/:usernameSlug/:playlistSlug', playlists.view);
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

server.listen(config.app.port, function(err) {
  console.log('Listening on port ' + config.app.port + ' for HTTP');
  console.log('Must have redis listening on port 6379');
  console.log('Must have mongodb listening on port 27017');
});