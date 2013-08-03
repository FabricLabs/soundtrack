app.controller('ChatController', function($rootScope, $scope, $http, socket) {
    
  // Handle incomming chat
  socket.$on('chat', function(event, msg) {
    
    // Add message and alert angular to the change
    $scope.messages.push(msg.data);
    $scope.$apply();
    
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
    console.log('modify');
    // Scroll to bottom, highlight mentions
    $("#messages").scrollTop($("#messages")[0].scrollHeight);
    
    // Highlight mention
    if (typeof(username) != 'undefined') {
      $('.message .message-content').filter(':contains("'+ username + '")').parent().parent().addClass('highlight');
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
  
  // Use data from window
  $scope.messages = window.chats.reverse();
  setTimeout($scope.modifyChat, 400);
});
