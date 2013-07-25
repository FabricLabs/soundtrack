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
  
  // Initial load of the user list
  $scope.updateUserlist();
});