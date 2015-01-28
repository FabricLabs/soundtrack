var config = require('./config')
  , mongoose = require('mongoose')
  , redis = require('redis')
  , client = redis.createClient();

var source = mongoose.connect(config.database.host, config.database.name);

module.exports = {
    mongoose: mongoose
  , client: client
  , source: source
};
