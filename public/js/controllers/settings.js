// This is the view controller for the settings modal dialog
app.controller('SettingsController', function($scope, settings, dialog) {

  // Define settings in the controller scope
  $scope.settings = settings;
    
  // Clicked the 'save' button in the modal
  $scope.save = function() {
    if (localStorage.getItem('debug')) {
      console.log('save_settings', $scope.settings);
    }
    
    //send settings back to main controller
    dialog.close($scope.settings);
  };
  
  // Clicked the cancel button
  $scope.dismiss = function() {
    dialog.close();
  };
  
});