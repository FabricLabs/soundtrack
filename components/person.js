var ObjectId = require('maki/node_modules/mongoose').SchemaTypes.ObjectId;

var Person = {
  attributes: {
    email: { type: String, unique: true, sparse: true },
    roles: [ { type: String, enum: ['editor', 'moderator'] } ],
    created: { type: Date , default: Date.now , required: true },
    avatar: {
      url: { type: String, default: '/img/user-avatar.png' }
    },
    bio: { type: String, default: '' }
  }
}

module.exports = Person;
