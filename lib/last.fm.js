var _ = require('underscore');

module.exports = {
  authSetup: function(req, res) {
    //var authUrl = lastfm.getAuthenticationUrl({ cb: ((config.app.safe) ? 'http://' : 'http://') + config.app.host + '/auth/lastfm/callback' });
    var authUrl = lastfm.getAuthenticationUrl({ cb: (( app.config.app.safe) ? 'http://' : 'http://') + 'soundtrack.io/auth/lastfm/callback' });
    res.redirect(authUrl);
  },
  authCallback: function(req, res) {
    lastfm.authenticate( req.param('token') , function(err, session) {
      console.log(session);

      if (err) {
        console.log(err);
        req.flash('error', 'Something went wrong with authentication.');
        return res.redirect('/');
      }

      Person.findOne({ $or: [
          { _id: (req.user) ? req.user._id : undefined }
        , { 'profiles.lastfm.username': session.username }
      ]}).exec(function(err, person) {

        if (!person) {
          var person = new Person({ username: 'reset this later ' });
        }

        person.profiles.lastfm = {
            username: session.username
          , key: session.key
          , updated: new Date()
        };

        person.save(function(err) {
          if (err) { console.log(err); }
          req.session.passport.user = person._id;
          res.redirect('/');
        });

      });

    });
  },
  scrobbleActive: function(requestedTrack, cb) {
    console.log('scrobbling to active listeners...');

    Track.findOne({ _id: requestedTrack._id }).populate('_artist').exec(function(err, track) {
      if (!track || track._artist.name && track._artist.name.toLowerCase() == 'gobbly') { return false; }

      Person.find({ _id: { $in: _.toArray(app.room.listeners).map(function(x) { return x._id; }) } }).exec(function(err, people) {
        _.filter( people , function(x) {
          console.log('evaluating listener:');
          console.log(x);
          return (x.profiles && x.profiles.lastfm && x.profiles.lastfm.username && x.preferences.scrobble);
        } ).forEach(function(user) {
          console.log('listener available:');
          console.log(user);

          var lastfm = new app.LastFM({
              api_key: app.config.lastfm.key
            , secret:  app.config.lastfm.secret
          });

          var creds = {
              username: user.profiles.lastfm.username
            , key: user.profiles.lastfm.key
          };

          lastfm.setSessionCredentials( creds.username , creds.key );
          lastfm.track.scrobble({
              artist: track._artist.name
            , track: track.title
            , timestamp: Math.floor((new Date()).getTime() / 1000) - 300
          }, function(err, scrobbles) {
            if (err) { return console.log('le fail...', err); }

            console.log(scrobbles);
            cb();
          });
        });
      });
    });

  }
}