var crypto = require('crypto');

module.exports = {
  configureToken: function(req, res){
    crypto.randomBytes(32, function(ex, buf){
      var authData = buf.toString('hex');
      var token = {token: authData, user: req.user, time: (new Date()).getTime()};
      req.app.socketAuthTokens.push(token);
      res.send({authData: authData});
    });
  }
}