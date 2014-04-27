var _ = require('underscore');

module.exports = {
  list: function(req, res, next) {
    Person.findOne({ slug: req.param('usernameSlug') }).exec(function(err, person) {
      if (!person) { return next(); }
      Playlist.find({ $or: [
          { _creator: person._id, public: true }
        , { _creator: (req.user) ? req.user._id : person._id }
      ] }).populate('_tracks _creator', { hash: 0, salt: 0, preferences: 0 }).lean().exec(function(err, playlists) {
        if(err){console.log(err);}
        console.log(playlists);

        // probably a way to clean this up via Mongoose
        playlists = playlists.map(function(list) {
          list._tracks = list._tracks.map(function(track) {
            for (var source in track.sources) {
              console.log(source);
              for (var i = 0; i < track.sources[source].length; i++) {
                delete track.sources[source][i].data;
              }
            }
            return track;
          });
          return list;
        });

        Artist.populate( playlists , {
            path: '_tracks._artist _tracks._credits'
          , select: '_id name slug'
        }, function(err, playlists) {

          res.format({
            json: function() {
              res.send(playlists);
            },
            html: function() {
              res.render('playlists', {
                playlists: playlists
              });
            },
            text: function() {
              res.render('partials/playlist-list', {
                playlists: playlists
              });
            }
          });
        });
      });
    });
  },
  view: function(req, res, next) {
    Person.findOne({ slug: req.param('usernameSlug') }).exec(function(err, person) {
      if (!person) { return next(); }

      // TODO: use $or to allow user to view non-public
      var slug = req.param('playlistSlug').split('.')[0];
      Playlist.findOne({ $or: [
            { _creator: person._id, public: true }
          , { _creator: (req.user) ? req.user._id : person._id }
        ], slug: slug }).populate('_tracks _creator').exec(function(err, playlist) {
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
              res.render('playlist', {
                playlist: playlist
              });
            }
          });

        });
      });

    });
  },
  create: function(req, res, next) {

    console.log(req.params);

    var playlist = new Playlist({
        name: req.param('name')
      , description: req.param('description')
      , _creator: req.user._id
      , public: (req.param('public') == 'true') ? true : false
    });

    Track.findOne({ _id: req.param('trackID') }).exec(function(err, track) {
      if (!track) { return next(); }

      playlist._tracks.push( track._id );

      playlist.save(function(err) {
        res.send({
            status: 'success'
          , results: {
                _id: playlist._id
              , name: playlist.name
              , description: playlist.description
              , tracks: [ track ]
            }
        });
      });
    });

  },
  edit: function(req, res, next) {
    Playlist.findOne({ _id: req.param('playlistID'), _creator: req.user._id }).exec(function(err, playlist) {
      if (!playlist) { return next(); }

      playlist.description = (req.param('description')) ? req.param('description') : playlist.description;
      switch (req.param('public')) {
        case 'true':
          playlist.public = true;
        break;
        case 'false':
          playlist.public = false;
        break;
      }
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