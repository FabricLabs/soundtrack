var _ = require('underscore');

var MAGIC_REGEX = (function() {
  return new RegExp(require('fs')
                    .readFileSync(__dirname+'/magic-regex.txt', 'utf8')
                    .split('\n')
                    .map(function(line) {
                      return line.split('#')[0].trim()
                    })
                    .join('')
                   ,
                    'gi'
                   )
})()


exports.helpers = {
  prepareChatMessage: function(message) {
    return _.map(message.split(" "), function (element) {
      if (MAGIC_REGEX.test(element)) {
        return '<a href=' + element + ' target="_blank">' + _.escape(element) + '</a>'
      } else {
        return _.escape(element)
      }
    }).join(" ")
  }
}
