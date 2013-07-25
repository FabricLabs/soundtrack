app.controller('ChatController', function($scope, $http, socket) {
  $scope.messages = [];
  $scope.beep = new Audio('/media/beep.ogg');
  
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
    if (msg.data.message.indexOf(username) !== -1 && !$.cookie('noMention')) {
      $scope.beep.play();
    }
  });
  
  $scope.modifyChat = function() {
    // Scroll to bottom, highlight mentions
    $("#messages").scrollTop($("#messages")[0].scrollHeight);
    $('.message .message-content').filter(':contains("'+ username + '")').parent().parent().addClass('highlight');
    
    // Set target unless they don't want that
    if (!$.cookie('noNewTab')) {
      $('.message-content a').attr('target','_blank');
    } 
  }
});
