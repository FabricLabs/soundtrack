var rest = require('restler')
  , _ = require('underscore');

module.exports = {
  list: function(req, res, next) {
    var query = (req.param('q')) ? { name: new RegExp('(.*)'+req.param('q')+'(.*)', 'i') } : undefined;
    console.log( query );
    Artist.find( query ).sort('name').limit(100).exec(function(err, artists) {
      res.format({
        json: function() {
          res.send( artists.map(function(x) {
            x = x.toObject();
            //x.value = x._id;
            x.value = x.name;
            return x;
          }) );
        },
        html: function() {
          res.render('artists', {
            artists: artists
          });
        }
      })
    });
  },
  view: function(req, res, next) {
    Artist.findOne({ slug: req.param('artistSlug') }).exec(function(err, artist) {
      if (!artist) { return next(); }

      Track.find({ $or: [
          { _artist: artist._id }
        , { _credits: artist._id }
      ] }).populate('_artist').exec(function(err, tracks) {

        Play.aggregate([
          { $match: { _track: { $in: tracks.map(function(x) { return x._id; }) } } },
          { $group: { _id: '$_track', count: { $sum: 1 } } },
          { $sort: { 'count': -1 } }
        ], function(err, trackScores) {

          res.render('artist', {
              artist: artist
            , tracks: tracks.map(function(track) {
                var plays = _.find( trackScores , function(x) { return x._id.toString() == track._id.toString() } );
                track.plays = (plays) ? plays.count : 0;
                return track;
              })
          });

        });

      });
    });
  }
}