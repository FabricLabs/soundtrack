var _ = require('underscore');
var async = require('async');
var rest = require('restler');

module.exports = {
  list: function(req, res, next) {
    Playlist.find({ public: true }).sort('-updated').populate('_tracks _creator _owner').exec(function(err, playlists) {
      // TODO: use reduce();
      playlists = playlists.map(function(playlist) {
        playlist.length = 0;
        playlist._tracks.forEach(function(track) {
          playlist.length += track.duration;
        });
        return playlist;
      });

      res.format({
        json: function() {
          res.send( playlists );
        },
        html: function() {
          res.render('sets', {
            sets: playlists
          });
        }
      });
    });
  },
  listPerson: function(req, res, next) {
    Person.findOne({ slug: req.param('usernameSlug') }).exec(function(err, person) {
      if (!person) return next();

      var q = { _creator: person._id };

      if (!req.user || req.user._id.toString() !== person._id.toString()) {
        q.public = true;
      }

      Playlist.find( q ).sort('-_id').populate('_tracks').exec(function(err, playlists) {
        // TODO: use reduce();
        playlists = playlists.map(function(playlist) {
          playlist.length = 0;
          playlist._tracks.forEach(function(track) {
            playlist.length += track.duration;
          });
          return playlist;
        });

        res.render('playlists', {
          person: person
          , playlists: playlists
        });
      });
    });
  },
  view: function(req, res, next) {
    Person.findOne({ slug: req.param('usernameSlug') }).exec(function(err, person) {
      if (!person) { return next(); }

      var slug = req.param('playlistSlug').split('.')[0];

      var query = {
        slug: slug
      };

      if (person) {
        query._creator = person._id;
      } else if (req.user) {
        query._creator = req.user._id;
      }
      
      if (req.user && req.user._id.toString() !== person._id.toString()) {
        query.public = true;
      }
      
      console.log('query', query );

      Playlist.findOne( query ).populate('_tracks _creator _parent').exec(function(err, playlist) {
        if (!playlist) { return next(); }

        Artist.populate(playlist, {
          path: '_tracks._artist'
        }, function(err, playlist) {

          res.format({
            json: function() {
              //var playlist = playlist.toObject();
              playlist._creator = {
                  _id: playlist._creator._id
                , username: playlist._creator.username
                , slug: playlist._creator.slug
              };
              res.send( playlist );
            },
            html: function() {
              Person.populate( playlist , {
                path: '_parent._owner'
              }, function(err, playlist) {
                res.render('playlist', {
                  playlist: playlist
                });
              });
            }
          });

        });
      });

    });
  },
  delete: function(req, res, next) {
    Playlist.remove({
      _id: req.param('playlistID'),
      _creator: req.user._id
    }).exec(function(err, numberRemoved) {
      if (err || !numberRemoved) return next();
      return res.send('ok');
    });
  },
  removeTrackFromPlaylist: function(req, res, next) {
    if (!~(req.param('index'))) return next();

    Playlist.findOne({
      _id: req.param('playlistID'),
      _creator: req.user._id
    }).exec(function(err, playlist) {
      if (err || !playlist) return next();

      playlist._tracks.splice( req.param('index') , 1 );
      playlist.save(function(err) {
        return res.send('ok');
      });

    });
  },
  createForm: function(req, res, next) {
    if (!req.user) return next();
    res.render('playlists-create');
  },
  create: function(req, res, next) {
    Playlist.findOne({ _id: req.param('parentID') , public: true }).exec(function(err, parent) {

      var playlist = new Playlist({
          name: req.param('name') || ((parent) ? parent.name : null)
        , description: req.param('description') || ((parent) ? parent.description : null)
        , public: (req.param('status') === 'public') ? true : false
        , _creator: req.user._id
        , _owner: req.user._id
        , _parent: (req.param('parentID') && parent) ? parent._id : null
        , _tracks: (parent) ? parent._tracks : []
      });

      Track.findOne({ _id: req.param('trackID') }).exec(function(err, track) {
        if (track) playlist._tracks.push( track._id );

        playlist.save(function(err) {
          if (err) {
            return res.format({
              json: function() { res.send({ status: 'error', message: err }); },
              html: function() { res.status(500).render('500'); }
            });
          }

          res.status(303);

          res.format({
            json: function() {
              res.send({
                status: 'success'
                , results: {
                  _id: playlist._id
                  , name: playlist.name
                  , tracks: [ track ]
                }
              });
            },
            html: function() {
              req.flash('info', 'Set created successfully!');
              res.redirect('/' + req.user.slug + '/' + playlist.slug );
            }
          });
        });
      });
    });
  },
  import: function(req, res, next) {
    var playlist = new Playlist();

    switch (req.param('source')) {
      default:
        return res.status(400).end();
      break;
      case 'soundcloud':
        self.trackFromSource( 'soundcloud' , item.id , cb );
      break;
    }

  },
  syncSetup: function(req, res, next) {
    
    if (!req.user) return res.redirect('/login');
    if (!req.user.profiles || !req.user.profiles.spotify) return res.redirect('/auth/spotify');
    if (!req.user.profiles.spotify.token) return res.redirect('/auth/spotify');
    //if (req.user.profiles.spotify.expires < Date.now()) return res.redirect('/auth/spotify');
    
    // stub for spotify API auth
    var spotify = {
      get: function( path ) {
        return rest.get('https://api.spotify.com/v1/' + path , {
          headers: {
            'Authorization': 'Bearer ' + req.user.profiles.spotify.token
          }
        });
      }
    }
    
    var playlist = req.param('playlist');
  
    if (playlist) {
      try {
        playlist = JSON.parse( playlist );
      } catch (e) {
        return res.render('500');
      }

      var url = 'users/' + playlist.user + '/playlists/' + playlist.id + '?limit=250';
      spotify.get( url ).on('complete', function(spotifyPlaylist , response ) {
        if (!spotifyPlaylist || response.statusCode !== 200) {
          req.flash('error', 'Could not retrieve list from Spotify. ' + response.statusCode );
          return res.redirect('back');
        }
        
        console.log('spotifyPlaylist', spotifyPlaylist);
        console.log('will be public: ', spotifyPlaylist.public);

        var tracks = spotifyPlaylist.tracks.items.map(function(x) {
          return {
            title: x.track.name,
            artist: x.track.artists[0].name,
            credits: x.track.artists.map(function(y) {
              return y.name
            }),
            duration: x.track.duration_ms / 1000
          }
        });

        var pushers = [];
        tracks.forEach(function(track) {
          pushers.push(function(done) {
            req.soundtrack.trackFromSource('object', track , done );
          });
        });
        
        async.series( pushers , function(err, tracks) {
          
          tracks.forEach(function(track) {
            /* req.app.agency.publish('track:crawl', {
              id: track._id
            }, function(err) {
              console.log('track crawled, doing stuff in initiator');
            }); */
          });
          
          var playlist = new Playlist({
            name: spotifyPlaylist.name,
            description: spotifyPlaylist.description,
            public: spotifyPlaylist.public,
            _creator: req.user._id,
            _owner: req.user._id,
            _tracks: tracks.map(function(x) { return x._id }),
            remotes: {
              spotify: {
                id: spotifyPlaylist.id
              }
            }
          });
          playlist.save(function(err) {
            res.redirect('/' + req.user.slug + '/' + playlist.slug );
          });
        });
      });
      
    } else {
      spotify.get('users/' + req.user.profiles.spotify.id + '/playlists').on('complete', function(results, response) {
        if (response.statusCode == 401) return res.redirect('/auth/spotify');
        res.render('sets-import', {
          playlists: results.items
        });
      });
    }

  },
  edit: function(req, res, next) {
    Playlist.findOne({ _id: req.param('playlistID'), _creator: req.user._id }).exec(function(err, playlist) {
      if (!playlist) { return next(); }

      playlist.description = (req.param('description')) ? req.param('description') : playlist.description;

      if (req.param('status')) {
        playlist.public = (req.param('status') === 'public') ? true : false;
      }

      playlist.updated = new Date();

      playlist.save(function(err) {
        res.send({
            status: 'success'
          , message: 'Playlist edited successfully!'
        });
      });

    });
  },
  addTrack: function(req, res, next) {
    Playlist.findOne({ _id: req.param('playlistID'), _creator: req.user._id }).exec(function(err, playlist) {
      if (!playlist) { return next(); }

      Track.findOne({ _id: req.param('trackID') }).exec(function(err, track) {
        if (!track) { return next(); }

        playlist._tracks.push( track._id );
        playlist.updated = new Date();
        playlist.save(function(err) {
          res.send({
              status: 'success'
            , results: {
                  _id: playlist._id
                , name: playlist.name
                , tracks: playlist._tracks
              }
          });
        });

      });

    });
  }
};
