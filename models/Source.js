var mongoose = require('mongoose')
  , Schema = mongoose.Schema
  , ObjectId = mongoose.SchemaTypes.ObjectId;

var config = require('../config');

// this defines the fields associated with the model,
// and moreover, their type.
var SourceSchema = new Schema({
    id:   { type: String, required: true, unique: true }
  , type:  { type: String, enum: ['audio/mp3', 'video/youtube', 'video/mp4'] }
  , start: { type: Number, default: 0 }
  , end:   { type: Number }
  , flags: {
        live:  { type: Boolean, default: false } // ~bad audio
      , nsfw:  { type: Boolean, default: false } // ~bad video
      , down:  { type: Boolean, default: false } // offline
      , restricted: { type: Boolean, default: false } // non-free (libre)
    }
  , stats: {
        created: { type: Date, default: Date.now }
      , updated: { type: Date }
    }
});

SourceSchema.virtual('uri').get(function() {
  var parts = id.split(':');
  switch (source) {
    case 'youtube':
      return 'https://www.youtube.com/watch?v=' + parts[1];
    break;
    case 'soundcloud':
      return 'https://api.soundcloud.com/tracks/' + parts[1] + '?clientID=' + config.soundcloud.id;
    break;
    default:
      return undefined;
    break;
  }
});

var Source = mongoose.model('Source', SourceSchema);

// export the model to anything requiring it.
module.exports = {
  Source: Source
};
