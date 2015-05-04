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
  
  $.getJSON( self.base + url + '?' + qs.join('&') , cb );
};

module.export = YouTube;
