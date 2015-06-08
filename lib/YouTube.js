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
  self.get('videos', {
    id: id,
    part: 'contentDetails,snippet'
  }, function(err, result) {
    if (err || !result || !result.items || !result.items.length) return cb(err || 'no result');
    var video = result.items[0];
    video.title = video.snippet.title;
    video.duration = moment.duration(video.contentDetails.duration).as('seconds');
    video.images = video.snippet.thumbnails;
    return cb( null , video );
  });
}

module.exports = YouTube;
