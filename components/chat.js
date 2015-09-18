var ObjectId = require('maki/node_modules/mongoose').SchemaTypes.ObjectId;

var Chat = {
  attributes: {
    created: { type: Date, default: Date.now },
    _author: { type: ObjectId, required: true, ref: 'Person' },
    _track:  { type: ObjectId, ref: 'Track', index: true },
    _play:   { type: ObjectId, ref: 'Play' , index: true },
    _room:   { type: ObjectId, ref: 'Room' , index: true },
    message: { type: String }
  }
}

module.exports = Chat;
