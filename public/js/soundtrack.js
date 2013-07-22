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
      $http.post('/socket-auth', {}).success(function(data) {
        sockjs.send(JSON.stringify({type: 'auth', authData: data.authData}));
      });
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

app.controller('PlaylistController', function($scope, $http, $modal, socket) {

  window.onYouTubeIframeAPIReady = function() {
    ytplayer = new YT.Player('screen-one', {
      height: '295',
      width: '570',
      playerVars: {
        controls: 0,
        showinfo: 0
      },
      events: {
        'onReady': $scope.onPlayerReady
      }
    });
  };
  
  $scope.onPlayerReady = function(event) {
  
    startSocket();
    ytplayer.setPlaybackQuality('medium');
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
    
  $scope.updatePlaylist = function(){
    console.log('get playlist');
    $http.get('/playlist.json').success(function(data){
      $scope.tracks = data;
    });
  };
  
  socket.$on('track', function(event, msg) {
    // console.log('track event fired with data', data);
    ytplayer.cueVideoById( msg.data.sources.youtube[0].id );
    ytplayer.seekTo( msg.seekTo );
    ytplayer.playVideo();
    
    $scope.track = {
        id: msg.data._id
      , title: msg.data.title
    };
    
    if (msg.data.slug) {
      $scope.track.slug = msg.data.slug;
    }
    else {
      $scope.track.slug = "";
    }
    
    if (msg.data._artist) {
      $scope.track.artist = msg.data._artist
    }
    
    if (msg.data.curator) {
      $scope.track.curator = msg.data.curator;
    } else {
      $scope.track.curator = {
          username: "the machine"
        , slug: ""
      };
    }
    
    $scope.updatePlaylist();
  });
    
  socket.$on('playlist:add', $scope.updatePlaylist);
  socket.$on('playlist:update', $scope.updatePlaylist);
  
  window.getPlaylists = function() {
    console.log('get playlists');
    $http.get('/' + $scope.userSlug + '/playlists').success(function(data) {
      if (data && data.status && data.status == 'success') {
        $scope.playlists = data.results.playlists;
        console.log($scope.playlists);
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
  getPlaylists();
});

app.controller('UsersController', function($scope, $http, socket) {
  
  $scope.updateUserlist = function(){
    $http.get('/listeners.json').success(function(data){
      $scope.users = data;
    });
  }
  
  socket.$on('join', $scope.updateUserlist);
  
  $scope.$watch('users', function() {
    console.log('users changed');
  });
  
  socket.$on('part', function(event, msg) {
    for(var index = 0; index < $scope.users.length; index++) {
      if ($scope.users[index].id == msg.data.id) {
        $scope.users.splice(index, 1);
        break;
      }
      else {
        console.log(user, msg.data.id);
      }
    };
    $scope.$digest();
  });
  
  $scope.updateUserlist();
});

app.controller('ChatController', function($scope, socket) {
  
});
