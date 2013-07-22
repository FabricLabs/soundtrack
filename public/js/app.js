$(document).ready(function(){
  var sockjs = null;
  var retryTimes = [1000, 5000, 10000, 30000, 60000, 120000, 300000, 600000]; //in ms
  var retryIdx = 0;

  $('.message .message-content').filter('.message-content:contains("'+ $('a[data-for=user-model]').data('username') + '")').parent().addClass('highlight');

  startSockJs = function(){
    sockjs = new SockJS('/stream');

    sockjs.onopen = function(){
      //sockjs connection has been opened!
      $.post('/socket-auth', {}, function(data){
        sockjs.send(JSON.stringify({type: 'auth', authData: data.authData}));
      });
    }

    sockjs.onmessage = function(e) {
      retryIdx = 0; //reset our retry timeouts

      var msg = JSON.parse(e.data);

      console.log(msg);

      switch (msg.type) {
        default: console.log('unhandled message: ' + msg); break;
        case 'track':
          if (msg.data._artist) {
            $('#track-title').attr('href', '/'+msg.data._artist.slug+'/'+msg.data.slug+'/'+msg.data._id);

            $('#track-artist').attr('href', '/'+msg.data._artist.slug);
            $('#track-artist').html( msg.data._artist.name );
          } else {
            $('#track-artist').html( 'unknown' );
          }
          
          $('#track-title').html( msg.data.title );


          $('input[name=current-track-id]').val( msg.data._id );
          if (msg.data.curator) {
            $('#track-curator').html('<a title="added by" href="/'+msg.data.curator.slug+'">'+msg.data.curator.username+'</a>');
          
            $('#userlist li').removeClass('current-curator');
            $('#userlist li[data-user-id='+msg.data.curator._id+']').addClass('current-curator');
          } else {
            $('#track-curator').html('the machine');
          }

          ytplayer.cueVideoById( msg.data.sources.youtube[0].id );
          ytplayer.seekTo( msg.seekTo );
          ytplayer.playVideo();
          updatePlaylist();
        break;
        case 'playlist:add':
          updatePlaylist();
        break;
        case 'playlist:update':
          updatePlaylist();
        break;
        case 'join':
          updateUserlist();
        break;
        case 'part':
          $('#userlist li[data-user-id='+msg.data._id+']').remove();
        break;
        case 'chat':
          $( msg.data.formatted ).appendTo('#messages');
          $("#messages").scrollTop($("#messages")[0].scrollHeight);
          $('.message .message-content').filter(':contains("'+ $('a[data-for=user-model]').data('username') + '")').parent().addClass('highlight');
        break;
        case 'ping':
          sockjs.send(JSON.stringify({type: 'pong'}));
          console.log("Ping Pong\'d");
        break;
        case 'announcement':
          $( msg.data.formatted ).appendTo('#messages');
          $("#messages").scrollTop($("#messages")[0].scrollHeight);
        break;
      }
    };

    sockjs.onclose = function() { 
      console.log('Lost our connection, lets retry!');
      if (retryIdx < retryTimes.length) {
        console.log("Retrying connection in " + retryTimes[retryIdx] + 'ms');
        setTimeout(restartSockJs, retryTimes[retryIdx++]);
      } else {
        alert('Bummer. We lost connection.');
      }
    };
  }

});

function onYouTubePlayerReady(playerId) {
  ytplayer = document.getElementById("ytPlayer");

  restartSockJs = function(){
    sockjs = null;
    startSockJs();
  }

  restartSockJs();

  ytplayer.addEventListener("onStateChange", "onPlayerStateChange");
  ytplayer.addEventListener("onError", "onPlayerError");

  if (!registered) {
    introJs().start();
    mutePlayer();
  } else {
    if ($.cookie('lastVolume')) {
      ytplayer.setVolume( $.cookie('lastVolume') );
      volume.slider('setValue', $.cookie('lastVolume')).val($.cookie('lastVolume'));
    } else {
      mutePlayer();
    }
  }

  ytplayer.playVideo();

  setInterval(function() {
    // TODO: use angularJS for this
    var time = ytplayer.getCurrentTime().toString().toHHMMSS();
    var total = ytplayer.getDuration().toString().toHHMMSS();
    $('#current-track #time').html( time + '/' + total);

    var progress = ((ytplayer.getCurrentTime() / ytplayer.getDuration()) * 100);
    $('#track-progress .bar').css('width', progress + '%');
    $('#track-progress').attr('title', progress + '%');

  }, 1000);

};

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

