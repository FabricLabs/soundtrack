// This is for miscellaneous controls and such, don't put anything too big in here
app.controller('MainController', function($rootScope, $scope, $http, $dialog, socket) {

  // Opens the settings dialog
  $scope.openSettings = function() {
    $dialog.dialog({
      templateUrl: 'angular/settings',
      controller: 'SettingsController',
      resolve: {
        settings: function() {return $rootScope.getLocalSettings();}
      }
    }).open().then(function(settings) {
        if (settings) {
          $rootScope.setLocalSettings(settings);
        }
    });
  };
  
  // You must add any new settings here
  $rootScope.defaultSettings = {
      mention: true
    , chat_links: true
  };
  
  // This is what you should use for getting any setting in the application
  // so that it always falls back to the default value
  $rootScope.getSetting = function(setting_name) {
    if (localStorage.getItem('debugSettings')) {
      console.log('get_setting', setting_name);
    }
    
    if ($rootScope.getLocalSettings()[setting_name] !== null) {
      if (localStorage.getItem('debugSettings')) {
        console.log('get_setting_found', setting_name);
      }
      return $rootScope.getLocalSettings()[setting_name];
    }
    else {
      if (localStorage.getItem('debugSettings')) {
        console.log('get_setting_default', setting_name);
      }
      return $rootScope.defaultSettings[setting_name];
    }
  };
  
  // These are for getting/setting the whole settings object and
  // should only be modified from the settings view
  $rootScope.getLocalSettings = function() {
    var localSettings;
    if (localStorage.getItem('settings')) {
      localSettings = JSON.parse(localStorage.getItem('settings'));
      
      if (localStorage.getItem('debugSettings')) {
        console.log('settings_found', localSettings);
      }
    }
    else {
      localSettings = $rootScope.defaultSettings;
      
      if (localStorage.getItem('debugSettings')) {
        console.warn('settings_not_found:use_defaults', localSettings);
      }
    }
    return localSettings;
  }
  
  // Sets the settings object, dont use this, let the settings view take care of it
  $rootScope.setLocalSettings = function(settings) {
    if (localStorage.getItem('debugSettings')) {
      console.log('set_localsettings', settings);
    }
    localStorage.setItem('settings', JSON.stringify(settings));
  };

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