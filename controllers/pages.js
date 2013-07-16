module.exports = {
  index: function(req, res, next) {
    Chat.find({}).limit(10).sort('-created').populate('_author').exec(function(err, messages) {
      Playlist.find({ _creator: ((req.user) ? req.user._id : undefined) }).sort('name').exec(function(err, playlists) {

        if (err) { console.log(err); }
        console.log(playlists);

        res.render('index', {
            messages: messages.reverse()
          , backup: []
          , playlists: playlists
          , room: req.app.room
        });
      });

    });
  },
  about: function(req, res, next) {
    res.render('about', { });
  }
}