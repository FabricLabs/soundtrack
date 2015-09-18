var ObjectId = require('maki/node_modules/mongoose').SchemaTypes.ObjectId;

var Room = {
  attributes: {
    name:        { type: String , required: true , slug: true },
    description: { type: String },
    created:     { type: Date, default: Date.now },
    _creator:    { type: ObjectId, ref: 'Person' },
    _owner:      { type: ObjectId, ref: 'Person' },
    _moderators: [ { type: ObjectId , ref: 'Person' } ]
  }
}

module.exports = Room;
