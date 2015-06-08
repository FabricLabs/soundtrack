var mongoose = require('mongoose')
  , Schema = mongoose.Schema
  , ObjectId = mongoose.SchemaTypes.ObjectId;

var ChatSchema = new Schema({
    _author: { type: ObjectId, required: true, ref: 'Person' }
  , created: { type: Date, default: Date.now }
  , message: { type: String }
  , _track:  { type: ObjectId, ref: 'Track', index: true }
  , _play:   { type: ObjectId, ref: 'Play' , index: true }
  , _room:   { type: ObjectId, ref: 'Room' , index: true }
});

ChatSchema.virtual('isoDate').get(function() {
  return this.created.toISOString();
});

ChatSchema.index({ _room: 1 , created: -1 });

var Chat = mongoose.model('Chat', ChatSchema);

// export the model to anything requiring it.
module.exports = {
  Chat: Chat
};
