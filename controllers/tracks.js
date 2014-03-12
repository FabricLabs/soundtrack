var async = require('async')
  , _ = require('underscore');

module.exports = {
  list: function(req, res, next) {
    Play.aggregate([
      { $group: { _id: '$_track', count: { $sum: 1 } } },
      { $sort: { 'count': -1 } },
      { $limit: 100 }
    ], function(err, tracks) {

      Track.find({ _id: { $in: tracks.map(function(x) { return x._id; }) }}).populate('_artist').exec(function(err, tracks) {
        res.format({
          json: function() {
            res.send( tracks );
          },
          html: function() {
            res.render('tracks', {
              tracks: tracks
            });
          }
        });
      });
    });
  },
  edit: function(req, res, next) {
    Track.findOne({ _id: req.param('trackID') }).exec(function(err, track) {
      if (err || !track) { return next(); }
      Artist.findOne({ name: req.param('artistName') }).exec(function(err, artist) {
        if (err) { console.log(err); }

        if (!artist ) { var artist = new Artist({ name: req.param('artistName') }); }

        track._artist = (artist && artist._id.toString() != track._artist.toString()) ? artist._id : track._artist;
        track.title = (req.param('title')) ? req.param('title') : track.title;

        artist.save(function(err) {
          if (err) { console.log(err); }
          track.save(function(err) {
            if (err) { console.log(err); }
            res.send({
                status: 'success'
              , message: 'Track edited successfully.'
            });

            track = track.toObject();
            track._artist = artist;

            req.soundtrack.broadcast({
                type: 'edit'
              , track: track
            });

          });
        });
      });
    });
  },
  merge: function(req, res, next) {
    Track.findOne({ _id: req.param('from') }).exec(function(err, from) {
      Track.findOne({ _id: req.param('to') }).exec(function(err, to) {

      });
    });
  },
  view: function(req, res, next) {
    // TODO: use artist in the lookup
    Track.findOne({ $or: [
        { _id: req.param('trackID') }
      , { slug: req.param('trackSlug') }
    ] }).populate('_artist _credits').exec(function(err, track) {
      if (!track) { return next(); }

      Chat.find({ _track: track._id }).sort('-_id').limit(20).populate('_author').exec(function(err, chats) {
        res.format({
          json: function() {
            res.send( track );
          },
          html: function() {
            Play.find({ _track: track._id }).sort('-timestamp').populate('_curator').exec(function(err, history) {
              if (err) { console.log(err); }

              var queries = [];
              for (var d = 29; d >= 0; d--) {

                var start = new Date();
                start.setHours('0');
                start.setMinutes('0');
                start.setSeconds('0');
                start.setMilliseconds('0');

                var end = new Date( start.getTime() );

                start = new Date( start - (d * 1000 * 60 * 60 * 24) );
                end = new Date( start.getTime() + 1000 * 60 * 60 * 24 );

                queries.push({ timestamp: {
                    $gte: start
                  , $lt: end
                } });
              }
              
              // TODO: use some sort of map so this can be switched parallel
              async.series(
                queries.map(function(q) {
                  return function(done) { Play.count( _.extend({ _track: track._id }, q) ).exec(done); };
                }), function(err, playsPerDay) {

                  Track.find({
                      _artist: track._artist._id
                    , slug: track.slug
                  }).exec(function(err, dupes) {

                    res.render('track', {
                        track: track
                      , history: history
                      , playsPerDay: playsPerDay
                      , chats: chats
                      , dupes: dupes
                    });
                  });
                }
              );
            });
          }
        });
      });
    });
  }
}