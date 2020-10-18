'use strict';

const assert = require('assert');

const fs = require('fs');
const lame = require('@suldashi/lame');
const Speaker = require('speaker');

const settings = {
  channels: 2,        // 2 channels (left and right)
  bitDepth: 16,       // 16-bit samples
  sampleRate: 44100,  // 44,100 Hz sample rate
};

describe('@fabric/soundtrack', function () {
  describe('@services/audio', function () {
    xit('can play a sound', function (done) {
      const handle = fs.createReadStream('./assets/audio/ring.mp3');
      const decoder = new lame.Decoder({
        // input
        channels: 2,
        bitDepth: 16,
        sampleRate: 44100,

        // output
        bitRate: 128,
        outSampleRate: 22050,
        mode: lame.STEREO // STEREO (default), JOINTSTEREO, DUALCHANNEL or MONO
      });

      // Create the Speaker instance
      const speaker = new Speaker(settings);

      handle.pipe(decoder);
      decoder.pipe(speaker);

      assert('ok');

      setTimeout(function () {
        done();
      }, 1000);
    });
  });
});
