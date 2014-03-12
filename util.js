var async = require('async')
  , rest = require('restler')
  , slug = require('slug-component')
  , config = require('./config');

var TRACK_SEPARATOR = ' - ';
function parseTitleString(string, partsCallback) {
  var artist, title, credits = [];
  var string = string || '';

  function escapeRegExp(str) {
    return str.replace(/[\-\[\]\/\{\}\(\)\*\+\?\.\\\^\$\|]/g, "\\$&");
  }

  // TODO: load from datafile
  var baddies = ['[dubstep]', '[electro]', '[edm]', '[house music]',
    '[glitch hop]', '[video]', '[official video]', '(official video)',
    '[ official video ]', '[official music video]', '[free download]',
    '[free dl]', '( 1080p )', '(with lyrics)', '(high res / official video)',
    '(music video)', '[music video]', '[hd]', '(hd)', '[hq]', '(hq)',
    '(original mix)', '[original mix]',
    '[monstercat release]', '[monstercat freebie]'];
  baddies.forEach(function(token) {
    string = string.replace(token + ' - ', '').trim();
    string = string.replace(token.toUpperCase() + ' - ', '').trim();
    string = string.replace(token.toLowerCase() + ' - ', '').trim();
    string = string.replace(token.capitalize() + ' - ', '').trim();

    string = string.replace(token, '').trim();
    string = string.replace(token.toUpperCase(), '').trim();
    string = string.replace(token.toLowerCase(), '').trim();
    string = string.replace(token.capitalize(), '').trim();
  });

  var parts = string.split( ' - ' );

  if (parts.length == 2) {
    artist = parts[0];
    title = parts[1];
  } else if (parts.length > 2) {
    // uh...
    artist = parts[0];
    title = parts[1];
  } else {
    artist = parts[0];
    title = parts[0];
  }


  // one last pass
  baddies.forEach(function(baddy) {
    title  = title.replace( new RegExp( escapeRegExp(baddy) , 'i') , '').trim();
    artist = artist.replace( new RegExp( escapeRegExp(baddy) , 'i') , '').trim();
  });

  // look for certain patterns in the string
  credits.push(  title.replace(/(.*)\((.*) remix\)/i,       '$2').trim() );
  credits.push(  title.replace(/(.*) ft\.? (.*)/i,          '$1').trim() );
  credits.push(  title.replace(/(.*) ft\.? (.*)/i,          '$2').trim() );
  credits.push(  title.replace(/(.*) feat\.? (.*)/i,        '$1').trim() );
  credits.push(  title.replace(/(.*) feat\.? (.*)/i,        '$2').trim() );
  credits.push(  title.replace(/(.*) featuring (.*)/i,      '$2').trim() );
  credits.push(  title.replace(/(.*) \(ft (.*)\)/i,         '$1').trim() );
  credits.push(  title.replace(/(.*) \(ft (.*)\)/i,         '$2').trim() );
  credits.push(  title.replace(/(.*) \(featuring (.*)\)/i,  '$2').trim() );
  credits.push( artist.replace(/(.*) ft\.? (.*)/i,          '$1').trim() );
  credits.push( artist.replace(/(.*) ft\.? (.*)/i,          '$2').trim() );
  credits.push( artist.replace(/(.*) feat\.? (.*)/i,        '$1').trim() );
  credits.push( artist.replace(/(.*) feat\.? (.*)/i,        '$2').trim() );
  credits.push( artist.replace(/(.*) featuring (.*)/i,      '$2').trim() );
  credits.push( artist.replace(/(.*) \(ft (.*)\)/i,         '$1').trim() );
  credits.push( artist.replace(/(.*) \(ft (.*)\)/i,         '$2').trim() );
  credits.push( artist.replace(/(.*) \(featuring (.*)\)/i,  '$2').trim() );
  credits.push( artist.replace(/(.*) & (.*)/ig,             '$1').trim() );
  credits.push( artist.replace(/(.*) & (.*)/ig,             '$2').trim() );
  credits.push( artist.replace(/(.*) vs\.? (.*)/i,          '$1').trim() );
  credits.push( artist.replace(/(.*) vs\.? (.*)/i,          '$2').trim() );
  credits.push( artist.replace(/(.*) x (.*)/i,              '$1').trim() );
  credits.push( artist.replace(/(.*) x (.*)/i,              '$2').trim() );

  var creditMap = {};
  credits.forEach(function(credit) {
    if (credit !== title) { // temp., until we find out why title is in credits
      creditMap[ credit ] = credit;
    }
  });

  var output = {
      artist: artist
    , title: title
    , credits: Object.keys(creditMap)
  };

  console.log('output parts: ' + JSON.stringify(output) );
  /* console.log('artist: ' + artist);
  console.log('title: ' + title);
  console.log('credits: ' + credits);*/

  partsCallback(output);
}

