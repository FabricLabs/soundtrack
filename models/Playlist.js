var mongoose = require('mongoose')
  , Schema = mongoose.Schema
  , ObjectId = mongoose.SchemaTypes.ObjectId;

// this defines the fields associated with the model,
// and moreover, their type.
var PlaySchema = new Schema({
    name: { type: String, required: true }
  , description: { type: String }
  , created: { type: Date, default: Date.now }
  , updated: { type: Date }
  , _creator: { type: ObjectId, ref: 'Person' }
  , _tracks: [ { type: ObjectId, ref: 'Track' } ]
  , _subscribers: [ { type: ObjectId, ref: 'Person' } ]
});

PlaySchema.virtual('isoDate').get(function() {
  return this.timestamp.toISOString();
});

var Play = mongoose.model('Play', PlaySchema);

// export the model to anything requiring it.
module.exports = {
  Play: Play
};
