var config = require('../config');

var Maki = require('maki');
var soundtrack = new Maki(config);

var Passport = require('maki-passport-local');
var passport = new Passport({
  resource: 'Person'
});

soundtrack.use(passport);

var Artist   = soundtrack.define('Artist',   require('../components/artist'));
var Chat     = soundtrack.define('Chat',     require('../components/chat'));
var Person   = soundtrack.define('Person',   require('../components/person'));
var Play     = soundtrack.define('Play',     require('../components/play'));
var Playlist = soundtrack.define('Playlist', require('../components/playlist'));
var Room     = soundtrack.define('Room',     require('../components/room'));
var Source   = soundtrack.define('Source',   require('../components/source'));
var Track    = soundtrack.define('Track',    require('../components/track'));

soundtrack.bootstrap();

module.exports = soundtrack;
