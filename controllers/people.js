module.exports = {
  profile: function(req, res, next) {
    Person.findOne({ slug: req.param('usernameSlug') }).exec(function(err, person) {
      if (!person) { return next(); }

      Playlist.find({ _creator: person._id, public: true }).exec(function(err, playlists) {
        res.render('person', {
            person: person
          , playlists: playlists
        });
      });

    });
  },
  edit: function(req, res, next) {
    Person.findOne({ slug: req.param('usernameSlug') }).exec(function(err, person) {
      if (!person) { return next(); }

      person.bio = (req.param('bio')) ? req.param('bio') : person.bio;
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