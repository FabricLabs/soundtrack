var mongoose = require('mongoose')
  , Schema = mongoose.Schema
  , ObjectId = mongoose.SchemaTypes.ObjectId;

// this defines the fields associated with the model,
// and moreover, their type.
var PlaySchema = new Schema({
    _track:     { type: ObjectId, ref: 'Track' , index: true }
  , _artist:    { type: ObjectId, ref: 'Artist' }
  , _artists: [ { type: ObjectId, ref: 'Artist' } ]
  , _curator:   { type: ObjectId, ref: 'Person', index: true }
  , _room:      { type: ObjectId, ref: 'Room', required: true , index: true }
  , timestamp:  { type: Date, default: Date.now, index: true }
  , length:     { type: Number }
  , played:     { type: Number }
});

PlaySchema.virtual('isoDate').get(function() {
  return this.timestamp.toISOString();
});

PlaySchema.index({ timestamp: 1 , _room: 1 });
PlaySchema.index({ timestamp: 1 , _room: 1 });

var Play = mongoose.model('Play', PlaySchema);

// export the model to anything requiring it.
module.exports = {
  Play: Play
};
