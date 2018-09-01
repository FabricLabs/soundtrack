var mongoose = require('mongoose')
  , Schema = mongoose.Schema
  , ObjectId = mongoose.SchemaTypes.ObjectId
  , passportLocalMongoose = require('passport-local-mongoose')
  , slug = require('mongoose-slug')
  , rest = require('restler');

// this defines the fields associated with the model,
// and moreover, their type.
var ArtistSchema = new Schema({
    name: { type: String, required: true, unique: true } // canonical name
  , names: [ { type: String } ] // known names
  , image: {
      url: { type: String, default: 'http://coursefork.org/img/user-avatar.png' }
    }
  , bio: String
  , tracking: {
      tracks: {
        updated: { type: Date , default: 0 }
      }
    }
});

ArtistSchema.pre('save', function(next) {
  var self = this;

  if (!self.bio || !self.image.url) {
    rest.get('http://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist='+encodeURIComponent(self.name)+'&format=json&api_key=89a54d8c58f533944fee0196aa227341').on('complete', function(data) {
      if (data.artist) {
        if (data.artist.bio) {
          self.bio = strip_tags(data.artist.bio.summary).replace(/Read more about (.*) on Last.fm./, '');
        }
        if (data.artist.image[3]) {
          self.image.url = data.artist.image[3]['#text'];
        }
      }

      next();
    });
  } else {
    next();
  }
});

ArtistSchema.plugin( slug('name', {
    track: true
  , lang: false
}) );
ArtistSchema.index({ slug: 1 });
ArtistSchema.index({ slugs: 1 });

var Artist = mongoose.model('Artist', ArtistSchema);

// export the model to anything requiring it.
module.exports = {
  Artist: Artist
};

function strip_tags (input, allowed) {
  // http://kevin.vanzonneveld.net
  // +   original by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
  // +   improved by: Luke Godfrey
  // +      input by: Pul
  // +   bugfixed by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
  // +   bugfixed by: Onno Marsman
  // +      input by: Alex
  // +   bugfixed by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
  // +      input by: Marc Palau
  // +   improved by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
  // +      input by: Brett Zamir (http://brett-zamir.me)
  // +   bugfixed by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
  // +   bugfixed by: Eric Nagel
  // +      input by: Bobby Drake
  // +   bugfixed by: Kevin van Zonneveld (http://kevin.vanzonneveld.net)
  // +   bugfixed by: Tomasz Wesolowski
  // +      input by: Evertjan Garretsen
  // +    revised by: Rafał Kukawski (http://blog.kukawski.pl/)
  // *     example 1: strip_tags('<p>Kevin</p> <br /><b>van</b> <i>Zonneveld</i>', '<i><b>');
  // *     returns 1: 'Kevin <b>van</b> <i>Zonneveld</i>'
  // *     example 2: strip_tags('<p>Kevin <img src="someimage.png" onmouseover="someFunction()">van <i>Zonneveld</i></p>', '<p>');
  // *     returns 2: '<p>Kevin van Zonneveld</p>'
  // *     example 3: strip_tags("<a href='http://kevin.vanzonneveld.net'>Kevin van Zonneveld</a>", "<a>");
  // *     returns 3: '<a href='http://kevin.vanzonneveld.net'>Kevin van Zonneveld</a>'
  // *     example 4: strip_tags('1 < 5 5 > 1');
  // *     returns 4: '1 < 5 5 > 1'
  // *     example 5: strip_tags('1 <br/> 1');
  // *     returns 5: '1  1'
  // *     example 6: strip_tags('1 <br/> 1', '<br>');
  // *     returns 6: '1  1'
  // *     example 7: strip_tags('1 <br/> 1', '<br><br/>');
  // *     returns 7: '1 <br/> 1'
  allowed = (((allowed || "") + "").toLowerCase().match(/<[a-z][a-z0-9]*>/g) || []).join(''); // making sure the allowed arg is a string containing only tags in lowercase (<a><b><c>)
  var tags = /<\/?([a-z][a-z0-9]*)\b[^>]*>/gi,
    commentsAndPhpTags = /<!--[\s\S]*?-->|<\?(?:php)?[\s\S]*?\?>/gi;
  return input.replace(commentsAndPhpTags, '').replace(tags, function ($0, $1) {
    return allowed.indexOf('<' + $1.toLowerCase() + '>') > -1 ? $0 : '';
  });
}
