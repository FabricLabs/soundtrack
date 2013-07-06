var mongoose = require('mongoose')
  , Schema = mongoose.Schema
  , ObjectId = mongoose.SchemaTypes.ObjectId;

// this defines the fields associated with the model,
// and moreover, their type.
var PlaySchema = new Schema({
    _track: { type: ObjectId, ref: 'Track' }
  , timestamp: { type: Date, default: Date.now }
});

PlaySchema.virtual('isoDate').get(function() {
  return this.timestamp.toISOString();
});

var Play = mongoose.model('Play', PlaySchema);

// export the model to anything requiring it.
module.exports = {
  Play: Play
};
