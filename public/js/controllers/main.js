// This is for miscellaneous controls and such, don't put anything too big in here
app.controller('MainController', function($rootScope, $scope, $http, $dialog, socket) {

  // Gets the current user's playlists
  $scope.getPlaylists = function() {
    if (localStorage.getItem('debug')) {
      console.log('get_user_playlists');
    }
        
    $http.get('/' + userSlug + '/playlists').success(function(data) {
      if (data && data.status && data.status == 'success') {
        $scope.playlists = data.results.playlists;
      }
      else {
        console.warn('get_user_playlists_error', data);
      }
    }).error(function(data) {
      console.warn('get_user_playlists_error', data);
    });
  };
  
  // Adds the current track to a selected playlist
  $scope.addToPlaylist = function(playlist, track) {
    $http.post('/' + username +'/playlists/' + playlist._id, {
      trackID: track._id
    }).success(function(data) {
      if (localStorage.getItem('debug')) {
        console.log('update_user_playlist', data);
      }
      $scope.getPlaylists();
    });
  };
  
  // Opens the playlists dialog
  $scope.openPlaylists = function() {
    $dialog.dialog({
      templateUrl: 'angular/playlists',
      controller: 'ViewPlaylistsController',
      resolve: { 
          playlists: function() { 
            if (typeof($scope.playlists) != 'undefined') {
              return $scope.playlists;
            }
            else {
              return [];
            }
          }
        , playlistTracks: function() { 
            if (typeof($scope.playlists) != 'undefined') {
              return $scope.playlists[0]._tracks;
            }
            else {
              return [];
            }
          }
      }
    }).open();
  };
  
  // Opens the create playlist dialog
  $scope.createPlaylist = function() {
    $dialog.dialog({
      templateUrl: 'angular/createPlaylist',
      controller: 'CreatePlaylistController',
      resolve: { newTrack: function() { return $rootScope.track}}
    }).open().then(function(result) {
        if (result) {
          $http.post("/" + username + "/playlists", {
              name:        result.name
            , description: result.description
            , trackID:     result.trackID
          }).success(function(data) {
            if (localStorage.getItem('debug')) {
              console.log('create_playlist', data);
            }
            $scope.getPlaylists();
          });
        }
    });
  };
  
  // Gets playlist if logged in
  if (registered) {
    $scope.getPlaylists();
  }

});