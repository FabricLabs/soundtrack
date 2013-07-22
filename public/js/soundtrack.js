var app = angular.module('soundtrack', ['$strap.directives']);

//Create a socket for use in the rest of angular
app.factory('socket', function ($rootScope, $http) {
  
  var socket = $rootScope.$new();
  var sockjs;
  var retryTimes = [1000, 5000, 10000, 30000, 60000]; //in ms
  var retryIdx = 0;
  
  function init() {
    sockjs = new SockJS('/stream');

    // Called when the socket opens a new connection to the server
    sockjs.onopen = function() {
      // If we're logged in we should authenticate our socket
      if (registered) {
        $http.post('/socket-auth', {}).success(function(data) {
          sockjs.send(JSON.stringify({type: 'auth', authData: data.authData}));
        });
      }
    }

    // Called any time the socket receives a message from the server
    sockjs.onmessage = function(e) {
      retryIdx = 0; //reset our retry timeouts

      var msg = JSON.parse(e.data);

      // Check localStorage for debug so we dont spam regular users
      if (localStorage.getItem('debug')) {
        console.log(msg);
      }
      
      // This will emit an event of whatever type is sent in the message
      // and can be recieved via socket.$on('[type]')
      if (msg.type && typeof(msg.type) == "string") {
        socket.$emit(msg.type, msg)
      }
      else {
        console.warn("Unknown data received on socket", msg);
      }
      
      // This is a good example, this listens for messages of type 'ping'
      // and then tells the socket to send back a 'pong'
      socket.$on('ping', function(event, msg) {
        socket.send({type: 'pong'});
      });
    };

    // Called when the socket is either closed by the server or lost
    // due to connection issues, or the server restarting
    sockjs.onclose = function() { 
      console.log('Lost our connection, lets retry!');
      
      if (retryIdx < retryTimes.length) {
        console.log("Retrying connection in " + retryTimes[retryIdx] + 'ms');
        setTimeout(startSocket, retryTimes[retryIdx++]);
      }
      else {
        alert('Bummer. We lost connection.');
      }
    };
    
    // Can be called to send data to the server
    socket.send = function (data) {
      sockjs.send(JSON.stringify(data));
    };
  };
  
  window.startSocket = function() {
    sockjs = null;
    init();
  }
  
  return socket;
  
});

app.controller('PlaylistController', function($rootScope, $scope, $http, $modal, socket) {

  // This is called when the youtube iframe is loaded
  window.onYouTubeIframeAPIReady = function() {
    ytplayer = new YT.Player('screen-one', {
      height: '295',
      width: '570',
      playerVars: {
        controls: 0,
        showinfo: 0
      },
      events: {
        'onReady': $scope.onPlayerReady,
        'onStateChange': function(event) {
          if (localStorage.getItem('debug')) {
            console.log(event);
          }
        },
        'onError': function(event) {
          if (localStorage.getItem('debug')) {
            console.log(event);
          }
        },
        'onPlaybackQualityChange': function(event) {
          if (localStorage.getItem('debug')) {
            console.log(event);
          }
        },
        'onApiChange': function(event) {
          if (localStorage.getItem('debug')) {
            console.log(event);
          }
        },
        'onPlaybackRateChange': function(event) {
          if (localStorage.getItem('debug')) {
            console.log(event);
          }
        }
      }
    });
  };
  
  // Called when the player is loaded
  $scope.onPlayerReady = function(event) {
    
    // Initialize the socket now that we have a ytplayer object
    startSocket();
    
    // Set the player quality to decrease buffering
    ytplayer.setPlaybackQuality('medium');

    // Handle tutorial and volume levels
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

    // Track the current playback time/progress
    setInterval(function() {
      var time = ytplayer.getCurrentTime().toString().toHHMMSS();
      var total = ytplayer.getDuration().toString().toHHMMSS();
      $('#current-track #time').html( time + '/' + total);

      var progress = ((ytplayer.getCurrentTime() / ytplayer.getDuration()) * 100);
      $('#track-progress .bar').css('width', progress + '%');
      $('#track-progress').attr('title', progress + '%');
    }, 1000);
  };
  
  // Update the playlist with data from the server
  $scope.updatePlaylist = function(){
    $http.get('/playlist.json').success(function(data){
      $scope.tracks = data;
    });
  };
  
  // Handle new track event
  socket.$on('track', function(event, msg) {
    
    // Load an play the video
    ytplayer.cueVideoById( msg.data.sources.youtube[0].id );
    ytplayer.seekTo( msg.seekTo );
    ytplayer.playVideo();
    
    // Set the track data
    $rootScope.track = msg.data;
    
    // Set the curator to machine if none is provided
    if (!msg.data.curator) {
      $rootScope.track.curator = {
          username: "the machine"
        , slug: ""
      };
    }
    
    // Update the playlist
    $scope.updatePlaylist();
  });
  
  // Handle playlist change events
  socket.$on('playlist:add', $scope.updatePlaylist);
  socket.$on('playlist:update', $scope.updatePlaylist);
  
  // Gets the current user's playlists
  window.getPlaylists = function() {
    console.log('get playlists');
    $http.get('/' + $scope.userSlug + '/playlists').success(function(data) {
      if (data && data.status && data.status == 'success') {
        $scope.playlists = data.results.playlists;
      }
      else {
        console.warn('unable to get playlists');
      }
    });
  };
  
  $scope.selectPlaylist = function(playlist) {
    $scope.playlistTracks = playlist._tracks;
  };
  
  $scope.updatePlaylist();
  
  if (registered) {
    getPlaylists();
  }
});


app.controller('UsersController', function($rootScope, $scope, $http, socket) {
  
  // Gets the current list of users in the room
  $scope.updateUserlist = function(){
    $http.get('/listeners.json').success(function(data){
      $scope.users = data;
    });
  }
  
  // Bolds the current curator in the users list
  $scope.getClass = function(user) {
    if ($rootScope.track && $rootScope.track.curator) {
      if (user._id == $rootScope.track.curator._id) {
        return 'current-curator';
      }
    }
    return '';
  };
  
  // Handle join & part events
  socket.$on('join', $scope.updateUserlist);
  socket.$on('part', $scope.updateUserlist);
  
  $scope.updateUserlist();
});

app.controller('ChatController', function($scope, socket) {
  socket.$on('chat', function(event, msg) {
    $( msg.data.formatted ).appendTo('#messages');
    $("#messages").scrollTop($("#messages")[0].scrollHeight);
    $('.message .message-content').filter(':contains("'+ $('a[data-for=user-model]').data('username') + '")').parent().addClass('highlight');
  });
});
