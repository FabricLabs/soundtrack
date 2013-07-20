module.exports = {
  list: function(req, res, next) {
    Track.find({}).populate('_artist').limit(100).exec(function(err, tracks) {
      res.render('tracks', {
        tracks: tracks
      });
    });
  },
  view: function(req, res, next) {
    Track.findOne({ $or: [
        { _id: req.param('trackID') }
      , { slug: req.param('trackSlug') }
    ] }).populate('_artist').exec(function(err, track) {
      Play.find({ _id: track._id }).exec(function(err, history) {
        res.render('track', {
            track: track
          , history: history
        });
      });
    });
  }
}