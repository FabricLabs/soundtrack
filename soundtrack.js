var config = require('./config');
var db = require('./db');
var redis = require('redis');

Artist       = require('./models/Artist').Artist;
Track        = require('./models/Track').Track;
Source       = require('./models/Source').Source;
Play         = require('./models/Play').Play;
Room         = require('./models/Room').Room;

var Soundtrack = require('./lib/soundtrack');
var soundtrack = new Soundtrack( config );

soundtrack.pub = db.client;
soundtrack.sub = redis.createClient();

soundtrack.start(function(err) {
  console.log('soundtrack supervisor started.');
});
