var mongoose = require('mongoose')
  , Schema = mongoose.Schema
  , ObjectId = mongoose.SchemaTypes.ObjectId
  , slug = require('mongoose-slug');

// this defines the fields associated with the model,
// and moreover, their type.
var PlaylistSchema = new Schema({
    name: { type: String, required: true }
  , description: { type: String }
  , public: { type: Boolean, default: false }
  , created: { type: Date, default: Date.now }
  , updated: { type: Date }
  , _creator: { type: ObjectId, ref: 'Person' }
  , _tracks: [ { type: ObjectId, ref: 'Track' } ]
  , _subscribers: [ { type: ObjectId, ref: 'Person' } ]
});

PlaylistSchema.virtual('isoDate').get(function() {
  return this.timestamp.toISOString();
});

PlaylistSchema.plugin( slug('name') );
PlaylistSchema.index({ slug: 1 });

var Playlist = mongoose.model('Playlist', PlaylistSchema);

// export the model to anything requiring it.
module.exports = {
  Playlist: Playlist
};