String.prototype.capitalize = function(){
  return this.replace( /(^|\s)([a-z])/g , function(m,p1,p2){ return p1+p2.toUpperCase(); } );
};

module.exports = {
  timeSeries: function(field, interval, skip, limit) {
    var queries = [];

    if (!interval) { var interval = 24; }
    if (!skip)     { var skip = 1; }
    if (!limit)    { var limit = 24; }

    var halfTime = interval / 2; // moving window

    for (var i = 0; i <= limit; i++) {

      var start = new Date();
      start.setHours('0');
      start.setMinutes('0');
      start.setSeconds('0');
      start.setMilliseconds('0');

      var end = new Date( start.getTime() );

      start = new Date( start           - ((i+1)  * 1000 * 60 * 60 * 24) );
      end   = new Date( start.getTime() + interval );

      var query = {};
      query[ field ] = {
          $gte: start
        , $lt: end
      };

      queries.push( query );
    }

    return queries;
  },
  getYoutubeVideo: function(videoID, internalCallback) {
    console.log('getYoutubeVideo() : ' + videoID );
    rest.get('http://gdata.youtube.com/feeds/api/videos/'+videoID+'?v=2&alt=jsonc').on('complete', function(data, response) {
      if (data && data.data) {
        var video = data.data;
        Track.findOne({
          'sources.youtube.id': video.id
        }).exec(function(err, track) {
          if (!track) { var track = new Track({ title: video.title }); }

          parseTitleString( video.title , function(parts) {

            console.log( video.title + ' was parsed into:');
            console.log(parts);

            async.mapSeries( parts.credits , function( artistName , artistCollector ) {
              Artist.findOne({ $or: [
                    { slug: slug( artistName ) }
                  , { name: artistName }
              ] }).exec( function(err, artist) {
                if (!artist) { var artist = new Artist({ name: artistName }); }
                artist.save(function(err) {
                  if (err) { console.log(err); }
                  artistCollector(err, artist);
                });
              });
            }, function(err, results) {

              Artist.findOne({ $or: [
                    { _id: track._artist }
                  , { slug: slug( parts.artist ) }
                  , { name: parts.artist }
              ] }).exec(function(err, artist) {
                if (!artist) { var artist = new Artist({ name: parts.artist }); }
                artist.save(function(err) {
                  if (err) { console.log(err); }

                  // only use parsed version if original title is unchanged
                  track.title = (track.title == video.title) ? parts.title : track.title;
                  track._artist = artist._id;
                  track._credits = results.map(function(x) { return x._id; });

                  track.duration             = (track.duration) ? track.duration : video.duration;
                  track.images.thumbnail.url = (track.images.thumbnail.url) ? track.images.thumbnail.url : video.thumbnail.hqDefault;

                  var youtubeVideoIDs = track.sources.youtube.map(function(x) { return x.id; });
                  var index = youtubeVideoIDs.indexOf( video.id );
                  if (index == -1) {
                    track.sources.youtube.push({
                        id: video.id
                      , data: video
                    });
                  } else {
                    track.sources.youtube[ index ].data = video;
                  }

                  track.save(function(err) {
                    if (err) { console.log(err); }

                    // begin cleanup
                    //track = track.toObject();
                    track._artist = {
                        _id: artist._id
                      , name: artist.name
                      , slug: artist.slug
                    };

                    for (var source in track.sources.toObject()) {
                      console.log(source);
                      console.log(track.sources[ source ]);
                      for (var i = 0; i<track.sources[ source ].length; i++) {
                        delete track.sources[ source ].data;
                      }
                    }
                    // end cleanup

                    internalCallback( track );
                  });
                });
              });
            });
          });
        });

          /*

            Artist.findOne().exec(function(err, artist) {

              if (!artist) { var artist = new Artist({
                name: data.author
              }); }

              track._artist = artist._id;

              var youtubeVideoIDs = track.sources.youtube.map(function(x) { return x.id; });
              var index = youtubeVideoIDs.indexOf( video.id );
              if (index == -1) {
                track.sources.youtube.push({
                    id: video.id
                  , data: video
                });
              } else {
                track.sources.youtube[ index ].data = video;
              }

              // if the track doesn't already have a title, set it from 
              if (!track.title) {
                track.title = data.title || video.title;
              }

              track.duration             = (track.duration) ? track.duration : video.duration;
              track.images.thumbnail.url = video.thumbnail.hqDefault;

              // TODO: use CodingSoundtrack.org's lookup for artist creation
              //Author.findOne()
              artist.save(function(err) {
                if (err) { console.log(err); }
                track.save(function(err) {
                  if (err) { console.log(err); }

                  Artist.populate(track, {
                    path: '_artist'
                  }, function(err, track) {
                    internalCallback( track );
                  });

                });
              });
            });
          }); 
        });*/
      } else {
        console.log('waaaaaaaaaaat  videoID: ' + videoID);
        console.log(data);

        internalCallback();
      }
    });
  },
  trackFromSource: function trackFromSource(source, id, sourceCallback) {
    var self = this;
    console.log('trackFromSource() : ' + source + ' ' + id );

    switch (source) {
      default:
        callback('Unknown source: ' + source);
      break;
      case 'soundcloud':
        rest.get('https://api.soundcloud.com/tracks/'+parseInt(id)+'.json?client_id='+config.soundcloud.id).on('complete', function(data, response) {

          if (!data.title) { return sourceCallback('No video found.'); }

          var stringToParse = (data.title.split( TRACK_SEPARATOR ).length > 1) ? data.title : data.user.username + ' - ' + data.title;

          parseTitleString( stringToParse , function(parts) {

            //console.log('parts: ' + JSON.stringify(parts) );

            Track.findOne({ $or: [
              { 'sources.soundcloud.id': data.id }
            ] }).exec(function(err, track) {
              if (!track) { var track = new Track({}); }

              Artist.findOne({ $or: [
                    { _id: track._artist }
                  , { slug: slug( parts.artist ) }
              ] }).exec(function(err, artist) {
                if (err) { console.log(err); }
                if (!artist) { var artist = new Artist({}); }

                artist.name = artist.name || parts.artist;

                artist.save(function(err) {
                  if (err) { console.log(err); }

                  track.title    = track.title    || parts.title;
                  track._artist  = track._artist  || artist._id;
                  track.duration = track.duration || data.duration / 1000;

                  var sourceIDs = track.sources[ source ].map(function(x) { return x.id; });
                  var index = sourceIDs.indexOf( data.id );
                  if (index == -1) {
                    track.sources[ source ].push({
                        id: data.id
                      , data: data
                    });
                  } else {
                    track.sources[ source ][ index ].data = data;
                  }

                  track.save(function(err) {
                    Artist.populate(track, {
                      path: '_artist'
                    }, function(err, track) {
                      sourceCallback(err, track);
                    });
                  });

                });

              });

            });
          });
        });
      break;
      case 'youtube':
        self.getYoutubeVideo( id , function(track) {
          if (track) {
            sourceCallback(null, track);
          } else {
            sourceCallback('No track returned.');
          }
        });
      break;
    }
  }
}