var mongoose = require('mongoose')
  , Schema = mongoose.Schema
  , ObjectId = mongoose.SchemaTypes.ObjectId
  , passportLocalMongoose = require('passport-local-mongoose')
  , slug = require('mongoose-slug');

// this defines the fields associated with the model,
// and moreover, their type.
var PersonSchema = new Schema({
    email: { type: String, unique: true, sparse: true }
  , avatar: {
      url: { type: String, default: '/img/user-avatar.png' }
    }
  , bio: { type: String, default: '' }
  , profiles: {

    }
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

PersonSchema.plugin( slug('username') );
PersonSchema.index({ slug: 1 });

var Person = mongoose.model('Person', PersonSchema);

// export the model to anything requiring it.
module.exports = {
  Person: Person
};
