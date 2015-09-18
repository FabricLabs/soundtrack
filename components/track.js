var ObjectId = require('maki/node_modules/mongoose').SchemaTypes.ObjectId;

var Track = {
  attributes: {
    title: { type: String, required: true },
    titles: [ { type: String } ],
    _artist: { type: ObjectId, ref: 'Artist', index: true },
    _credits: [ { type: ObjectId, ref: 'Artist', index: true } ],
    duration: { type: Number }, // time in seconds
    flags: {
      nsfw: { type: Boolean, default: false },
      live: { type: Boolean, default: false }
    },
    description: { type: String },
    images: {
      thumbnail: { url: { type: String } }
    },
    updated: { type: Date, default: 0 },
    _sources: [ { type: ObjectId, ref: 'Source' } ]
  }
}

module.exports = Track;
