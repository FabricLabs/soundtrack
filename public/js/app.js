function onYouTubePlayerReady(playerId) {
  ytplayer = document.getElementById("ytPlayer");

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

$(window).on('load', function() {
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

    $.post('/chat', {
      message: $('#chat-input').val()
    }, function(data) {
      $('#chat-input').val('');
    });

    return false;
  });
  $('#search-form').on('submit', function(e) {
    e.preventDefault();

    $.getJSON('http://gdata.youtube.com/feeds/api/videos?max-results=20&v=2&alt=jsonc&q=' + $('#search-query').val(), function(data) {
      console.log(data.data.items);

      data.data.items.forEach(function(item) {
        $('<li data-source="youtube" data-id="'+item.id+'">' +item.title+'</li>').on('click', function(e) {
          e.preventDefault();
          var self = this;

          $.post('/playlist', {
              source: $(self).data('source')
            , id: $(self).data('id')
          }, function(response) {
            $('#search-results').html('');
            $('#search-query').val('');
            console.log(response);
          });

          return false;
        }).appendTo('#search-results');
      });
    });

    return false;
  });

});
