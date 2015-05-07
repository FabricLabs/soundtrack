var rest = require('restler');
var moment = require('moment');

var YouTube = function(key) {
  this.key = key;
  this.base = 'https://www.googleapis.com/youtube/v3/';
}

YouTube.prototype.get = function(url, params, cb) {
  var self = this;

  params.key = self.key;

  var qs = Object.keys( params ).map(function(k) {
    return k + '=' + params[k];
  });

  rest.get( self.base + url + '?' + qs.join('&') ).on('complete', function(data) {
    cb( null , data );
  });
}

YouTube.prototype._getVideo = function( id , cb ) {
  var self = this;
  self.get('search', {
    q: id,
    part: 'snippet',
    maxResults: 1
  }, function(err, data) {
    if (err || !data) return cb(err || 'no data');
    var video = data.items[0];

    self.get('videos', {
      id: video.id.videoId,
      part: 'contentDetails'
    }, function(err, result) {
      if (err || !result || !result.items || !result.items.length) return cb(err || 'no result');
      var v = result.items[0];
      video.id = v.id;
      video.title = video.snippet.title;
      video.duration = moment.duration(v.contentDetails.duration).as('seconds');
      video.images = video.snippet.thumbnails;
      return cb( null , video );
    });
  });
}

module.exports = YouTube;
