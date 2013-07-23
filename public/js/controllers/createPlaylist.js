app.controller('CreatePlaylistController', function($scope, $http, newTrack, dialog) {

  $scope.newTrack = newTrack;
  
  $scope.playlist = {
      name: ""
    , description: ""
    , trackID: $scope.newTrack._id
  };
  
  console.log($scope.playlist);
  
  $scope.save = function() {
    dialog.close($scope.playlist);
  };
  
  $scope.dismiss = function() {
    dialog.close();
  };
  
});
