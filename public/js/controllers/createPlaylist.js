// This is the view controller for the create playlist modal dialog
app.controller('CreatePlaylistController', function($scope, $http, newTrack, dialog) {

  // Define newTrack in the controller scope
  $scope.newTrack = newTrack;
  
  // Default playlist object
  $scope.playlist = {
      name: ""
    , description: ""
    , trackID: $scope.newTrack._id
  };
  
  // Clicked the 'create playlist' button in the modal
  $scope.save = function() {
    if (localStorage.getItem('debug')) {
      console.log('create_playlist', $scope.playlist);
    }
    
    //send playlist back to originating controller
    dialog.close($scope.playlist);
  };
  
  // Clicked the cancel button
  $scope.dismiss = function() {
    dialog.close();
  };
  
});
