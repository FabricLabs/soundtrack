var mongoose = require('mongoose')
  , Schema = mongoose.Schema
  , ObjectId = mongoose.SchemaTypes.ObjectId
  , passportLocalMongoose = require('passport-local-mongoose')
  , slug = require('mongoose-slug');

// this defines the fields associated with the model,
// and moreover, their type.
var PersonSchema = new Schema({

});

PersonSchema.plugin(passportLocalMongoose);

PersonSchema.virtual('isoDate').get(function() {
  return this.created.toISOString();
});

PersonSchema.plugin( slug('username') );
PersonSchema.index({ slug: 1 });

var Person = mongoose.model('Person', PersonSchema);

// export the model to anything requiring it.
module.exports = {
  Person: Person
};
