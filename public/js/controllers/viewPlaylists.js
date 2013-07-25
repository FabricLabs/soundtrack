// This is the view controller for the playlists modal dialog
app.controller('ViewPlaylistsController', function($scope, $http, playlists, playlistTracks, dialog) {

  // Add playlist and tracks to current scope
  $scope.playlists = playlists;
  $scope.playlistTracks = playlistTracks;
  
  // Select a playlist in the playlist modal
  $scope.selectPlaylist = function(playlist) {
    if (localStorage.getItem('debug')) {
      console.log('select_playlist', playlist);
    }
    $scope.playlistTracks = playlist._tracks;
  };
  
  // Add selected track to the main playlist
  $scope.addToRoomPlaylist = function(track) {
    if (localStorage.getItem('debug')) {
      console.log('add_track_to_room', track);
    }
    
    $http.post('/playlist', {
        source: 'id'
      , id: track._id
    }).success(function(response) {
      if (localStorage.getItem('debug')) {
        console.log('add_track_to_room_response', response);
      }
    });
  };
  
  // Clicked close button or x
  $scope.dismiss = function() {
    dialog.close();
  };
  
});
