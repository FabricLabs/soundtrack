var ObjectId = require('maki/node_modules/mongoose').SchemaTypes.ObjectId;

var Artist = {
  attributes: {
    name: { type: String, required: true, unique: true }, // canonical name
    names: [ { type: String } ], // known names
    bio: String,
    image: {
      url: { type: String, default: 'http://coursefork.org/img/user-avatar.png' }
    },
    tracking: {
      tracks: {
        updated: { type: Date , default: 0 }
      }
    }
  }
}

module.exports = Artist;
