var app = angular.module('soundtrack', ['ui.bootstrap.dialog']);

function mutePlayer() {
  ytplayer.setVolume(0);
  volume.slider('setValue', 0).val(0);
}
function unmutePlayer() {
  if ($.cookie('lastVolume')) {
    ytplayer.setVolume( $.cookie('lastVolume') );
    volume.slider('setValue', $.cookie('lastVolume')).val($.cookie('lastVolume'));
  } else {
    ytplayer.setVolume(80);
    volume.slider('setValue', 80).val(80);
    $.cookie('lastVolume', '80');
  }
}

// Format youtube progress timer
String.prototype.toHHMMSS = function () {
  var sec_num = parseInt(this, 10); // don't forget the second parm
  var hours   = Math.floor(sec_num / 3600);
  var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
  var seconds = sec_num - (hours * 3600) - (minutes * 60);

  if (hours   < 10) {hours   = "0"+hours;}
  if (minutes < 10) {minutes = "0"+minutes;}
  if (seconds < 10) {seconds = "0"+seconds;}

  if (hours != '00') {
    var time    = hours+':'+minutes+':'+seconds;
  } else {
    var time    = minutes+':'+seconds;
  }
  return time;
}

$(window).on('load', function() {
  
  //init youtube iframe
  var tag = document.createElement('script');
  tag.src = "https://www.youtube.com/iframe_api";
  var firstScriptTag = document.getElementsByTagName('script')[0];
  firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

  // Toggle mute button
  $('*[data-action=toggle-volume]').click(function(e) {
    e.preventDefault();
    var self = this;
    var currentVolume = parseInt(volume.slider('getValue').val());

    if (localStorage.getItem('debug')) {
      console.log('currentVolume is a ' + typeof(currentVolume) + ' and is ' + currentVolume);
    }

    if (currentVolume) {
      mutePlayer();
      $(self).children('i').replaceWith('<i class="icon-volume-off" />');
    } else {
      unmutePlayer();
      $(self).children('i').replaceWith('<i class="icon-volume-up" />');
    }

    return false;
  });

  // Set volume on slider slide
  volume = $('.slider').slider().on('slide', function(e) {
    var self = this;
    ytplayer.setVolume( $(self).val() );
    $.cookie('lastVolume', $(self).val() );
  });

  OutgoingChatHandler = (function(){
    var listeners = {};
    var triggerWord = /^\/(\w+)/i;

    function addListener(trigger, listener) {
      if (!listeners[trigger]) {
        listeners[trigger] = [];
      }

      listeners[trigger].push(listener);
    }

    function defaultFn(msg) {
      $.post('/chat', { message: msg }, function(data){})
    }

    function chatSubmit(msg) {
      var matches = msg.match(triggerWord);
      if (matches) {
        if (listeners[matches[1]]) {
          listeners[matches[1]].forEach(function(l){
            l(msg);
          });
          return;
        }
      }
      defaultFn(msg);
    }

    return {
      addListener: addListener,
      chatSubmit: chatSubmit
    }
  })();

  // /reset -> reset the video player
  OutgoingChatHandler.addListener('reset', function(msg){
    var cur = ytplayer.getCurrentTime();
    ytplayer.stopVideo();
    ytplayer.seekTo(cur);
    ytplayer.playVideo();
  });

  partying = false;
  OutgoingChatHandler.addListener('party', function(msg) {
    if (partying) {
      $('.partying').removeClass('partying');
    } else {
      var d = function () {
        var b = Math.floor(Math.random() * 255),
          a = Math.floor(Math.random() * 255),
          c = Math.floor(Math.random() * 255);
        return "rgb(" + b + "," + a + "," + c + ")"
      }, h = function () {
          jQuery("p, li, h1, h2, h3, div, span, a, input").each(function (b, a) {
            if (jQuery(a).children().size() == 0 && !jQuery(a).hasClass("partying")) {
              var c = jQuery(a).text().split(" "),
                c = jQuery.map(jQuery.makeArray(c), function (a) {
                  return "<b style=\"color:" + d() + ";display:inline ! important;font-size:auto ! important;font-weight:inherit ! important\" class=\"partying\">" + a + "</b>"
                });
              jQuery(a).html(c.join(" "))
            }
          });
          jQuery(".partying").each(function (b, a) {
            jQuery(a).css("color", d())
          });
          partying = true;
        }, g = function () {
          setTimeout(function () {
            h();
            g();
            jQuery("body").css("background-color", d())
          }, 100)
        };
      g();
    }

  });

  // Send chat
  $('#chat-form').on('submit', function(e) {
    e.preventDefault();

    var msg = $('#chat-input').val();
    if (msg.length > 0) {
      $('#chat-input').val('');
      OutgoingChatHandler.chatSubmit(msg);
    }

    return false;
  });

  // Search for and add tracks to the room playlist
  $('#search-form').on('submit', function(e) {
    e.preventDefault();
    $('#search-results').html('');

    $.getJSON('http://gdata.youtube.com/feeds/api/videos?max-results=20&v=2&alt=jsonc&q=' + $('#search-query').val(), function(data) {
      if (localStorage.getItem('debug')) {
        console.log('youtube_gdata_response', data.data.items);
      }

      data.data.items.forEach(function(item) {
        $('<li data-source="youtube" data-id="'+item.id+'"><img src="'+item.thumbnail.sqDefault+'" class="thumbnail-medium" />' +item.title+' </li>').on('click', function(e) {
          e.preventDefault();
          var self = this;

          $.post('/playlist', {
              source: $(self).data('source')
            , id: $(self).data('id')
          }, function(response) {
            if (localStorage.getItem('debug')) {
              console.log('add_track_response', response);
            }
          });

          $('#search-results').html('');
          $('#search-query').val('');

          return false;
        }).appendTo('#search-results');
      });
    });

    return false;
  });

  // Upvote track in playlist
  $(document).on('click', '*[data-action=upvote-track]', function(e) {
    e.preventDefault();
    var self = this;

    $.post('/playlist/' + $(self).data('track-id'), {
      v: 'up'
    }, function(data) {
      if (localStorage.getItem('debug')) {
        console.log('upvote_response', data);
      }
    });

    return false;
  });

  // Downvote track in playlist
  $(document).on('click', '*[data-action=downvote-track]', function(e) {
    e.preventDefault();
    var self = this;

    $.post('/playlist/' + $(self).data('track-id'), {
      v: 'down'
    }, function(data) {
      if (localStorage.getItem('debug')) {
        console.log('downvote_response', data);
      }
    });

    return false;
  });

  // Mention user by clicking their name
  $(document).on('click', '.message *[data-role=author]', function(e) {
    e.preventDefault();
    var self = this;
    $('#chat-input').val( $('#chat-input').val() + ' @'+$(self).data('user-username') + ' ');
    $('#chat-input').focus();
    return false;
  });

  // Toggle chat covering video
  $(document).on('click', '*[data-action=toggle-video]', function(e) {
    if (parseInt($('#messages').css('height')) != 230) {
      $('#screen-one *').css('height', '295px'); $('#messages').css('height', '230px');
      $(this).children('i').replaceWith($('<i class="icon-chevron-up"></i>'));
      $("#messages").scrollTop($("#messages")[0].scrollHeight);
    } else {
      $('#screen-one *').css('height', '0px'); $('#messages').css('height', '511px');
      $(this).children('i').replaceWith($('<i class="icon-chevron-down"></i>'));
    }
  });

});
