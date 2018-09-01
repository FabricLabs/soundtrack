var config = require('./config')
  , mongoose = require('mongoose')
  , redis = require('redis')
  , client = redis.createClient();

var hosts = config.database.hosts || [];
var string = 'mongodb://' + hosts.join(',') + '/' + config.database.name;
var source = mongoose.connect( string );

module.exports = {
    mongoose: mongoose
  , client: client
  , source: source
};
