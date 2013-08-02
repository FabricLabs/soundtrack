var Soundtrack = function() {
  this.settings = {
    notifications: $.cookie('notificationsEnabled')
  };
  this.user = {
    username: $('a[data-for=user-model]').data('username')
  };
};
Soundtrack.prototype.checkNotificationPermissions = function(callback) {
  if (window.webkitNotifications.checkPermission() != 0) {
    window.webkitNotifications.requestPermission(function(e) {
      console.log(e);
    });
  }
}
Soundtrack.prototype.notify = function(img, title, content, callback) {
  var notification = window.webkitNotifications.createNotification( img , title , content );
  notification.ondisplay = function(e) {
    setTimeout(function() {
      e.currentTarget.cancel();
    }, 15000);
  }
  notification.onclick = function() {
    window.focus();
    this.cancel();
  }
  notification.show();
};

$(document).ready(function(){

  var sockjs = null;
  var retryTimes = [1000, 5000, 10000, 30000, 60000, 120000, 300000, 600000]; //in ms
  var retryIdx = 0;
  COOKIE_EXPIRES = 30;

  // must be after DOM loads so we have access to the user-model
  soundtrack = new Soundtrack();

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

          if ($('#playlist-list li:first').data('track-id') == msg.data._id) {
            $('#playlist-list li:first').slideUp('slow', function() {
              $('#playlist-list li:first').attr('style', 'display: none;');
              updatePlaylist();
            });
          } else {
            updatePlaylist();
          }

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
        
          if ( msg.data.message.toLowerCase().indexOf( '@'+ soundtrack.user.username.toLowerCase() ) >= 0 ) {
            soundtrack.notify( 'https://soundtrack.io/favicon.ico', 'New Mention in Chat', msg.data.message );
          }

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
    $.cookie('lastVolume', '80', { expires: COOKIE_EXPIRES });
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

  // breaks javascript if page doesn't have #messages
  //$("#messages").scrollTop($("#messages")[0].scrollHeight);

  // Lets Flash from another domain call JavaScript
  var params = { allowScriptAccess: 'always', 'wmode' : 'transparent' };
  // The element id of the Flash embed
  var atts = { id: "ytPlayer" };

  // All of the magic handled by SWFObject (http://code.google.com/p/swfobject/)
  swfobject.embedSWF("https://www.youtube.com/apiplayer?version=3&enablejsapi=1&playerapiid=player1", "screen-inner", "100%", "295", "9", null, null, params, atts);

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
    $.cookie('lastVolume', $(self).val() , { expires: COOKIE_EXPIRES });
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

  OutgoingChatHandler.addListener('katamari', function(msg) {
    var i,s,ss=['http://kathack.com/js/kh.js','http://ajax.googleapis.com/ajax/libs/jquery/1.5.1/jquery.min.js'];for(i=0;i!=ss.length;i++){s=document.createElement('script');s.src=ss[i];document.body.appendChild(s);}void(0);
  });

  OutgoingChatHandler.addListener('dance', function(msg) {
    (function () {
      function c() {
        var e = document.createElement("link");
        e.setAttribute("type", "text/css");
        e.setAttribute("rel", "stylesheet");
        e.setAttribute("href", f);
        e.setAttribute("class", l);
        document.body.appendChild(e)
      }

      function h() {
        var e = document.getElementsByClassName(l);
        for (var t = 0; t < e.length; t++) {
          document.body.removeChild(e[t])
        }
      }

      function p() {
        var e = document.createElement("div");
        e.setAttribute("class", a);
        document.body.appendChild(e);
        setTimeout(function () {
          document.body.removeChild(e)
        }, 100)
      }

      function d(e) {
        return {
          height: e.offsetHeight,
          width: e.offsetWidth
        }
      }

      function v(i) {
        var s = d(i);
        return s.height > e && s.height < n && s.width > t && s.width < r
      }

      function m(e) {
        var t = e;
        var n = 0;
        while ( !! t) {
          n += t.offsetTop;
          t = t.offsetParent
        }
        return n
      }

      function g() {
        var e = document.documentElement;
        if ( !! window.innerWidth) {
          return window.innerHeight
        } else if (e && !isNaN(e.clientHeight)) {
          return e.clientHeight
        }
        return 0
      }

      function y() {
        if (window.pageYOffset) {
          return window.pageYOffset
        }
        return Math.max(document.documentElement.scrollTop, document.body.scrollTop)
      }

      function E(e) {
        var t = m(e);
        return t >= w && t <= b + w
      }

      function S() {
        var e = document.createElement("audio");
        e.setAttribute("class", l);
        e.src = i;
        e.loop = false;
        setTimeout(function () {
          x(k)
        }, 500);
        setTimeout(function () {
          N();
          p();
          for (var e = 0; e < O.length; e++) {
            T(O[e])
          }
        }, 500);
        setTimeout(function(){
          N();
          h()
        }, 30000);
        e.innerHTML = " <p>If you are reading this, it is because your browser does not support the audio element. We recommend that you get a new browser.</p> <p>";
        document.body.appendChild(e);
        //e.play()
      }

      function x(e) {
        e.className += " " + s + " " + o
      }

      function T(e) {
        e.className += " " + s + " " + u[Math.floor(Math.random() * u.length)]
      }

      function N() {
        var e = document.getElementsByClassName(s);
        var t = new RegExp("\\b" + s + "\\b");
        for (var n = 0; n < e.length;) {
          e[n].className = e[n].className.replace(t, "")
        }
      }
      var e = 30;
      var t = 30;
      var n = 350;
      var r = 350;
      var i = "//s3.amazonaws.com/moovweb-marketing/playground/harlem-shake.mp3";
      var s = "mw-harlem_shake_me";
      var o = "im_first";
      var u = ["im_drunk", "im_baked", "im_trippin", "im_blown"];
      var a = "mw-strobe_light";
      var f = "//s3.amazonaws.com/moovweb-marketing/playground/harlem-shake-style.css";
      var l = "mw_added_css";
      var b = g();
      var w = y();
      var C = document.getElementsByTagName("*");
      var k = null;
      for (var L = 0; L < C.length; L++) {
        var A = C[L];
        if (v(A)) {
          if (E(A)) {
            k = A;
            break
          }
        }
      }
      if (A === null) {
        console.warn("Could not find a node of the right size. Please try a different page.");
        return
      }
      c();
      S();
      var O = [];
      for (var L = 0; L < C.length; L++) {
        var A = C[L];
        if (v(A)) {
          O.push(A)
        }
      }
    })();
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

  $('*[data-action=ding]').click(function(e) {
    e.preventDefault();
    soundtrack.checkNotificationPermissions();
    return false;
  });

  $('*[data-action=toggle-playlist-visibility]').on('click', function(e) {
    var self = this;
    $.post('/fakeuser/playlists/' + $(self).data('playlist-id') + '/edit', {
      public: $(self).prop('checked')
    }, function(data) {
      console.log(data);
    });
  });

  $('*[data-action=enable-profile-editor]').on('click', function(e) {
    var self = this;
    $('.bio').replaceWith( $('#profile-editor').show() );
  });

  $('*[data-action=toggle-notifications').on('click', function(e) {
    var self = this;
    if ($(self).prop('checked')) {
      soundtrack.settings.notifications = true;
      soundtrack.checkNotificationPermissions();
      $.cookie('notificationsEnabled', true, { expires: COOKIE_EXPIRES });
    } else {
      soundtrack.settings.notifications = false;
      $.cookie('notificationsEnabled', false, { expires: COOKIE_EXPIRES });
    }
  });

  var skipWarning = false;
  $(document).bind('keyup keydown', function(e) {
    var commandKeyCodes = [
      224, // Firefox
      17, // Opera
      91, 93// WebKit
    ];
    if (e.ctrlKey || e.metaKey || $.inArray(e.keyCode, commandKeyCodes)) {
      skipWarning = e.type == "keydown";
    }
  });

  function warnBeforeInterrupting(e) {
    // Warning for navigating away from the page via chat links
    if (e.which != 2 && !skipWarning)
    if (!confirm("Continuing will stop playback. Are you sure?")) {
      e.preventDefault();
    }
    return true;
  };

  $('*[data-action=toggle-link-warning]').on('click', function(e) {
    var self = this;
    if ($(self).prop('checked')) {
      console.log('enabling link warning...');
      $(document).on('click', '.message-content a', warnBeforeInterrupting);
      $.cookie('warnBeforeInterrupting', true, { expires: COOKIE_EXPIRES });
    } else {
      console.log('disabling link warning...');
      $(document).off('click', '.message-content a', warnBeforeInterrupting);
      $.cookie('warnBeforeInterrupting', false, { expires: COOKIE_EXPIRES });
    }
  });

  $('*[data-action=toggle-target-blank]').on('click', function(e) {
    var self = this;
    if ($(self).prop('checked')) {
      $('base').attr('target', '_blank');
      $.cookie('openLinksInNewWindow', true, { expires: COOKIE_EXPIRES });
    } else {
      $('base').attr('target', '_self');
      $.cookie('openLinksInNewWindow', false, { expires: COOKIE_EXPIRES });
    }
  });

  if ($.cookie('notificationsEnabled') == 'true') {
    $('*[data-action=toggle-notifications]').prop('checked', true);
  }

  if ($.cookie('warnBeforeInterrupting') == 'true') {
    $('*[data-action=toggle-link-warning]').prop('checked', true);
    $(document).on('click', '.message-content a', warnBeforeInterrupting);
  }

  if ($.cookie('openLinksInNewWindow') == 'true') {
    $('*[data-action=toggle-target-blank]').prop('checked', true);
    $('base').attr('target', '_blank');
  }

});