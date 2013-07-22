var mongoose = require('mongoose')
  , Schema = mongoose.Schema
  , ObjectId = mongoose.SchemaTypes.ObjectId
  , passportLocalMongoose = require('passport-local-mongoose')
  , slug = require('mongoose-slug');

// this defines the fields associated with the model,
// and moreover, their type.
var ArtistSchema = new Schema({
    name: { type: String, required: true, unique: true }
  , avatar: {
      url: { type: String, default: 'http://coursefork.org/img/user-avatar.png' }
    }
});

ArtistSchema.plugin( slug('name') );
ArtistSchema.index({ slug: 1 });

var Artist = mongoose.model('Artist', ArtistSchema);

// export the model to anything requiring it.
module.exports = {
  Artist: Artist
};
