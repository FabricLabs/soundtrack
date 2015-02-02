var mongoose = require('mongoose')
  , Schema = mongoose.Schema
  , ObjectId = mongoose.SchemaTypes.ObjectId
  , slug = require('mongoose-slug')
  , slugify = require('mongoose-slug')
  , rest = require('restler')
  , async = require('async')
  , _ = require('underscore');

// this defines the fields associated with the model,
// and moreover, their type.
var TrackSchema = new Schema({
    title: { type: String, required: true }
  , titles: [ { type: String } ]
  , _artist: { type: ObjectId, ref: 'Artist' }
  , _credits: [ { type: ObjectId, ref: 'Artist' } ]
  , duration: { type: Number } // time in seconds
  , flags: {
        nsfw: { type: Boolean, default: false }
      , live: { type: Boolean, default: false }
    }
  , description: { type: String }
  , images: {
      thumbnail: { url: { type: String } }
    }
  , updated: { type: Date, default: 0 }
  , _sources: [ { type: ObjectId, ref: 'Source' } ]
  , sources: {
      lastfm: [ new Schema({
          id: { type: String , required: true }
        , duration: { type: Number }
        , data: {}
      }) ],
      youtube: [ new Schema({
          id: { type: String, required: true }
        , start: { type: Number, default: 0 }
        , duration: { type: Number }
        , data: {}
      })],
      soundcloud: [ new Schema({
          id: { type: String, required: true }
        , data: {}
      })],
      bandcamp: [ new Schema({
          id: { type: String, required: true }
        , data: {}
      })],
      vimeo: [ new Schema({
          id: { type: String, required: true }
        , data: {}
      })]
    }
  , _remixes: [ new Schema({
        _artist: { type: ObjectId, ref: 'Artist' }
      , _track: { type: ObjectId, ref: 'Track' }
    }) ]
});

TrackSchema.pre('save', function(next) {
  var self = this;

  /** for (var source in self.sources) {
    self._sources.push({ });
  } **/

  // de-dupe sources
  var tempTrack = self.toObject();
  for (var source in tempTrack.sources) {
    var sourceMap = {};
    
    var sourcesForProvider = tempTrack.sources[ source ] || [];
    sourcesForProvider.forEach(function( s ) {
      sourceMap[ s.id ] = s;
    });
    
    self.sources[ source ] = Object.keys( sourceMap ).map(function( k ) {
      return sourceMap[ k ];
    });
  }

  ['youtube', 'soundcloud'].forEach(function(source) {

    switch (source) {
      case 'youtube':    var type = 'video/youtube'; break;
      case 'soundcloud': var type = 'audio/mp3';     break;
    }

    self.sources[ source ].forEach(function(s) {
      Source.findOne({ uri: s.id }).exec(function(err, storedSource) {
        if (err) { console.log(err); }
        if (!storedSource && type) {
          var storedSource = new Source({
              id: [ source , s.id ].join(':')
            , type: type
          });
          storedSource.save(function(err) {
            if (err) { console.log(err); }
          });
        }
      });
    });
  });

  // de-dupe credits
  self._credits = _.uniq( self._credits );
  
  next();
});

TrackSchema.post('init', function() {
  var self = this;

  if (!self._artist) {
    var data = {
      author: self.title.split(' - ')[0]
    };

    Artist.findOne({ $or: [
        , { slug: slugify( data.author ) }
        , { name: data.author }
    ] }).exec(function(err, artist) {

      if (!artist) { var artist = new Artist({
        name: data.author
      }); }

      self._artist = artist._id;

      self.save(function(err) {

      });

    });
  }
});

TrackSchema.statics.random = function(callback) {
  this.count(function(err, count) {
    if (err) {
      return callback(err);
    }
    var rand = Math.floor(Math.random() * count);
    this.findOne().skip(rand).exec(callback);
  }.bind(this));
};

TrackSchema.plugin( slug('title', {
  track: true
}) );
TrackSchema.index({ slug: 1 });

var Track = mongoose.model('Track', TrackSchema);

// export the model to anything requiring it.
module.exports = {
  Track: Track
};
