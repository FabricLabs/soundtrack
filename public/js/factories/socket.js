//Create a socket for use in the rest of angular
app.factory('socket', function ($rootScope, $http) {
  
  var socket = $rootScope.$new();
  var sockjs;
  var retryTimes = [1000, 5000, 10000, 30000, 60000, 120000, 300000, 600000]; //in ms
  var retryIdx = 0;
  
  function init() {
    sockjs = new SockJS('/stream');

    // Called when the socket opens a new connection to the server
    sockjs.onopen = function() {
      // If we're logged in we should authenticate our socket
      if (registered) {
        $http.post('/socket-auth', {}).success(function(data) {
          sockjs.send(JSON.stringify({type: 'auth', authData: data.authData}));
        });
      }
    }

    // Called any time the socket receives a message from the server
    sockjs.onmessage = function(e) {
      retryIdx = 0; //reset our retry timeouts

      var msg = JSON.parse(e.data);

      // Check localStorage for debug so we dont spam regular users
      if (localStorage.getItem('debug')) {
        console.log('socket_message', msg);
      }
      
      // This will emit an event of whatever type is sent in the message
      // and can be recieved via socket.$on('[type]')
      if (msg.type && typeof(msg.type) == "string") {
        socket.$emit(msg.type, msg)
      }
      else {
        console.warn("Unknown data received on socket", msg);
      }
      
      // This is a good example, this listens for messages of type 'ping'
      // and then tells the socket to send back a 'pong'
      socket.$on('ping', function(event, msg) {
        socket.send({type: 'pong'});
      });
    };

    // Called when the socket is either closed by the server or lost
    // due to connection issues, or the server restarting
    sockjs.onclose = function() { 
      console.log('Lost our connection, lets retry!');
      
      if (retryIdx < retryTimes.length) {
        console.log("Retrying connection in " + retryTimes[retryIdx] + 'ms');
        setTimeout(startSocket, retryTimes[retryIdx++]);
      }
      else {
        alert('Bummer. We lost connection.');
      }
    };
    
    // Can be called to send data to the server
    socket.send = function (data) {
      sockjs.send(JSON.stringify(data));
    };
  };
  
  window.startSocket = function() {
    sockjs = null;
    init();
  }
  
  //Basic ability to add a listener to the socket (plugins/greasemonkey)
  window.API = {
    addSocketListener : function(event_type, trigger) {
      socket.$on(event_type, trigger);
    }
  };
  
  return socket;
  
});