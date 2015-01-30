var rest = require('restler')
  , _ = require('underscore')
  , async = require('async');

module.exports = {
  list: function(req, res, next) {
    var limit = (req.param('limit')) ? req.param('limit') : 100;
    var query = (req.param('q')) ? { name: new RegExp('(.*)'+req.param('q')+'(.*)', 'i') } : undefined;

    async.parallel([
      function(done) {
        Artist.count().exec( done );
      },
      function(done) {
        Artist.find( query ).sort('name').limit( limit ).exec( function(err, artists) {
          async.map( artists , function(x, countComplete) {
            Track.count({ $or: [
                { _artist: x._id }
              , { _credits: x._id }
            ] }).exec( function(err, trackCount) {
              x = x.toObject();
              x.tracks = trackCount;
              countComplete( err, x );
            });
          }, done );
        });
      }
    ], function(err, results) {
      res.format({
        json: function() {
          res.send( results[1].map(function(x) {
            if (typeof(x.toObject) == 'function') {
              x = x.toObject();
            }
            //x.value = x._id;
            x.value = x.name;
            return x;
          }) );
        },
        html: function() {
          res.render('artists', {
              count: results[0]
            , limit: limit
            , artists: results[1]
          });
        }
      });
    });
  },
  delete: function(req, res, next) {
    Artist.findOne({ slug: req.param('artistSlug') }).exec(function(err, artist) {
      if (!artist) { return next(); }
      
      Track.find({ $or: [
          { _artist: artist._id }
        , { _credits: artist._id }
      ] }).exec(function(err, tracks) {
        
        res.send(tracks.length);
        
      });
      
    });
  },
  edit: function(req, res, next) {
    Artist.findOne({ $or: [
        { _id: req.param('artistID') }
      , { slug: req.param('artistSlug') }
      , { slugs: req.param('artistSlug') }
    ] }).sort('_id').exec(function(err, artist) {
      if (!artist) { return next(); }
      
      artist.name = req.param('name') || artist.name;
      artist.bio = req.param('bio') || artist.bio;
      
      // reset updated field, for re-crawl
      artist.tracking.tracks.updated = undefined;
      
      Artist.find({ $or: [
          { _id: req.param('artistID') }
        , { slug: req.param('artistSlug') }
        , { slugs: req.param('artistSlug') }
      ] }).exec(function(err, artists) {
        
        var allArtistIDs   = artists.map(function(x) { return x._id; });
        
        artists.forEach(function(a) {
          artist.slugs = _.union( artist.slugs , a.slugs );
        });
        artist.slugs = _.uniq( artist.slugs );
        
        async.parallel([
          function(done) {
            Track.update({ _artist: { $in: allArtistIDs } }, {
              _artist: artist._id.toString()
            }, { multi: true }, done );
          },
          function(done) {
            Track.update({ '_credits.$': { $in: allArtistIDs } }, {
              $addToSet: { _credits: artist._id }
            }, { multi: true }, done );
          }
        ], function(err, results) {
          if (err) { console.log(err); }
          
          artist.save(function(err) {
            if (err) { console.log(err); }
            
            res.format({
              json: function() {
                res.send({
                    status: 'success'
                  , message: 'artist edited successfully'
                });
              },
              html: function() {
                res.redirect('/' + artist.slug );
              }
            });
          });
        });
      });
    });
  },
  view: function(req, res, next) {
    Person.count({ slug: req.param('artistSlug') }).exec(function(err, num) {
      if (num) return next();

      Artist.findOne({ $or: [
          { slug: req.param('artistSlug') }
        , { slugs: req.param('artistSlug') }
      ] }).exec(function(err, artist) {
        if (!artist) { return next(); }
        
        // handle artist renames
        if (req.param('artistSlug') !== artist.slug) {
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
            
            res.format({
              json: function() {
                res.send( artist );
              },
              html: function() {
                res.render('artist', {
                    artist: artist
                  , tracks: tracks.map(function(track) {
                      var plays = _.find( trackScores , function(x) { return x._id.toString() == track._id.toString() } );
                      track.plays = (plays) ? plays.count : 0;
                      return track;
                    }).sort(function(a, b) {
                      return b.plays - a.plays;
                    })
                });
              }
            });
          });

          /* req.app.agency.publish('artist:update', {
              id: artist._id
            , timeout: 3 * 60 * 1000
          }, function(err, job) {
            console.log('update artist completed');
          }); */

        });
      });
    });
  }
}
