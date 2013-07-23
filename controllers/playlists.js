var _ = require('underscore')
  , async = require('async');

module.exports = {
  create: function(req, res, next) {
  
    var playlist = new Playlist({
        name: req.param('name')
      , description: req.param('description')
      , _creator: req.user._id
    });

    // Search for the trackID, if not found proceed to next route
    // otherwise create the playlist
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
  },
  getPlaylists: function(req, res, next) {
    Playlist.find({ _creator: req.user._id }).lean().exec(function(err, playlists) {
      if (!playlists.length) { return next(); }
      
      async.map(playlists, function(playlist, callback) {
        Track.find({ _id: {$in : playlist._tracks }}).exec(function(err, tracks) {
          playlist._tracks = tracks;
          callback(err, playlist);
        });
      }
      , function(err, results) {
        console.log(playlists);
        res.send({
           status: 'success'
          , results: {
              playlists: results
            }
        });
      });

    });
  },
};