var _ = require('underscore')

module.exports = {
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
    var playlist = new Playlist({
        name: req.param('name')
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