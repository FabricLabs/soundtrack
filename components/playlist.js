var ObjectId = require('maki/node_modules/mongoose').SchemaTypes.ObjectId;

var Playlist = {
  attributes: {
    name: { type: String, required: true },
    description: { type: String },
    public: { type: Boolean, default: false },
    created: { type: Date, default: Date.now },
    updated: { type: Date },
    _creator: { type: ObjectId, ref: 'Person' },
    _owner: { type: ObjectId, ref: 'Person' },
    _parent: { type: ObjectId, ref: 'Playlist' },
    _tracks: [ { type: ObjectId, ref: 'Track' } ],
    _subscribers: [ { type: ObjectId, ref: 'Person' } ],
    remotes: {
      spotify: {
        id: { type: String },
        updated: { type: Date , default: Date.now }
      }
    }
  }
}

module.exports = Playlist;
