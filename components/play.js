var ObjectId = require('maki/node_modules/mongoose').SchemaTypes.ObjectId;

var Play = {
  attributes: {
    _track:     { type: ObjectId, ref: 'Track' , index: true },
    _artist:    { type: ObjectId, ref: 'Artist' },
    _artists: [ { type: ObjectId, ref: 'Artist' } ],
    _curator:   { type: ObjectId, ref: 'Person', index: true },
    _room:      { type: ObjectId, ref: 'Room', required: true , index: true },
    timestamp:  { type: Date, default: Date.now, index: true },
    length:     { type: Number },
    played:     { type: Number }
  }
}

module.exports = Play;
