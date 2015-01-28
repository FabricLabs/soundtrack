var async = require('async');
var _ = require('underscore');

module.exports = {
  profile: function(req, res, next) {
    Person.findOne({ slug: req.param('usernameSlug') }).exec(function(err, person) {
      if (!person) return next();
      
      var LIMIT = 50;
      
      async.parallel([
        collectUserPlaylists,
        collectUserPlays,
        collectPlayStats,
        collectArtistData
      ], function(err, results) {

        var playlists = results[0];
        // TODO: use reduce();
        playlists = playlists.map(function(playlist) {
          playlist.length = 0;
          playlist._tracks.forEach(function(track) {
            playlist.length += track.duration;
          });
          return playlist;
        });

        res.render('person', {
            person: person
          , playlists: playlists
          , plays: results[1]
          , favoriteTracks: {
              allTime: results[2][0].filter(function(x) {
                return x._artist;
              }),
              past30days: results[2][1].filter(function(x) {
                return x._artist;
              })
            }
          , artist: (results[3]) ? results[3].artist : null
          , tracks: (results[3]) ? results[3].tracks : null
        });
      });

      function collectUserPlays(done) {
        Play.find({ _curator: person._id }).sort('-timestamp').limit(20).populate('_track _curator').exec(function(err, plays) {
          Artist.populate( plays , {
            path: '_track._artist _track._credits'
          }, done );
        });
      }
      
      function collectUserPlaylists(done) {
        var q = { _creator: person._id };

        if (!req.user || req.user._id.toString() !== person._id.toString()) {
          q.public = true;
        }

        Playlist.find( q ).sort('-_id').populate('_tracks').exec(function(err, playlists) {
          done( err , playlists );
        });
      }
      
      function collectPlayStats(done) {
        async.parallel([
          function(complete) {
            Play.aggregate([
              { $match: {
                _curator: person._id
              } },
              { $group: { _id: '$_track', count: { $sum: 1 } } },
              { $sort: { 'count': -1 } },
              { $limit: LIMIT }
            ], function(err, collected) {
              Track.find({ _id: { $in: collected.map(function(x) { return x._id; }) } }).populate('_artist').exec(function(err, input) {
                var output = [];
                for (var i = 0; i < collected.length; i++) {
                  output.push( _.extend( collected[i] , input[i] ) );
                }
                complete( err , output );
              });
            } );
          },
          function(complete) {
            Play.aggregate([
              { $match: {
                _curator: person._id,
                timestamp: { $gte: new Date((new Date()) - 30 * 24 * 3600 * 1000) }
              } },
              { $group: { _id: '$_track', count: { $sum: 1 } } },
              { $sort: { 'count': -1 } },
              { $limit: LIMIT }
            ], function(err, collected) {
              Track.find({ _id: { $in: collected.map(function(x) { return x._id; }) } }).populate('_artist').exec(function(err, input) {
                var output = [];
                for (var i = 0; i < collected.length; i++) {
                  output.push( _.extend( collected[i] , input[i] ) );
                }
                complete( err , output );
              });
            } );
          }
        ], done );
      }
            
      function collectArtistData( artistComplete ) {
        Artist.findOne({ $or: [
            { slug: req.param('usernameSlug') }
          , { slugs: req.param('usernameSlug') }
        ] }).exec(function(err, artist) {
          if (!artist) return artistComplete();
          
          // handle artist renames
          if (req.param('usernameSlug') !== artist.slug) {
            return res.redirect('/' + artist.slug);
          }

          Track.find({ $or: [
              { _artist: artist._id }
            , { _credits: artist._id }
          ] }).populate('_artist').exec(function(err, tracks) {

            Play.aggregate([
              { $match: { _track: { $in: tracks.map(function(x) { return x._id; }) } } },
              { $group: { _id: '$_track', count: { $sum: 1 } } },
              { $sort: { 'count': -1 } }
            ], function(err, trackScores) {
              
              console.log( 'ARTIST CALLBACK', artist );
              
              artistComplete( null , {
                  artist: artist
                , tracks: tracks.map(function(track) {
                    var plays = _.find( trackScores , function(x) { return x._id.toString() == track._id.toString() } );
                    track.plays = (plays) ? plays.count : 0;
                    return track;
                  }).sort(function(a, b) {
                    return b.plays - a.plays;
                  })
              });
            });

            /* req.soundtrack._jobs.enqueue('artist:update', {
                id: artist._id
              , timeout: 3 * 60 * 1000
            }, function(err, job) {
              console.log('update artist queued');
            }); */

          });
        });
      }
      
    });
  },
  mentions: function(req, res, next) {
    Person.findOne({ slug: req.param('usernameSlug') }).exec(function(err, person) {
      if (!person) { return next(); }

      Chat.find({ message: new RegExp( person.username , 'i') }).sort('-created').limit(100).populate('_author _track _play').exec(function(err, chats) {
        res.render('chats', {
          chats: chats
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
    var limit = (req.param('limit')) ? parseInt(req.param('limit')) : 1000000;

    Person.findOne({ slug: req.param('usernameSlug') }).exec(function(err, person) {
      if (!person) { return next(); }

      async.parallel([
        function(done) {
          Playlist.find({ _creator: person._id, public: true }).exec( done );
        },
        function(done) {
          Play.find({
            _curator: person._id,
            _room: (req.roomObj) ? req.roomObj._id : undefined
          }).sort('-timestamp').populate('_track _curator').limit( limit ).exec(function(err, plays) {
            Artist.populate( plays , {
              path: '_track._artist _track._credits'
            }, done );
          });
        }
      ], function(err, results) {
        res.format({
          json: function() {
            res.send( results[1] );
          },
          html: function() {
            res.render('person-plays', {
                person: person
              , playlists: results[0]
              , plays: results[1]
            });
          }
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
