app.controller('PlaylistController', function($scope, $http, playlists, playlistTracks, dialog) {

  $scope.playlists = playlists;
  $scope.playlistTracks = playlistTracks;
  
  // Select a playlist in the playlist modal
  $scope.selectPlaylist = function(playlist) {
    $scope.playlistTracks = playlist._tracks;
  };
  
  $scope.addToRoomPlaylist = function(track) {
    console.log('add to room');
    $http.post('/playlist', {
        source: 'id'
      , id: track._id
    }).success(function(response) {
      console.log(response);
    });
  };
  
  $scope.dismiss = function() {
    dialog.close();
  };
  
});