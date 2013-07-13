function onYouTubePlayerReady(playerId) {
  ytplayer = document.getElementById("ytPlayer");

  var sockjs = new SockJS('stream');

  sockjs.onopen    = function()  {  };
  sockjs.onmessage = function(e) {
    var msg = JSON.parse(e.data);

    console.log(msg);

    switch (msg.type) {
      default: console.log('unhandled message: ' + msg); break;
      case 'track':
        $('#current-track #track-title').html( msg.data.title );
        ytplayer.cueVideoById( msg.data.sources.youtube[0].id );
        ytplayer.seekTo( msg.seekTo );
        ytplayer.playVideo();
        updatePlaylist();
      break;
      case 'playlist:add':
        updatePlaylist();
      break;
      case 'join':
        $('<li data-user-id="' + msg.data.id + '">'+msg.data.id+'</li>').appendTo('#userlist');
      break;
      case 'part':
        $('#userlist li[data-user-id='+msg.data.id+']').remove();
      break;
      case 'chat':
        $( msg.data.formatted ).appendTo('#messages');
        $('#messages').animate({ scrollTop: $('#messages > *').length * 200 }, "fast");
      break;
    }
  };
  sockjs.onclose   = function() { 
    // TODO: reconnect
    if (confirm('Lost connection.  Reconnect?')) {
      location.reload();
    }
  };

  ytplayer.addEventListener("onStateChange", "onPlayerStateChange");
  ytplayer.addEventListener("onError", "onPlayerError");

  if (!registered) {
    introJs().start();
  }
  mutePlayer();

  ytplayer.playVideo();

  setInterval(function() {
    // TODO: use angularJS for this
    var time = ytplayer.getCurrentTime().toString().toHHMMSS();

    $('#current-track #time').html( time );
  }, 1000);

};

function mutePlayer() {
  ytplayer.setVolume(0);
  volume.slider('setValue', 0).val(0);
}
function unmutePlayer() {
  ytplayer.setVolume(80);
  volume.slider('setValue', 80).val(80);
}

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
function updatePlaylist() {
  $.get('/playlist.json', function(data) {
    $('#playlist').html('');
    data.forEach(function(track) {
      $('<li><img src="'+track.images.thumbnail.url+'" class="thumbnail-medium" />'+track.title+'</li>').appendTo('#playlist');
    });
  });
}
function updateUserlist() {
  $.get('/listeners.json', function(data) {
    $('#userlist').html('');
    data.forEach(function(user) {
      if (user) {
        $('<li data-user-id="' + user.id + '">'+user.id+'</li>').appendTo('#userlist');
      }
    });
  });
}

$(window).on('load', function() {
  updatePlaylist();
  updateUserlist();
  $('#messages').animate({ scrollTop: $('#messages > *').length * 200 }, "fast");

  // Lets Flash from another domain call JavaScript
  var params = { allowScriptAccess: "always" };
  // The element id of the Flash embed
  var atts = { id: "ytPlayer" };

  // All of the magic handled by SWFObject (http://code.google.com/p/swfobject/)
  swfobject.embedSWF("http://www.youtube.com/apiplayer?version=3&enablejsapi=1&playerapiid=player1", "screen-inner", "480", "295", "9", null, null, params, atts);

  $('*[data-action=toggle-volume]').click(function(e) {
    e.preventDefault();
    var self = this;
    var currentVolume = parseInt(volume.slider('getValue').val());

    console.log('currentVolume is a ' + typeof(currentVolume) + ' and is ' + currentVolume);

    if (currentVolume) {
      mutePlayer();
      $(self).children('i').replaceWith('<i class="icon-volume-off" />');
    } else {
      unmutePlayer();
      $(self).children('i').replaceWith('<i class="icon-volume-up" />');
    }

    return false;
  });


  volume = $('.slider').slider().on('slide', function(e) {
    var self = this;
    ytplayer.setVolume( $(self).val() );
  });

  $('#chat-form').on('submit', function(e) {
    e.preventDefault();

    var msg = $('#chat-input').val();
    if (msg.length > 0) {
      $('#chat-input').val('');
      $.post('/chat', {
        message: msg
      }, function(data) {

      });
    }

    return false;
  });
  $('#search-form').on('submit', function(e) {
    e.preventDefault();
    $('#search-results').html('');

    $.getJSON('http://gdata.youtube.com/feeds/api/videos?max-results=20&v=2&alt=jsonc&q=' + $('#search-query').val(), function(data) {
      console.log(data.data.items);

      data.data.items.forEach(function(item) {
        $('<li data-source="youtube" data-id="'+item.id+'"><img src="'+item.thumbnail.sqDefault+'" class="thumbnail-medium" />' +item.title+' </li>').on('click', function(e) {
          e.preventDefault();
          var self = this;

          $.post('/playlist', {
              source: $(self).data('source')
            , id: $(self).data('id')
          }, function(response) {
            console.log(response);
          });

          $('#search-results').html('');
          $('#search-query').val('');

          return false;
        }).appendTo('#search-results');
      });
    });

    return false;
  });

});
