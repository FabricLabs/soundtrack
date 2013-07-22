var rest = require('restler');

module.exports = {
  list: function(req, res, next) {
    Artist.find({}).sort('name').exec(function(err, artists) {
      res.render('artists', {
        artists: artists
      });
    });
  },
  view: function(req, res, next) {
    Artist.findOne({ slug: req.param('artistSlug') }).exec(function(err, artist) {
      if (!artist) { return next(); }

      Track.find({ _artist: artist._id }).exec(function(err, tracks) {
        res.render('artist', {
            artist: artist
          , tracks: tracks
        });
      });
    });
  }
}