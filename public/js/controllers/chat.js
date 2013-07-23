app.controller('ChatController', function($scope, socket) {
  socket.$on('chat', function(event, msg) {
    $( msg.data.formatted ).appendTo('#messages');
    $("#messages").scrollTop($("#messages")[0].scrollHeight);
    $('.message .message-content').filter(':contains("'+ $('a[data-for=user-model]').data('username') + '")').parent().addClass('highlight');
  });
});
