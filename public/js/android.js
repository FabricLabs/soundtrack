var sockjs = null;
var retryTimes = [1000, 5000, 10000, 30000, 60000]; //in ms
var retryIdx = 0;

var startSockJs = function(){
  sockjs = new SockJS('/stream');

  sockjs.onopen = function(){
    //sockjs connection has been opened!
    $.post('/socket-auth', {}, function(data){
      sockjs.send(JSON.stringify({type: 'auth', authData: data.authData}));
    });
  }

  sockjs.onmessage = function(e) {
    retryIdx = 0; //reset our retry timeouts

    var msg = JSON.parse(e.data);

    console.log(e.data);

    switch (msg.type) {
      default: console.log('unhandled message: ' + msg); break;
      case 'track':
        $('#track-title').html(msg.data.title);
        if (msg.data.curator) {
          $('#track-curator').html(msg.data.curator.username);
        }
        else {
          $('#track-curator').html('the machine');
        }
        
        console.log('track set to: ' + msg.data.sources.youtube[0].id + ' at: ' + msg.seekTo);
        android.startTrack(msg.data.sources.youtube[0].id, msg.seekTo * 1000);
      break;
      case 'ping':
        sockjs.send(JSON.stringify({type: 'pong'}));
        console.log("Ping Pong\'d");
      break;
    }
  };

  sockjs.onclose   = function() { 
    console.log('Lost our connection, lets retry!');
    if (retryIdx < retryTimes.length) {
      console.log("Retrying connection in " + retryTimes[retryIdx] + 'ms');
      setTimeout(restartSockJs, retryTimes[retryIdx++]);
    } else {
      alert('Bummer. We lost connection.');
    }
  };
}

var restartSockJs = function(){
  sockjs = null;
  startSockJs();
}

restartSockJs();
