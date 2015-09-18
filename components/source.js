var ObjectId = require('maki/node_modules/mongoose').SchemaTypes.ObjectId;

var Source = {
  attributes: {
    id:   { type: String, required: true, unique: true, id: 1 },
    type:  { type: String, enum: ['audio/mp3', 'video/youtube', 'video/mp4'] },
    start: { type: Number, default: 0 },
    end:   { type: Number },
    flags: {
      live:  { type: Boolean, default: false }, // ~bad audio
      nsfw:  { type: Boolean, default: false }, // ~bad video
      down:  { type: Boolean, default: false }, // offline
      restricted: { type: Boolean, default: false } // non-free (libre)
    },
    stats: {
      created: { type: Date, default: Date.now },
      updated: { type: Date }
    }
  }
}

module.exports = Source;
