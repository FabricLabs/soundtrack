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
      Play.find({ _track: track._id }).sort('-timestamp').populate('_curator').exec(function(err, history) {
        if (err) { console.log(err); }

        res.render('track', {
            track: track
          , history: history
        });
      });
    });
  }
}