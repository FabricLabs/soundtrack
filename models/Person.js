var mongoose = require('mongoose')
  , Schema = mongoose.Schema
  , ObjectId = mongoose.SchemaTypes.ObjectId
  , passportLocalMongoose = require('passport-local-mongoose')
  , slug = require('mongoose-slug');

// this defines the fields associated with the model,
// and moreover, their type.
var PersonSchema = new Schema({
    email: { type: String, unique: true, sparse: true }
  , roles: [ { type: String, enum: ['editor', 'moderator'] } ]
  , created: { type: Date , default: Date.now , required: true }
  , avatar: {
      url: { type: String, default: '/img/user-avatar.png' }
    }
  , bio: { type: String, default: '' }
  , profiles: {
      lastfm: {
          id: Number
        , username: String
        , key: String
        , updated: Date
      },
      spotify: {
        id: String,
        username: String,
        token: String,
        updated: Date,
        expires: Number
      }
    }
  , preferences: {
      scrobble: { type: Boolean, default: true }
    }
  , _playlists: [ { type: ObjectId , ref: 'Playlist' } ]
});

PersonSchema.plugin(passportLocalMongoose);

PersonSchema.virtual('isoDate').get(function() {
  return this.created.toISOString();
});

PersonSchema.post('init', function (doc) {
  if (this.avatar && this.avatar.url == 'http://coursefork.org/img/user-avatar.png') {
    this.avatar.url = '/img/user-avatar.png';
    this.save(function(err) {

    });
  }
});

PersonSchema.plugin( slug('username'), {
  required: true
} );
PersonSchema.index({ slug: 1 });

var Person = mongoose.model('Person', PersonSchema);

// export the model to anything requiring it.
module.exports = {
  Person: Person
};
