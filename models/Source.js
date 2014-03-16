var mongoose = require('mongoose')
  , Schema = mongoose.Schema
  , ObjectId = mongoose.SchemaTypes.ObjectId;

// this defines the fields associated with the model,
// and moreover, their type.
var SourceSchema = new Schema({
    id: { type: String }
  , type: { type: String, enum: ['video/youtube', 'audio/mp3'] }
  , uri: { type: String }
  , start: { type: Number }
  , end: { type: Number }
});

var Source = mongoose.model('Source', SourceSchema);

// export the model to anything requiring it.
module.exports = {
  Source: Source
};
