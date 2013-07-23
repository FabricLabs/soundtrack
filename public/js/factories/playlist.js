app.factory('PlaylistDialog', function($dialog){
  return function(playlists) {    
    return $dialog.dialog({
      templateUrl: 'angular/playlists',
      controller: 'PlaylistController',
      resolve: {playlists: function() {
        return playlists;
      }}
    });
  };
});