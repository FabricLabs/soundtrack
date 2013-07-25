app.controller('ChatController', function($rootScope, $scope, $http, socket) {
  $scope.messages = [];
  
  // Chrome, Firefox, Opera
  if (new Audio().canPlayType('audio/ogg')) {
    $scope.beep = new Audio('/media/beep.ogg');
  }
  //Safari, IE (not that we actually care about IE)
  else if (new Audio().canPlayType('audio/mpeg')) {
    $scope.beep = new Audio('/media/beep.mp3');
  }
  
  // Load chat history
  $http.get('/chat.json').success(function(data) {
    
    if (localStorage.getItem('debug')) {
      console.log('load_chat', data);
    }
    
    // Sort items
    $scope.messages = data.reverse();
    
    // Process the chat after rendering (if someone can make this use a render callback instead of a timeout, please do)
    setTimeout($scope.modifyChat, 200);
  });
  
  // Handle incomming chat
  socket.$on('chat', function(event, msg) {
    
    // Add message and alert angular to the change
    $scope.messages.push(msg.data);
    $scope.$apply();
    
    // Play mention beep if not disabled
    if (typeof(username) != 'undefined') {
      if (msg.data.message.indexOf(username) !== -1 && $rootScope.getSetting('mention')) {
        var myVolume = ytplayer.getVolume();
        if (myVolume > 0) {
          // Play beep at 1/3 distance to full volume than current playback volume
          $scope.beep.volume = (myVolume / 100) + (((100 - myVolume) / 100) / 3);
        }
        else {
          $scope.beep.volume = 0.3;
        }
        $scope.beep.play();
      }
    }
    
    // Process the chat after rendering
    setTimeout($scope.modifyChat, 50);
  });
  
  // Handle announcements
    socket.$on('announcement', function(event, msg) {
    
    // Add announcement and alert angular to the change
    $scope.messages.push(msg.data);
    $scope.$apply();
    
    setTimeout($scope.modifyChat, 200);

  });
  
  $scope.modifyChat = function() {
    // Scroll to bottom, highlight mentions
    $("#messages").scrollTop($("#messages")[0].scrollHeight);
    
    if (typeof(username) != 'undefined') {
      $('.message .message-content').filter(':contains("'+ username + '")').parent().parent().addClass('highlight');
    }
    
    // Set target unless they don't want that
    if ($rootScope.getSetting('chat_links')) {
      $('.message-content a').attr('target','_blank');
    } 
  }
  
  // Lets us render different templates for chats and announcements
  $scope.getChatTemplate = function(message) {
    // Chat message
    if (message.formatted) {
      return 'angular/chatMessage';
    }
    // Announcement
    else {
      return 'angular/chatAnnouncement';
    }
  }
});
