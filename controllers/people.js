var async = require('async');

module.exports = {
  profile: function(req, res, next) {
    Person.findOne({ slug: req.param('usernameSlug') }).exec(function(err, person) {
      if (!person) { return next(); }

      async.parallel([
        function(done) {
          Playlist.find({ _creator: person._id, public: true }).exec( done );
        },
        function(done) {
          Play.find({ _curator: person._id }).sort('-timestamp').limit(20).populate('_track _curator').exec(function(err, plays) {
            Artist.populate( plays , {
              path: '_track._artist _track._credits'
            }, done );
          });
        }
      ], function(err, results) {
        res.render('person', {
            person: person
          , playlists: results[0]
          , plays: results[1]
        });
      });
    });
  },
  edit: function(req, res, next) {
    Person.findOne({ slug: req.param('usernameSlug') }).exec(function(err, person) {
      if (!person) { return next(); }

      person.bio    = (req.param('bio'))   ? req.param('bio')   : person.bio;
      person.email  = (req.param('email')) ? req.param('email') : person.email;

      if (typeof(person.email) == 'string') {
        var hash = require('crypto').createHash('md5').update( person.email ).digest('hex');
        person.avatar.url = 'https://www.gravatar.com/avatar/' + hash + '?d=https://soundtrack.io/img/user-avatar.png';
      }

      person.save(function(err) {
        req.flash('info', 'Profile saved successfully!');
        res.redirect('/' + person.slug );
      });

    });
  },
  list: function(req, res) {
    Person.find({}).sort('_id').exec(function(err, people) {
      res.render('people', {
        people: people
      });
    });
  },
  listPlays: function(req, res, next) {
    Person.findOne({ slug: req.param('usernameSlug') }).exec(function(err, person) {
      if (!person) { return next(); }

      async.parallel([
        function(done) {
          Playlist.find({ _creator: person._id, public: true }).exec( done );
        },
        function(done) {
          Play.find({ _curator: person._id }).sort('-timestamp').populate('_track _curator').exec(function(err, plays) {
            Artist.populate( plays , {
              path: '_track._artist _track._credits'
            }, done );
          });
        }
      ], function(err, results) {
        res.render('person-plays', {
            person: person
          , playlists: results[0]
          , plays: results[1]
        });
      });
    });
  },
  setUsernameForm: function(req, res, next) {
    if (!req.user || (req.user && req.user.username)) {
      return res.redirect('/');
    }

    Person.findOne({ _id: req.user._id }).exec(function(err, person) {
      if (!person) { return next(); }

      res.render('set-username');

    });
  },
  setUsername: function(req, res, next) {
    if (!req.user || (req.user && req.user.username)) {
      return res.redirect('/');
    }

    Person.findOne({ _id: req.user._id }).exec(function(err, person) {
      if (!person) { return next(); }

      person.username = req.param('username');

    });
  }
}