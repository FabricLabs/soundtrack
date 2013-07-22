var mongoose = require('mongoose')
  , Schema = mongoose.Schema
  , ObjectId = mongoose.SchemaTypes.ObjectId
  , slug = require('mongoose-slug');

// this defines the fields associated with the model,
// and moreover, their type.
var TrackSchema = new Schema({
    title: { type: String, required: true }
  , _artist: { type: ObjectId, ref: 'Artist' }
  , duration: { type: Number }
  , images: {
      thumbnail: { url: { type: String } }
    }
  , sources: {
      youtube: [ new Schema({
          id: { type: String, required: true }
        , start: { type: Number, default: 0 }
        , duration: { type: Number }
      })],
      soundcloud: [ new Schema({
        id: { type: String, required: true }
      })],
      vimeo: [ new Schema({
        id: { type: String, required: true }
      })]
    }
  , _remixes: [ new Schema({
        _artist: { type: ObjectId, ref: 'Artist' }
      , _track: { type: ObjectId, ref: 'Track' }
    }) ]
});

TrackSchema.statics.random = function(callback) {
  this.count(function(err, count) {
    if (err) {
      return callback(err);
    }
    var rand = Math.floor(Math.random() * count);
    this.findOne().skip(rand).exec(callback);
  }.bind(this));
};

TrackSchema.plugin( slug('title') );
TrackSchema.index({ slug: 1 });

var Track = mongoose.model('Track', TrackSchema);

// export the model to anything requiring it.
module.exports = {
  Track: Track
};
