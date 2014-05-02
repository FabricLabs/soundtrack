var mongoose = require('mongoose')
  , Schema = mongoose.Schema
  , ObjectId = mongoose.SchemaTypes.ObjectId;

// this defines the fields associated with the model,
// and moreover, their type.
var SourceSchema = new Schema({
    id:    { type: String }
  , type:  { type: String, enum: ['audio/mp3', 'video/youtube'] }
  , uri:   { type: String }
  , start: { type: Number }
  , end:   { type: Number }
  , live:  { type: Boolean }
  , nsfw:  { type: Boolean }
});

var Source = mongoose.model('Source', SourceSchema);

// export the model to anything requiring it.
module.exports = {
  Source: Source
};
