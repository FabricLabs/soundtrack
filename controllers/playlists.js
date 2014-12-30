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
  view: function(req, res, next) {
    Person.findOne({ slug: req.param('usernameSlug') }).exec(function(err, person) {
      if (!person) { return next(); }

      var slug = req.param('playlistSlug').split('.')[0];
      Playlist.findOne({ $or: [
            { _creator: person._id, public: true }
          , { _creator: (req.user) ? req.user._id : person._id }
        ], slug: slug }).populate('_tracks _creator _parent').exec(function(err, playlist) {
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
      console.log(err || parent);
      
      var playlist = new Playlist({
          name: req.param('name') || parent.name
        , description: req.param('description') || parent.description
        , public: (req.param('status') === 'public') ? true : false
        , _creator: req.user._id
        , _owner: req.user._id
        , _parent: (req.param('parentID') && parent) ? parent._id : null
        , _tracks: (parent) ? parent._tracks : []
      });
      
      Track.findOne({ _id: req.param('trackID') }).exec(function(err, track) {
        if (track) playlist._tracks.push( track._id );
        
        playlist.save(function(err) {
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
