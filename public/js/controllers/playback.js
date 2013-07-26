// This controller handles the youtube player and other track related things
app.controller('PlaybackController', function($rootScope, $scope, $http, socket) {

  // This is called when the youtube player is loaded
  window.onYouTubePlayerReady = function() {
    ytplayer = document.getElementById("ytPlayer");
    ytPlayer.addEventListener('onStateChange', 'onPlayerStateChange');
    ytPlayer.addEventListener("onError", "onPlayerError");
    $scope.onPlayerReady();
  };
  
  // Handles state change events from youtube player
  window.onPlayerStateChange = function(event) {
    if (localStorage.getItem('debug')) {
      console.log('ytplayer_state_change', event);
    }
  };
  
  // Handles error events from youtube player
  window.onPlayerError = function(event) {
    if (localStorage.getItem('debug')) {
      console.warn('ytplayer_error', event);
    }
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
    ytplayer.cueVideoById( msg.data.sources.youtube[0].id, msg.seekTo);
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
    
    // Animate the playlist to remove the top track
    if ($('#playlist-list li:first').data('track-id') == msg.data._id) {
      $('#playlist-list li:first').slideUp('slow', function() {
        $('#playlist-list li:first').attr('style', 'display: none;');
        $scope.updatePlaylist();
      });
    } else {
      $scope.updatePlaylist();
    }
    
  });
  
  // Handle playlist change events
  socket.$on('playlist:add', $scope.updatePlaylist);
  socket.$on('playlist:update', $scope.updatePlaylist);
  
  // These update our data on first load
  $scope.updatePlaylist();
  
});
