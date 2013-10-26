var rest = require('restler')
  , _ = require('underscore');

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

        Play.aggregate([
          { $match: { _track: { $in: tracks.map(function(x) { return x._id; }) } } },
          { $group: { _id: '$_track', count: { $sum: 1 } } },
          { $sort: { 'count': -1 } }
        ], function(err, trackScores) {

          res.render('artist', {
              artist: artist
            , tracks: tracks.map(function(track) {
                track.plays = _.find( trackScores , function(x) { return x._id.toString() == track._id.toString() } ).count;
                return track;
              })
          });

        });

      });
    });
  }
}