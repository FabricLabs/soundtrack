process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
process.env.FFMPEG_BIN_PATH = 'ffpeg';

var Transcoder = require('stream-transcoder');

var WebSocket = require('ws');
var client = new WebSocket('wss://coding.soundtrack.io/stream/websocket');

var SOURCE_TIMEOUT = 5000;
var LISTEN_PORT = 8888;

client.on('open', function() {
  var ytdl = require('ytdl-core');
  var rest = require('follow-redirects').https;
  var cast = require('icecast');
  var Pass = require('stream').PassThrough;
  var Null = require('stream').Writable;
  var out = new Null();
  out._write = function (chunk, encoding, done) {
    done(); // Don't do anything with the data
  };

  var input = new Pass();
  var audio = new Pass();


  var trans = new Transcoder( input )
    .audioCodec('mp3')
    .sampleRate(44100)
    .channels(2)
    .audioBitrate(128 * 1000)
    .format('mp3').stream();

  trans.pipe( audio );


  var http = require('http');
  var server = http.createServer(function(req, res) {
    audio.pipe( res );
  }).listen( LISTEN_PORT );

  client.on('message', function(message) {

    try {
      var message = JSON.parse(message);
    } catch(e) {
      var message = {};
    }

  switch(message.type) {
      default: console.log('unhandled message type', message.type); break;
      case 'ping':
        console.log('server pinged. playing pong.');
        client.send('{"type": "pong"}');
      break;
      case 'track':
        console.log('track!');

        audio.unpipe();
        input.pipe( out );

        var sources = [];
        // TODO: fix the server – there's no reason this should be a map
        ['soundcloud', 'youtube'].forEach(function(source) {
          message.data.sources[ source ].forEach(function( item ) {
            switch (source) {
              case 'soundcloud':
                var src = { source: 'soundcloud', url: 'https://api.soundcloud.com/tracks/' + item.id + '/stream?client_id=7fbc3f4099d3390415d4c95f16f639ae' };
              break;
              case 'youtube':
                var src = { source: 'youtube', url: 'https://www.youtube.com/watch?v=' + item.id };
              break;
            }

            sources.push( src );
          });
        });

        console.log('sources', sources);

        var stopSearching = function( data ) {
          console.log('stopping search!', data && data.length );
          streaming = true;
          clearInterval( tester );
        };

        var handleError = function(err) {
          console.log(err);
        };

        var streaming = false;
        var i = 0;
        var tester = setInterval(function() {
          if (streaming) return;

          console.log('trying', i );

          var source = sources[ i ]; i++;
          if (!source) return stopSearching();

          switch (source.source) {
            case 'youtube':
              ytdl( source.url , {
                filter: function(format) {
                  console.log("source:url:" + source.url);
                  return (format.container === 'webm');
                }
              }).once('data', stopSearching ).on('error', handleError ).pipe( input , { end: false } );
            break;
            case 'soundcloud':
              rest.get( source.url , function(response) {
                response.once('data', stopSearching );
                response.on('error', handleError );
                response.pipe( input , { end: false } );
              });
            break;
          }

        }, SOURCE_TIMEOUT );

      break;
    }
  });

});

/*
var request = http.get( url , function(response) {
  response.pipe( process.stdout );
});

var lame = require('lame');
var http = require('follow-redirects').https;
var ytdl = require('ytdl-core');

var url = 'https://api.soundcloud.com/tracks/159612496/stream?client_id=7fbc3f4099d3390415d4c95f16f639ae';

var youtubeRTSP = 'https://r6---sn-o097zuer.c.youtube.com/CiILENy73wIaGQmIIBPFh7yBvxMYDSANFEgGUgZ2aWRlb3MM/0/0/0/video.3gp';
var youtubeURL = 'https://www.youtube.com/watch?v=61pw9JsHtrI';

var encoder = new lame.Encoder({
  channels: 2,        // 2 channels (left and right)
  bitDepth: 16,       // 16-bit samples
  sampleRate: 44100   // 44,100 Hz sample rate
});

var decoder = new lame.Decoder();
decoder.on('format', function(data) {
  console.log('format' , data);
});

ytdl( youtubeURL , {
  filter: function(format) {
    console.log(format);
    return (format.audioEncoding === 'mp3');
  }
}).pipe( process.stdout );


var audio = singleton;
req.on('open', function() {
  audio.pipe( res );
});
*/

// END YOUTUBE

// START SOUNDCLOUD

/*/
var request = http.get( url , function(response) {

  response.pipe( process.stdout );

  //response.pipe( decoder )
  //decoder.pipe( process.stdout );

  //response.pipe( encoder );
  //encoder.pipe( process.stdout );
});
/**/
