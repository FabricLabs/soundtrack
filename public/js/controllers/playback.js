app.controller('PlaybackController', function($rootScope, $scope, $http, $dialog, socket) {

  // This is called when the youtube iframe is loaded
  window.onYouTubeIframeAPIReady = function() {
    ytplayer = new YT.Player('screen-inner', {
      height: '295',
      width: '100%',
      playerVars: {
        controls: 0,
        showinfo: 0,
        iv_load_policy: 3
      },
      events: {
        'onReady': $scope.onPlayerReady,
        'onStateChange': function(event) {
          if (localStorage.getItem('debug')) {
            console.log('ytplayer_state_change', event);
          }
          // Prevent pausing
          if (event.data == 2) {
            ytplayer.playVideo();
          }
        },
        'onError': function(event) {
          console.warn('ytplayer_error', event);
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
  $scope.getPlaylists = function() {
    if (localStorage.getItem('debug')) {
      console.log('get playlists');
    }
    
    $http.get('/' + $scope.userSlug + '/playlists').success(function(data) {
      if (data && data.status && data.status == 'success') {
        $scope.playlists = data.results.playlists;
      }
      else {
        console.warn('unable to get playlists');
      }
    });
  };
  
  // Adds the current track to a selected playlist
  $scope.addToPlaylist = function(playlist, track) {
    $http.post('/' + $('a[data-for=user-model]').data('username') +'/playlists/' + playlist._id, {
      trackID: track._id
    }).success(function(data) {
      console.log(data);
      $scope.getPlaylists();
    });
  };
  
  // Opens the playlists dialog
  $scope.openPlaylists = function() {
    $dialog.dialog({
      templateUrl: 'angular/playlists',
      controller: 'PlaylistController',
      resolve: { playlists: function() { return $scope.playlists;}, playlistTracks: function() { return $scope.playlists[0]._tracks}}
    }).open();
  };
  
  
  // These update our data on first load
  $scope.updatePlaylist();
  if (registered) {
    $scope.getPlaylists();
  }
  
});