function AppController($scope, $http) {
  window.updatePlaylist = function(){
    $http.get('/playlist.json').success(function(data){
      $scope.tracks = data;
    });
  }

  updatePlaylist();
}

function updateUserlist() {
  $.get('/listeners.json', function(data) {
    $('#userlist').html('');
    $('.user-count').html('<strong>'+data.length+'</strong> online');
    data.forEach(function(user) {
      // TODO: use template (Blade?)
      $('<li data-user-id="' + user._id + '"><a href="/'+user.slug+'">'+user.username+'</a></li>').appendTo('#userlist');
    });
  });
}

$(window).on('load', function() {
  updatePlaylist();
  updateUserlist();
  $("#messages").scrollTop($("#messages")[0].scrollHeight);

  // Lets Flash from another domain call JavaScript
  var params = { allowScriptAccess: 'always', 'wmode' : 'transparent' };
  // The element id of the Flash embed
  var atts = { id: "ytPlayer" };

  // All of the magic handled by SWFObject (http://code.google.com/p/swfobject/)
  swfobject.embedSWF("http://www.youtube.com/apiplayer?version=3&enablejsapi=1&playerapiid=player1", "screen-inner", "570", "295", "9", null, null, params, atts);

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

  $('#chat-form').on('submit', function(e) {
    e.preventDefault();

    var msg = $('#chat-input').val();
    if (msg.length > 0) {
      $('#chat-input').val('');
      OutgoingChatHandler.chatSubmit(msg);
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

  $('#create-playlist-form').on('submit', function(e) {
    e.preventDefault();
    var self = this;

    $('#create-playlist-modal').modal('hide');
    // TODO: use real username, if only for rest purposes.
    $.post('/username/playlists', {
        name:        $('#create-playlist-form input[name=name]').val()
      , description: $('#create-playlist-form textarea[name=description]').val()
      , trackID:     $('input[name=current-track-id]').val()
    }, function(data) {
      console.log('playlist created!');

      $('<li data-playlist-id="'+ data.results._id +'" data-action="save-track"><a data-playlist-id="'+ data.results._id +'" data-action="save-track">'+ data.results.name +'</a></li>').insertBefore('ul[data-for=user-playlists] li:last-child');

    });
    return false;
  });

  $(document).on('click', '*[data-action=save-track]', function(e) {
    var self = this;

    $.post('/' + $('a[data-for=user-model]').data('username') +'/playlists/' + $(self).data('playlist-id'), {
      trackID: $('input[name=current-track-id]').val()
    }, function(data) {
      // TODO: update UI with correct count
      console.log(data);
    });

  });

  $(document).on('click', '*[data-action=upvote-track]', function(e) {
    e.preventDefault();
    var self = this;

    $.post('/playlist/' + $(self).data('track-id'), {
      v: 'up'
    }, function(data) {
      console.log(data);
    });

    return false;
  });

  $(document).on('click', '*[data-action=downvote-track]', function(e) {
    e.preventDefault();
    var self = this;

    $.post('/playlist/' + $(self).data('track-id'), {
      v: 'down'
    }, function(data) {
      console.log(data);
    });

    return false;
  });

  $(document).on('click', '.message *[data-role=author]', function(e) {
    e.preventDefault();
    var self = this;
    $('#chat-input').val( $('#chat-input').val() + ' @'+$(self).data('user-username') + ' ');
    $('#chat-input').focus();
    return false;
  });

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
