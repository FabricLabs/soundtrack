var async = require('async')
  , _ = require('underscore');

module.exports = {
  profile: function(req, res, next) {
    Person.findOne({ slug: req.param('usernameSlug') }).exec(function(err, person) {
      if (!person) { return next(); }

      async.parallel([
        function(done) { Playlist.find({ _creator: person._id, public: true }).exec( done ); },
        function(done) {
          Play.aggregate([
              { $match: { '_curator': person._id } }
            , { $project : { '_track': 1 } }
            , { $group: { _id: '$_track', total: { $sum: 1 } } }
          ], function(err, aggregatedPlays) {
            var trackMap = {};
            Track.find({ _id: { $in: aggregatedPlays.map(function(x) { return x._id; }) } }).populate('_artist').exec( function(err, tracks) {
              tracks.forEach(function(track) {
                trackMap[ track._id ] = track.toObject();
                trackMap[ track._id ].plays = _.find( aggregatedPlays, function(x) { return x._id == track._id.toString() } ).total;
              });

              done( null , trackMap );

            });
          });
        }
      ], function(err, results) {
        res.render('person', {
            person: person
          , playlists: results[0]
          , tracks: results[1]
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