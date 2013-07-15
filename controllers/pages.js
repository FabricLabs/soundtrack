module.exports = {
  index: function(req, res, next) {
    Chat.find({}).limit(10).sort('-created').populate('_author').exec(function(err, messages) {
      res.render('index', {
          messages: messages.reverse()
        , backup: []
        , room: req.app.room
      });
    });
  },
  about: function(req, res, next) {
    res.render('about', { });
  }
}