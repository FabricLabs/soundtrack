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
    Person.find({}).exec(function(err, people) {
      res.render('people', {
        people: people
      });
    });
  }
}