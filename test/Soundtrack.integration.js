var assert = require('assert');
var rest = require('restler');

var config = require('../config');

before(function() {
  var app = require('../soundtrack');
});

describe('Soundtrack', function() {
  describe('web server', function() {
    it('should run', function() {
      assert('ok');
    });
    
    it('should accept connections', function( done ) {
      setTimeout(function() {
        rest.get('http://localhost:'+ config.app.port ).on('complete', function(data, response) {
          assert( response.statusCode , 200 );
          done();
        });
      }, 1000);
    });
  });
});
