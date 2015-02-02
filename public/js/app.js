var DEFAULT_MAX_SOURCE_TIME = 5000;
var DEFAULT_VOLUME          = 80;
var COOKIE_EXPIRES          = 604800;

// Begin actual class implementation...
var Soundtrack = function() {
  this.settings = {
      notifications:        $.cookie('notificationsEnabled')
    , streaming:           ($.cookie('streaming') !== 'false') ? true : false
    , avoidVideo:          ($.cookie('avoidVideo') === 'true') ? true : false
    , maxTimeToPlaySource: $.cookie('maxTimeToPlaySource', Number) || DEFAULT_MAX_SOURCE_TIME
  };
  this.user = {
    username: $('a[data-for=user-model]').data('username')
  };
  this.room = {
    name: '',
    track: {
      title: '',
      artist: ''
    }
  };
  this.controls = {
    volume: {}
  }
  // stub out the player, since sometimes we don't load it.
  this.player = {
    ready:       function( callback )     { return callback(); },
    src:         function( src )          { return src; },
    pause:       function()               { return this; },
    play:        function()               { return this; },
    on:          function( event , cb )   { return this; },
    one:         function( event , cb )   { return this; },
    volume:      function( level )        { return this; },
    currentTime: function( t )            { return 0; },
    duration:    function( t )            { return 0; },
    error:       function( e )            { return this; },
  }
};
Soundtrack.prototype.checkNotificationPermissions = function(callback) {
  if (window.webkitNotifications.checkPermission() != 0) {
    window.webkitNotifications.requestPermission(function(e) {
      console.log(e);
    });
  }
}
Soundtrack.prototype.notify = function(img, title, content, callback) {

  if (!this.settings.notifications) { return false; }

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
Soundtrack.prototype.editTrackID = function( trackID ) {
  $editor = $('form[data-for=edit-track]');

  $.getJSON('/tracks/' + encodeURIComponent(trackID), function(track) {
    if (!track || !track._id) { return alert('No such track.'); }

    $editor.data('track-id',    track._id );
    $editor.data('artist-slug', track._artist.slug );
    $editor.data('artist-id',   track._artist._d );
    $editor.data('track-slug',  track.slug );

    $editor.find('input[name=trackArtistID]').val( track._artist._id );
    $editor.find('input[name=artist]').val( track._artist.name );
    $editor.find('input[name=title]').val( track.title );

    $editor.find('*[data-context=track]').data('track-id', track._id);

    $editor.find('*[data-context=track][data-action=track-flag-nsfw]').prop('checked', track.flags.nsfw );
    $editor.find('*[data-context=track][data-action=track-flag-live]').prop('checked', track.flags.live );

    var titles = track.titles;
    if (titles.indexOf( track.title ) == -1) {
      titles.push( track.title );
    }

    track.sources.youtube.forEach(function(video) {
      if (video.data && titles.indexOf( video.data.title ) == -1) {
        titles.push( video.data.title );
      }
    });

    track.sources.soundcloud.forEach(function(track) {
      if (track.data && titles.indexOf( track.data.title ) == -1) {
        titles.push( track.data.title );
      }
    });

    $editor.find('pre[data-for=titles]').html( titles.join('<br />') );

    /* $editor.find('input.typeahead').typeahead({
        name: 'artists'
      , remote: '/artists?q=%QUERY'
    }); */

    $editor.modal();
  });
}

function volumeChangeHandler(e) {
  var vol = Number( e.value );

  soundtrack.player.volume( vol / 100 );
  $.cookie('lastVolume' , vol, { expires: COOKIE_EXPIRES });
};

function mutePlayer(saveState) {
  // TODO: why doesn't this work with just 0?  Why does it only work with 0.001?
  soundtrack.player.volume( 0.00001 );
  $.cookie('lastVolume', 0);
  $('.slider[data-for=volume]').slider('setValue', 0).val(0);
}

function unmutePlayer() {
  var lastVol = $.cookie('lastVolume', Number);

  if (lastVol) {
    soundtrack.player.volume(lastVol / 100);
    $('.slider[data-for=volume]').slider('setValue', lastVol).val(lastVol);
  } else {
    soundtrack.player.volume( 0.8 );
    $('.slider[data-for=volume]').slider('setValue', DEFAULT_VOLUME).val( DEFAULT_VOLUME );
    $.cookie('lastVolume', DEFAULT_VOLUME, { expires: COOKIE_EXPIRES });
  }
}

function ensureVolumeCorrect() {
  var lastVol = $.cookie('lastVolume', Number);
  console.log('setting volume to ', lastVol / 100);

  soundtrack.player.volume( lastVol / 100 );

  if ($('.slider[data-for=volume]')[0]) {
    $('.slider[data-for=volume]').slider('setValue', lastVol ).val( lastVol );
  }
}

function updateUserlist() {
  $.get('/listeners.json', function(data) {
    $('#userlist').html('');
    $('.user-count').html('<strong>' + data.length + '</strong> online');
    data.forEach(function(user) {
      // TODO: use template (Blade?)
      if (user.role != 'listener') {
        $('<li data-user-id="' + user._id + '"><a href="/' + user.slug + '"><img src="' + user.avatar.url + '" class="user-avatar-small pull-left" />' + user.username + ' <span class="badge pull-right" title="editors can fix track titles and artist names.  ping @martindale if you want to help.">' + user.role + '</span></a></li>').appendTo('#userlist');
      } else {
        $('<li data-user-id="' + user._id + '"><a href="/' + user.slug + '"><img src="' + user.avatar.url + '" class="user-avatar-small pull-left" />' + user.username + '</a></li>').appendTo('#userlist');
      }

    });
  });
}
var videoToggled = false; //TODO: Should this use Cookie?

function toggleVideo() {
  if (videoToggled)
    toggleVideoOn();
  else
    toggleVideoOff();
}

function toggleVideoOn() {
  $('#screen-one *').css('height', '300px');
  $('#messages').css('height', '256px');
  $(this).children('i').replaceWith($('<i class="icon-chevron-up"></i>'));
  $("#messages").scrollTop($("#messages")[0].scrollHeight);

  videoToggled = false;
}

function toggleVideoOff() {
  $('#screen-one *').css('height', '0px');
  $('#messages').css('height', '541px');
  $(this).children('i').replaceWith($('<i class="icon-chevron-down"></i>'));

  videoToggled = true;
}

angular.module('timeFilters', []).
  filter('toHHMMSS', function() {
    return function(input) {
      var sec_num = parseInt(input, 10); // don't forget the second parm
      var hours = Math.floor(sec_num / 3600);
      var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
      var seconds = sec_num - (hours * 3600) - (minutes * 60);

      if (hours < 10) {
        hours = "0" + hours;
      }
      if (minutes < 10) {
        minutes = "0" + minutes;
      }
      if (seconds < 10) {
        seconds = "0" + seconds;
      }

      if (hours != '00') {
        var time = hours + ':' + minutes + ':' + seconds;
      } else {
        var time = minutes + ':' + seconds;
      }
      return time;
    }
  });

angular.module('soundtrack-io', ['timeFilters']);

function AppController($scope, $http) {
  window.updatePlaylist = function() {
    console.log('angular updatePlaylist()')
    $http.get('/playlist.json').success(function(data) {
      if (!data) var data = [];

      $scope.tracks = data.map(function(t) {
        if (t.images && t.images.thumbnail && t.images.thumbnail.url) {
          // strip hardcoded http urls
          t.images.thumbnail.url = t.images.thumbnail.url.replace('http:', '');
        }
        return t;
      });

      $scope.playlistLength = data.map(function(x) {
        return x.duration;
      }).reduce(function(prev, now) {
        return prev + now;
      });

      if (typeof(soundtrack) != 'undefined') {
        soundtrack.room.track = data[0];
      }
    });
  }

  updatePlaylist();
}

String.prototype.toHHMMSS = function() {
  var sec_num = parseInt(this, 10); // don't forget the second parm
  var hours = Math.floor(sec_num / 3600);
  var minutes = Math.floor((sec_num - (hours * 3600)) / 60);
  var seconds = sec_num - (hours * 3600) - (minutes * 60);

  if (hours < 10) {
    hours = "0" + hours;
  }
  if (minutes < 10) {
    minutes = "0" + minutes;
  }
  if (seconds < 10) {
    seconds = "0" + seconds;
  }

  if (hours != '00') {
    var time = hours + ':' + minutes + ':' + seconds;
  } else {
    var time = minutes + ':' + seconds;
  }
  return time;
}
Number.prototype.toHHMMSS = String.prototype.toHHMMSS;

deferred = new $.Deferred();
promise = deferred.promise();

promise.done(function() {

  if ($('.slider[data-for=volume]')[0]) {
    soundtrack.controls.volume = $('.slider[data-for=volume]').slider();
    soundtrack.controls.volume.on('slide slideStart', volumeChangeHandler);
    if (!$.cookie('lastVolume', Number)) {
      $.cookie('lastVolume', DEFAULT_VOLUME);
    }
  }

  ensureVolumeCorrect();

  setInterval(function() {
    // TODO: use angularJS for this
    var duration = soundtrack.player.duration() || 0;

    var time = soundtrack.player.currentTime().toString().toHHMMSS();
    var total = duration.toString().toHHMMSS();
    $('#current-track #time').html( time + '/' + total );

    var progress = ((soundtrack.player.currentTime() / soundtrack.player.duration()) * 100);
    $('#track-progress .bar').css('width', progress + '%');
    $('#track-progress').attr('title', progress + '%');

    $('.timestamp').each(function(i , el) {
      var $el = $(el);
      $el.html( moment( $el.attr('title') ).fromNow() );
    });


  }, 1000);
});

$(window).load(function() {

  var sockjs = null;
  var retryTimes = [1000, 5000, 10000, 30000, 60000, 120000, 300000, 600000, 86400000]; //in ms
  var retryIdx = 0;

  // must be after DOM loads so we have access to the user-model
  soundtrack = new Soundtrack();
  if ($('#main-player').length) {
    soundtrack.player = videojs('#main-player', {
      techOrder: ['html5', 'youtube', 'flash'],
      forceHTML5: true,
      forceSSL: true,
      controls: true,
      autoload: true
    });
    soundtrack.player.controls(true);
  } //else {
  //  soundtrack.player = videojs('#secondary-player', {
  //  techOrder: ['html5', 'youtube']
  //  });
  //  mutePlayer( false );
  //}

  if (!$.cookie('maxTimeToPlaySource')) {
    $.cookie('maxTimeToPlaySource', soundtrack.settings.maxTimeToPlaySource );
  }
  $('*[data-for=max-source-load-time]').val( $.cookie('maxTimeToPlaySource', Number) );

  soundtrack.player.ready(function() {
    console.log('player loaded. :)');

    soundtrack.startSockJs = function() {
      soundtrack.sockjs = new SockJS('/stream');

      soundtrack.sockjs.onopen = function() {
        //sockjs connection has been opened!
        $.post('/socket-auth', {}, function(data) {
          soundtrack.sockjs.send(JSON.stringify({
            type: 'auth',
            authData: data.authData
          }));
        });
      }

      soundtrack.sockjs.onmessage = function(e) {
        retryIdx = 0; //reset our retry timeouts
        var received = new Date();

        var msg = JSON.parse(e.data);
        console.log(msg);

        switch (msg.type) {
          default: console.log('unhandled message: ' + msg);
          break;
          case 'edit':
            updatePlaylist();
          break;
          case 'track':
            updatePlaylist();

            if (msg.data._artist) {
              $('#track-title').attr('href', '/' + msg.data._artist.slug + '/' + msg.data.slug + '/' + msg.data._id);

              $('#track-artist').attr('href', '/' + msg.data._artist.slug);
              $('#track-artist').html(msg.data._artist.name);
            } else {
              $('#track-artist').html('unknown');
            }

            $('#track-title').html( msg.data.title );


            $('input[name=current-track-id]').val(msg.data._id);
            $('*[data-for=current-track-id]').data('track-id', msg.data._id);

            if (msg.data.curator) {
              $('#track-curator').html('<a title="added by" href="/' + msg.data.curator.slug + '">' + msg.data.curator.username + '</a>');

              $('#userlist li').removeClass('current-curator');
              $('#userlist li[data-user-id=' + msg.data.curator._id + ']').addClass('current-curator');
            } else {
              $('#track-curator').html('the machine');
            }

            console.log('STREAMING : ' + soundtrack.settings.streaming);

            if (soundtrack.settings.streaming) {
              var sources = [];

              // use the new sources array if available
              if (msg.sources) {
                msg.data.sources = msg.sources
              };

              if (soundtrack.settings.avoidVideo) {
                msg.data.sources.soundcloud.forEach(function(item) {
                  sources.push({
                    type: 'audio/mp3',
                    src: 'https://api.soundcloud.com/tracks/' + item.id + '/stream?client_id=7fbc3f4099d3390415d4c95f16f639ae',
                    poster: (item.data) ? item.data.artwork_url : undefined
                  });
                });
                msg.data.sources.youtube.forEach(function(item) {
                  sources.push({
                    type: 'video/youtube',
                    src: 'https://www.youtube.com/watch?v=' + item.id
                  });
                });
              } else {
                msg.data.sources.youtube.forEach(function(item) {
                  sources.push({
                    type: 'video/youtube',
                    src: 'https://www.youtube.com/watch?v=' + item.id
                  });
                });
                msg.data.sources.soundcloud.forEach(function(item) {
                  sources.push({
                    type: 'audio/mp3',
                    src: 'https://api.soundcloud.com/tracks/' + item.id + '/stream?client_id=7fbc3f4099d3390415d4c95f16f639ae',
                    poster: (item.data) ? item.data.artwork_url : undefined
                  });
                });
              }

              if (msg.data.sources.bandcamp) {
                msg.data.sources.bandcamp.forEach(function(item) {
                  sources.push({
                    type: 'audio/mp3',
                    src: item.data.url,
                    poster: (item.data) ? item.data.artwork_url : undefined
                  });
                });
              }

              var rollIt = function() {
                console.log('rollIt()', sources[0]);
                if (!sources[0]) return;

                soundtrack.player.error( null );
                soundtrack.player.poster( sources[0].poster );

                soundtrack.player.pause();
                soundtrack.player.src( [ sources[0] ] );
                soundtrack.player.play();
              }

              console.log('sources: ', sources);
              if (!sources.length) {
                $.ajax({
                  url: '/tracks/' + msg.data._id,
                  method: 'PUT',
                  data: {
                    flags: {
                      lackingSources: true
                    }
                  }
                }, function(data) {
                  console.log('submitted the track as needing more sources: ', data);
                });
              } else {
                rollIt();
                // track should now be playing.

                var maxTimeToPlayTrack = soundtrack.settings.maxTimeToPlaySource;
                var ensureTrackPlaying = setInterval(function() {
                  if (soundtrack.player.currentTime() > 0 || !sources.length) {
                    console.log('track is playing (yay!), or there are no remaining sources (boo). clearing interval.');
                    clearInterval( ensureTrackPlaying )
                  } else {
                    console.log('track is NOT playing after %dms... advancing to next source', maxTimeToPlayTrack);
                    console.log('failed to load: ', sources[0] );

                    sources.shift();
                    console.log('shifted sources: ', sources );
                    rollIt();
                  }
                }, maxTimeToPlayTrack );
              }

              var bufferEvaluator = function() {
                var now = new Date();
                var estimatedSeekTo = (msg.seekTo * 1000) + (now - received);
                var estimatedProgress = estimatedSeekTo / (msg.data.duration * 1000);

                if (estimatedSeekTo / 1000 > 5) {
                  soundtrack.player.currentTime( estimatedSeekTo / 1000 );
                }

                ensureVolumeCorrect();
              };

              soundtrack.player.one('playing', bufferEvaluator );

              var track = msg.data;

            }

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
            $('#userlist li[data-user-id=' + msg.data._id + ']').slideUp();
            updateUserlist();
          break;
          case 'chat':
            $( msg.data.formatted ).appendTo('#messages');

            setTimeout(function() {
              $("#messages").scrollTop($("#messages")[0].scrollHeight);
            }, 100);

            $('.message .message-content').filter(':contains("' + $('a[data-for=user-model]').data('username') + '")').parent().addClass('highlight');

            if (msg.data.message.toLowerCase().indexOf('@' + soundtrack.user.username.toLowerCase()) >= 0) {
              soundtrack.notify('https://soundtrack.io/favicon.ico', 'New Mention in Chat', msg.data.message);
            }
          break;
          case 'ping':
            soundtrack.sockjs.send(JSON.stringify({
              type: 'pong'
            }));
            console.log("Ping Pong\'d");
          break;
          case 'announcement':
            $( unescape( msg.data.formatted ) ).appendTo('#messages');
            $("#messages").scrollTop($("#messages")[0].scrollHeight);
          break;
        }
      };

      soundtrack.sockjs.onclose = function() {
        console.log('Lost our connection, lets retry!');
        if (retryIdx < retryTimes.length) {
          console.log("Retrying connection in " + retryTimes[retryIdx] + 'ms');
          setTimeout(restartSockJs, retryTimes[retryIdx++]);
        } else {
          alert('Bummer. We lost connection.');
        }
      };
    }

    restartSockJs = function() {
      soundtrack.sockjs = null;
      soundtrack.startSockJs();
    }

    restartSockJs();

    deferred.resolve();

  });

  $('.message .message-content').filter('.message-content:contains("' + $('a[data-for=user-model]').data('username') + '")').parent().addClass('highlight');

  updatePlaylist();
  updateUserlist();

  // breaks javascript if page doesn't have #messages
  //$("#messages").scrollTop($("#messages")[0].scrollHeight);
  $('.tablesorter').tablesorter();
  $('*[data-action=toggle-volume]').click(function(e) {
    e.preventDefault();
    var self = this;
    var currentVolume = Number( $('.slider[data-for=volume]').slider('getValue') );

    if (currentVolume) {
      mutePlayer();
      $(self).children('i').replaceWith('<i class="icon-volume-off" />');
    } else {
      unmutePlayer();
      $(self).children('i').replaceWith('<i class="icon-volume-up" />');
    }

    return false;
  });

  OutgoingChatHandler = (function() {
    var listeners = {};
    var triggerWord = /^\/(\w+)/i;
    var CHAT_DEFAULT = '$DEFAULT$';

    function addListener(trigger, listener) {
      if (!listeners[trigger]) {
        listeners[trigger] = [];
      }

      listeners[trigger].push(listener);
    }

    function notify(key, msg) {
      if (listeners[key]) {
        listeners[key].forEach(function(l) {
          l(msg);
        });

        return true;
      }

      return false;
    }

    function chatSubmit(msg) {
      var matches = msg.match(triggerWord);
      if (matches) {
        if (notify(matches[1], msg )) {
          return;
        }
      }

      notify(CHAT_DEFAULT, msg);
    }

    //add our default chat handler that actually sends the messages
    addListener(CHAT_DEFAULT, function(msg) {
      $.post('/chat', {
        message: msg
      }, function(data) {});
      $("#messages").scrollTop($("#messages")[0].scrollHeight);
    });

    return {
      addListener: addListener,
      chatSubmit: chatSubmit,
      CHAT_DEFAULT: CHAT_DEFAULT
    }
  })();

  // /reset -> reset the video player
  OutgoingChatHandler.addListener('reset', function(msg) {
    var cur = soundtrack.player.currentTime();
    soundtrack.player.pause();
    soundtrack.player.currentTime(cur);
    soundtrack.player.play();
  });

  OutgoingChatHandler.addListener('stream', function(msg) {
    if (!msg) return true;
    switch ((msg.split(' ')[1] || '').toLowerCase()) {
      case 'on':
        $('<div class="message"><strong id="announcement">Streaming turned on.</strong></div>').appendTo('#messages');
        $("#messages").scrollTop($("#messages")[0].scrollHeight);

        $.cookie('streaming', true);
        soundtrack.settings.streaming = true;
        soundtrack.sockjs.close();
        soundtrack.startSockJs();
      break;
      case 'off':
        $.cookie('streaming', false);
        soundtrack.settings.streaming = false;
        soundtrack.player.pause();
        $('<div class="message"><strong id="announcement">Streaming turned off.</strong></div>').appendTo('#messages');
        $("#messages").scrollTop($("#messages")[0].scrollHeight);
      break;
      default:
        var status = (soundtrack.settings.streaming) ? 'on' : 'off';
        $('<div class="message"><strong id="announcement">Stream is ' + status + '.</strong></div>').appendTo('#messages');
        $("#messages").scrollTop($("#messages")[0].scrollHeight);
      break;
    }
  });

  // /video -> toggle video
  OutgoingChatHandler.addListener('video', function(msg) {
    switch ((msg.split(' ')[1] || '').toLowerCase()) {
      case 'on':
        toggleVideoOn();
      break;
      case 'off':
        toggleVideoOff();
      break;
      default:
        toggleVideo();
      break;
    }
  });

  partying = false;
  OutgoingChatHandler.addListener('party', function(msg) {
    if (partying) {
      $('.partying').removeClass('partying');
    } else {
      var d = function() {
        var b = Math.floor(Math.random() * 255),
          a = Math.floor(Math.random() * 255),
          c = Math.floor(Math.random() * 255);
        return "rgb(" + b + "," + a + "," + c + ")"
      }, h = function() {
          jQuery("p, li, h1, h2, h3, div, span, a, input").each(function(b, a) {
            if (jQuery(a).children().size() == 0 && !jQuery(a).hasClass("partying")) {
              var c = jQuery(a).text().split(" "),
                c = jQuery.map(jQuery.makeArray(c), function(a) {
                  return "<b style=\"color:" + d() + ";display:inline ! important;font-size:auto ! important;font-weight:inherit ! important\" class=\"partying\">" + a + "</b>"
                });
              jQuery(a).html(c.join(" "))
            }
          });
          jQuery(".partying").each(function(b, a) {
            jQuery(a).css("color", d())
          });
          partying = true;
        }, g = function() {
          setTimeout(function() {
            h();
            g();
            jQuery("body").css("background-color", d())
          }, 100)
        };
      g();
    }
  });

  OutgoingChatHandler.addListener('katamari', function(msg) {
    var i, s, ss = ['http://kathack.com/js/kh.js', 'http://ajax.googleapis.com/ajax/libs/jquery/1.5.1/jquery.min.js'];
    for (i = 0; i != ss.length; i++) {
      s = document.createElement('script');
      s.src = ss[i];
      document.body.appendChild(s);
    }
    void(0);
  });

  OutgoingChatHandler.addListener('doge', function(msg) {
    var e = document.createElement('script');
    e.src = 'https://raw.github.com/martindale/libdoge/master/libdoge/libdoge.min.js';
    document.body.appendChild(e);
  });

  OutgoingChatHandler.addListener('dance', function(msg) {
    (function() {
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
        setTimeout(function() {
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
        setTimeout(function() {
          x(k)
        }, 500);
        setTimeout(function() {
          N();
          p();
          for (var e = 0; e < O.length; e++) {
            T(O[e])
          }
        }, 500);
        setTimeout(function() {
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

  $(document).on('click', '*[data-action=skip-track]', function(e) {
    e.preventDefault();
    if (confirm("Are you sure you want to skip?")) {
      soundtrack.player.pause();
      $.post('/skip');
    }
    return false;
  });

  $(document).on('click', '*[data-action=remove-queued-track]', function(e) {
    e.preventDefault();
    var self = this;

    $('#playlist-list li[data-track-id=' + $(self).data('track-id') + ']').slideUp();

    $.ajax({
      url: '/playlist/' + $(self).data('track-id'),
      method: 'DELETE',
      data: {
        index: $(self).data('track-index')
      }
    }, function(data) {
      console.log(data);
    });

    return false;
  });

  $(document).on('click', '*[data-for=track-search-reset]', function(e) {
    e.preventDefault();
    $('*[data-for=track-search-results]').html('');
    $('*[data-for=track-search-query]').val('');
    $('#search-modal *[data-for=track-search-query]').focus();
    $('*[data-for=track-search-select-source]').removeClass('btn-primary');
    return false;
  });

  $(document).on('click', '*[data-for=track-search-select-source]', function(e) {
    e.preventDefault();
    var self = this;

    $('*[data-for=track-search-select-source]').removeClass('btn-primary');
    $(self).addClass('btn-primary');

    if ($(self).data('data') == 'all') {
      $('*[data-for=track-search-results] li').slideDown();
    } else {

      $('*[data-for=track-search-results] li:not(*[data-source=' + $(self).data('data') + '])').slideUp();
      $('*[data-for=track-search-results] li[data-source=' + $(self).data('data') + ']').slideDown();
    }

    return false;
  });

  var selectTrack = _.debounce(function(e) {
    e.preventDefault();
    var self = this;

    $(self).slideUp(function() {
      $(this).remove();
    });

    $.post('/playlist', {
      source: $(self).data('source'),
      id: $(self).data('id')
    }, function(response) {
      console.log(response);
    });

    return false;
  }, 200, true);

  $(document).on('click', '*[data-action=queue-track]', selectTrack);
  
  $(document).on('click', '*[data-action=queue-set]', function(e) {
    e.preventDefault();
    var $self = $(this);
    $.getJSON('/' + $self.data('set-slug') , function(set) {
      set._tracks.forEach(function(track) {
        $.post('/playlist', {
          source: 'soundtrack',
          id: track._id
        }, function(response) {
          console.log(response);
        });
      });
    });
    
    return false;
  });

  $(document).on('click', '*[data-action=launch-playlist-editor]', function(e) {
    e.preventDefault();
    $('#playlist-modal').modal('show');
    return false;
  });

  $(document).on('click', '*[data-action=launch-playlist-creator]', function(e) {
    e.preventDefault();
    var $self = $(this);

    $('#create-playlist-modal').modal('show');
    $('#create-playlist-form').children('input[name=trackID]').val( $self.data('track') );
    $('#create-playlist-form').children('input[name=current-track-id]').val( $self.data('track') );
    
    // TODO: replace with local data cache / Maki datastore
    $.getJSON('/tracks/'+$self.data('track'), function(track) {
      var $track = $('*[data-for=track-name]');
      $track.children('.track-artist').html( track._artist.name );
      $track.children('.track-title').html( track.title );
      
      $track.children('*[data-for=track-preview]').html( soundtrack._templates.preview( track ) );
      
    });

    return false;
  });
  
  soundtrack._templates = {
    preview: function( track ) {
      if (track.sources && track.sources.youtube && track.sources.youtube.length) {
        var video = track.sources.youtube[0];
        return '<iframe id="ytplayer" type="text/html" width="300" height="170" src="//www.youtube.com/embed/'+ video.id +'" frameborder="0"/>';
      }
      
      return 'no preview available :(';
    }
  };

  $(document).on('click', '*[data-action=add-track-to-playlist]', function(e) {
    e.preventDefault();
    var self = this;

    $(self).slideUp(function() {
      $(this).remove();
    });

    $.post('/' + $(self).data('username') + '/playlists/' + $(self).data('playlist-id'), {
      trackID: $(self).data('track-id')
    }, function(data) {
      // TODO: update UI with correct count
      console.log(data);
    });

    return false;
  });

  $(document).on('submit', 'form[data-for=track-search]', function(e) {
    e.preventDefault();
    var self = this;

    $('*[data-for=track-search-results]').html('');
    $('#search-modal').modal().on('hidden', function() {
      $('*[data-for=track-search-results]').html('');
      $('*[data-for=track-search-query]').val('');
      $('*[data-for=track-search-select-source]').removeClass('btn-primary');
    });

    var query = $(self).find('*[data-for=track-search-query]').val();
    var maxLength = 1200;

    $('*[data-for=track-search-query]').val( query );

    var $input = $('#search-modal *[data-for=track-search-query]');
    $input[0].selectionStart = $input[0].selectionEnd = $input.val().length;

    // TODO: execute search queries in parallel
    $.getJSON('https://gdata.youtube.com/feeds/api/videos?max-results=50&v=2&alt=jsonc&q=' + query, function(data) {
      data.data.items.forEach(function(item) {
        if (item.duration <= maxLength) {
          $('<li data-source="youtube" data-title="' + item.title + '" data-id="' + item.id + '"><span class="pull-right badge">youtube</span><span class="pull-right badge">' + item.duration.toHHMMSS() + '</span><img src="' + item.thumbnail.sqDefault + '" class="thumbnail-medium" />' + item.title + '<div class="pull-right clearfix"><button class="btn btn-mini pull-right">queue this! &raquo;</button></div></li><div class="clearfix" />').on('click', selectTrack).appendTo('*[data-for=track-search-results]');
        }
      });
    });

    $.getJSON('https://api.soundcloud.com/tracks.json?&limit=50&client_id=7fbc3f4099d3390415d4c95f16f639ae', {
      q: query
    }, function(tracks) {
      if (!tracks.length) {
        return false;
      }
      tracks.forEach(function(track) {
        if (track.duration / 1000 <= maxLength) {
          $('<li data-source="soundcloud" data-title="' + track.title + '" data-id="' + track.id + '"><span class="pull-right badge">soundcloud</span><span class="pull-right badge">' + (track.duration / 1000).toHHMMSS() + '</span><img src="' + track.artwork_url + '" class="thumbnail-medium" />' + track.title + '<div class="pull-right clearfix"><button class="btn btn-mini pull-right">queue this! &raquo;</button></div></li><div class="clearfix" />').on('click', selectTrack).appendTo('*[data-for=track-search-results]');
        }
      });
    });

    /*/$.ajax({
        url: 'https://api.vimeo.com/videos?query=the%20mountain%20tso'
      , dataType: 'json'
      , headers: {
        'Authorization': 'Basic MGViZjM3MDU1OTczMGE2NjM0ODVlNTkxZDkwNGFkNGFhZGI2ZjA1MjozZTE3N2Q0NzNiYzk1YWQ4OGU0ODViN2VhODAwOTQzNmJjZmEwYWI3'
      }
      , success: function(data) {
        console.log(data);
      }
    });/**/

    return false;
  });

  $('#create-playlist-form').on('submit', function(e) {
    e.preventDefault();
    var self = this;

    $('#create-playlist-modal').modal('hide');
    // TODO: use real username, if only for rest purposes.
    $.post('/username/playlists', {
      name: $('#create-playlist-form input[name=name]').val(),
      description: $('#create-playlist-form textarea[name=description]').val(),
      trackID: $('input[name=current-track-id]').val(),
      status: ($('#create-playlist-form input[name=status]').prop('checked')) ? 'public' : 'private'
    }, function(data) {
      console.log('playlist created!');

      $('<li data-playlist-id="' + data.results._id + '" data-action="save-track"><a data-playlist-id="' + data.results._id + '" data-action="save-track">' + data.results.name + '</a></li>').insertBefore('ul[data-for=user-playlists] li:last-child');

    });
    return false;
  });

  $(document).on('click', '*[data-action=launch-track-editor]', function(e) {
    e.preventDefault();
    var self = this;
    soundtrack.editTrackID($(self).data('track-id'));
    return false;
  });

  $(document).on('click', '*[data-action=track-flag-nsfw]', function(e) {

    var self = this;
    var trackID = $(self).data('track-id');

    $.post('/tracks/' + trackID, {
      nsfw: true
    }, function(data) {
      console.log(data);
    });

  });

  $(document).on('click', '*[data-action=track-flag-live]', function(e) {

    var self = this;
    var trackID = $(self).data('track-id');

    $.post('/tracks/' + trackID, {
      live: true
    }, function(data) {
      console.log(data);
    });

  });

  $(document).on('submit', 'form[data-for=edit-track]', function(e) {
    e.preventDefault();
    var self = this;

    console.log('track edit submission...');

    var trackID    = $(self).data('track-id')
      , artistSlug = $(self).data('artist-slug')
      , artistID   = $(self).data('artist-id')
      , trackSlug  = $(self).data('track-slug');

    $.post('/' + artistSlug + '/' + trackSlug + '/' + trackID, {
      title: $(self).find('input[name=title]').val(),
      artistName: $(self).find('input[name=artist]').val(),
      artistID: $(self).find('input[name=trackArtistID]').val()
    }, function(data) {
      console.log(data);
      $(self).modal('hide');
    });

    return false;
  });

  $(document).on('click', '*[data-for=swap-artist-title]', function(e) {
    e.preventDefault();
    var self = this;

    var currentArtist = $('form[data-for=edit-track]').find('input[name=artist]').val();
    var currentTitle = $('form[data-for=edit-track]').find('input[name=title]').val();

    $('form[data-for=edit-track]').find('input[name=artist]').val( currentTitle );
    $('form[data-for=edit-track]').find('input[name=title]').val( currentArtist );

    return false;
  });

  $(document).on('click', '*[data-action=save-track]', function(e) {
    var self = this;

    $.post('/' + $('a[data-for=user-model]').data('username') + '/playlists/' + $(self).data('playlist-id'), {
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
    $('#chat-input').val( $('#chat-input').val() + ' @' + $(self).data('user-username') + ' ');
    $('#chat-input').focus();
    return false;
  });

  $(document).on('click', '*[data-action=toggle-video]', function(e) {
    toggleVideo();
  });

  $(document).on('keyup mouseup', '*[data-for=max-source-load-time]', function(e) {
    var self = this;
    console.log('max wait time: ', $(self).val());
    $.cookie('maxTimeToPlaySource', $(self).val());
    soundtrack.settings.maxTimeToPlaySource = Number($(self).val());
  });

  $('*[data-action=ding]').click(function(e) {
    e.preventDefault();
    soundtrack.checkNotificationPermissions();
    return false;
  });

  $(document).on('click', '*[data-action=toggle-playlist-visibility]', function(e) {
    var self = this;
    $.post('/fakeuser/playlists/' + $(self).data('playlist-id') + '/edit', {
      status: ($(self).prop('checked')) ? 'public' : 'private'
    }, function(data) {
      console.log(data);
    });
  });

  $(document).on('click', '*[data-action=delete-playlist]', function(e) {
    var self = this;

    if (confirm('Are you sure you would like to delete this playlist?')) {
      $.ajax({
        url: '/playlists/' + $(self).data('playlist-id'),
        type: 'DELETE',
        complete: function() {
          $(self).parent().parent().slideUp().remove();
        }
      });
    }
  });

  $(document).on('click', '*[data-action=remove-track-from-playlist]', function(e) {
    var self = this;

    if (confirm('Are you sure you would like to remove this track?')) {
      $.ajax({
        url: '/playlists/' + $(self).data('playlist-id') + '/' + $(self).data('index'),
        type: 'DELETE',
        complete: function() {
          $(self).parent().parent().parent().slideUp().remove();
        }
      });
    }
  });

  $(document).on('click', '*[data-action=enable-profile-editor]', function(e) {
    var self = this;
    $('.bio').replaceWith($('#profile-editor').show());
  });

  $('*[data-action=toggle-scrobble]').on('click', function(e) {
    var self = this;
    if ($(self).prop('checked')) {
      $.cookie('scrobblingEnabled', true, { expires: COOKIE_EXPIRES });
      $.post('/settings', {
        scrobble: true
      }, function(data) {
        console.log(data);
      });
    } else {
      $.cookie('scrobblingEnabled', false, { expires: COOKIE_EXPIRES });
      $.post('/settings', {
        scrobble: false
      }, function(data) {
        console.log(data);
      });
    }
  });

  $('*[data-action=toggle-video-avoid]').on('click', function(e) {
    var self = this;
    if ($(self).prop('checked')) {
      $.cookie('avoidVideo', true, { expires: COOKIE_EXPIRES });
      $.post('/settings', {
        avoidVideo: true
      }, function(data) {
        console.log(data);
      });
    } else {
      $.cookie('avoidVideo', false, { expires: COOKIE_EXPIRES });
      $.post('/settings', {
        avoidVideo: false
      }, function(data) {
        console.log(data);
      });
    }
  });

  $('*[data-action=toggle-notifications]').on('click', function(e) {
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
      91, 93 // WebKit
    ];
    if (e.ctrlKey || e.metaKey || $.inArray(e.keyCode, commandKeyCodes)) {
      skipWarning = e.type == "keydown";
    }
  });

  function warnBeforeInterrupting(e) {
    // Warning for navigating away from the page via chat links
    if (e.which != 2 && !skipWarning) {
      if (!confirm("Continuing will stop playback. Are you sure?")) {
        e.preventDefault();
      }
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

  if ($.cookie('scrobblingEnabled') === 'true') {
    $('*[data-action=toggle-scrobble]').prop('checked', true);
  }

  if ($.cookie('avoidVideo') === 'true') {
    $('*[data-action=toggle-video-avoid]').prop('checked', true);
  }

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
