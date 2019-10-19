'use strict';

const assert = require('assert');

const Oracle = require('fabric').Oracle;
const Remote = require('fabric').Remote;

const Soundtrack = require('../lib/soundtrack');
const soundtrack = new Soundtrack({});

const remote = new Remote({
  host: 'localhost:9200',
  secure: false
});

describe('Soundtrack', function() {
  /*describe('web server', function() {
    it('should run', function(done) {
      app.start(function() {
        app.stop();
        done();
      });
    });
  });*/

  describe('Resources', function () {
    it('should retrieve Rooms', async function () {
      var rooms = await remote._GET('/rooms');
      console.log('rooms: ', rooms.toString());
      assert.ok(rooms);
    });
  });
});
