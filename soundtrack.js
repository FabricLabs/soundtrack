var config = require('./config')
  , database = require('./db')
  , express = require('express')
  , app = express()
  , http = require('http')
  , rest = require('restler')
  , async = require('async')
  , sockjs = require('sockjs')
  , _ = require('underscore')
  , mongoose = require('mongoose')
  , flashify = require('flashify')
  , passport = require('passport')
  , pkgcloud = require('pkgcloud')
  , LocalStrategy = require('passport-local').Strategy
  , mongooseRedisCache = require('mongoose-redis-cache')
  , RedisStore = require('connect-redis')(express)
  , sessionStore = new RedisStore({ client: database.client });

app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
app.set('strict routing', true);
app.use(express.static(__dirname + '/public'));

app.use(express.methodOverride())
app.use(express.cookieParser( config.sessions.key ));
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
Play         = require('./models/Play').Play;

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

app.locals.pretty   = true;
//app.locals.moment   = require('moment');

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

app.room = {
    track: undefined
  , playlist: []
};
app.clients = [];

app.broadcast = function(msg) {
  app.clients.forEach(function(conn) {
    conn.write(JSON.stringify( msg ));
  });
};

function getYoutubeVideo(videoID, callback) {
  rest.get('http://gdata.youtube.com/feeds/api/videos?max-results=1&v=2&alt=jsonc&q='+videoID).on('complete', function(data) {
    if (data && data.data && data.data.items) {
      var video = data.data.items[0];
      Track.findOne({
        'sources.youtube.id': video.id
      }).exec(function(err, track) {

        //if (!track) { var track = new Track({}); }
        //track.
        callback(video);
      });
    } else {
      callback();
    }
  });
};


function nextSong() {
  var lastTrack = app.room.playlist.shift();
  // temporary (until playlist management is done)
  //app.room.playlist.push(lastTrack);

  if (app.room.playlist.length == 0) {
    app.room.playlist.push( backupTracks[ _.random(0, backupTracks.length - 1 ) ] );
  }

  app.room.playlist[0].startTime = Date.now();

  app.broadcast({
      type: 'track'
    , data: app.room.playlist[0]
  });

  setTimeout( nextSong , app.room.playlist[0].duration * 1000 );
}

app.post('/skip', function(req, res) {
  nextSong();
  res.send({ status: 'success' });
});

/* temporary: generate top 10 playlist (from coding soundtrack's top 10) */
/* this will be in MongoDB soon...*/
var topTracks = ['KrVC5dm5fFc', '3vC5TsSyNjU', 'vZyenjZseXA', 'QK8mJJJvaes', 'wsUQKw4ByVg', 'PVzljDmoPVs', 'YJVmu6yttiw', '7-tNUur2YoU', '7n3aHR1qgKM', 'lG5aSZBAuPs']
  , backupTracks = [];
async.series(topTracks.map(function(videoID) {
  return function(done) {
    getYoutubeVideo(videoID, function(video) {

      backupTracks.push({
        source: 'youtube',
        id: video.id,
        duration: video.duration
      });

      done();

    });
  };
}), function(err, results) {

  // temporary
  app.room.playlist = _.shuffle( app.room.playlist );

  nextSong();
});


sock.on('connection', function(conn) {
  var index = app.clients.push(conn);

  conn.on('data', function(message) {
    conn.write(message);
  });

  app.broadcast({
      type: 'join'
    , data: {
        id: conn.id
      }
  });

  conn.write(JSON.stringify({
      type: 'track'
    , data: app.room.playlist[0]
    , seekTo: (Date.now() - app.room.playlist[0].startTime) / 1000
  }));

  conn.on('close', function() {
    app.broadcast({
        type: 'part'
      , data: {
          id: conn.id
        }
    });
    delete app.clients[index];
  });
});
sock.installHandlers(server, {prefix:'/stream'});

app.get('/', function(req, res, next) {
  res.render('index', { });
});

app.get('/about', function(req, res, next) {
  res.render('about', { });
});

app.get('/playlist.json', function(req, res) {
  res.send(app.room.playlist);
});

app.get('/listeners.json', function(req, res) {
  res.send(app.clients.map(function(client) {
    return { id: client.id };
  }));
});

app.post('/chat', requireLogin, function(req, res) {
  res.render('partials/message', {
    message: {
        _author: req.user
      , message: req.param('message')
    }
  }, function(err, html) {
    app.broadcast({
        type: 'chat'
      , data: {
          formatted: html
        }
    });
    res.send({ status: 'success' });
  });
});

app.post('/playlist', requireLogin, function(req, res) {
  switch(req.param('source')) {
    default:
      console.log('unrecognized source: ' + req.param('source'));
    break;
    case 'youtube':
      getYoutubeVideo(req.param('id'), function(video) {
        var track = {
          source: 'youtube',
          id: video.id,
          duration: video.duration
        };

        app.room.playlist.push(track);

        app.broadcast({
            type: 'playlist:add'
          , data: track
        });

        res.send({ status: 'success' });
      });
    break;
  }
});

app.get('/pages.json', function(req, res) {
  res.send({
    "home": {
      "title": "Home",
      "content": "This is the home page. Welcome"
    },
    "about": {
      "title": "About",
      "content": "This is the about page. Welcome"
    }
  });
});

app.get('/register', function(req, res) {
  res.render('register');
});

app.post('/register', function(req, res) {
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

server.listen(13000);
