var mongoose = require('mongoose')
  , Schema = mongoose.Schema
  , ObjectId = mongoose.SchemaTypes.ObjectId;

// this defines the fields associated with the model,
// and moreover, their type.
var PlaySchema = new Schema({
    _track:     { type: ObjectId, ref: 'Track' }
  , _artist:    { type: ObjectId, ref: 'Artist' }
  , _artists: [ { type: ObjectId, ref: 'Artist' } ]
  , _curator:   { type: ObjectId, ref: 'Person' }
  , _room:      { type: ObjectId, ref: 'Room', required: true }
  , timestamp:  { type: Date, default: Date.now }
  , length:     { type: Number }
  , played:     { type: Number }
});

PlaySchema.virtual('isoDate').get(function() {
  return this.timestamp.toISOString();
});

var Play = mongoose.model('Play', PlaySchema);

// export the model to anything requiring it.
module.exports = {
  Play: Play
};
