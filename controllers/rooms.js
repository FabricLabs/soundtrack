var slugify = require('speakingurl');

module.exports = {
  list: function(req, res, next) {
    Room.find().exec(function(err, rooms) {
      res.format({
        json: function() { res.send( rooms ); }
      })
    });
  },
  create: function(req, res, next) {
    var name = req.param('name');
    var slug = req.param('slug');
    var description = req.param('description');
    
    if (!name || !slug) {
      res.flash('error', 'You must provide a name and a slug!');
      return res.redirect('back');
    }
    
    slug = slugify( slug );
    
    Room.count({ slug: slug }).exec(function(err, count) {
      if (count) {
        res.flash('error', 'That room already exists.');
        return res.redirect('back');
      }
      
      var room = new Room({
        name: name,
        slug: slug,
        description: description,
        _creator: req.user._id,
        _owner: req.user._id
      });
      room.save(function(err) {
        if (err) return res.error( err );
        
        var playlist = []
        var app = req.app;

        app.rooms[ room.slug ] = room;
        app.rooms[ room.slug ].playlist = playlist;
        app.rooms[ room.slug ].listeners = {};
        
        app.rooms[ room.slug ].bind( req.soundtrack );
        
        app.rooms[ room.slug ].startMusic( errorHandler );
        
        function done() {
          app.locals.rooms = app.rooms;
          
          var config = req.app.config;
          return res.redirect( ((config.app.safe) ? 'https://' : 'http://') + slug + '.' + config.app.host );
        }
        
        function errorHandler(err) {
          if (err) {
            return app.rooms[ room.slug ].retryTimer = setTimeout(function() {
              app.rooms[ room.slug ].startMusic( errorHandler );
            }, 5000 );
          }
          
          return done();
        }

      });
      
    });

  }
}
