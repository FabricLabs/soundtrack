'use strict';

const assert = require('assert');
const { parseSource, sourceKey, isPrivateHost } = require('../functions/sourceUri');
const { trackId } = require('../functions/trackId');

describe('sourceUri', function () {
  it('reads every YouTube link shape as one video', function () {
    const links = [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=x',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ'
    ];
    for (const link of links) {
      assert.deepStrictEqual(parseSource(link), { type: 'youtube', id: 'dQw4w9WgXcQ', uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, link);
    }
  });

  it('reads SoundCloud tracks and refuses profiles and sets', function () {
    assert.deepStrictEqual(parseSource('https://soundcloud.com/Artist/Some-Track?in=x'), {
      type: 'soundcloud', id: 'artist/some-track', uri: 'https://soundcloud.com/artist/some-track'
    });
    assert.throws(() => parseSource('https://soundcloud.com/artist'), /single SoundCloud track/);
    assert.throws(() => parseSource('https://soundcloud.com/artist/sets/mix'), /single SoundCloud track/);
  });

  it('tells audio files from other pages, without the fragment', function () {
    assert.deepStrictEqual(parseSource('https://cdn.example.com/a/song.mp3#x'), {
      type: 'direct', id: 'https://cdn.example.com/a/song.mp3', uri: 'https://cdn.example.com/a/song.mp3'
    });
    assert.strictEqual(parseSource('https://bandcamp.example/track/x').type, 'link');
  });

  it('treats text without a scheme as a search', function () {
    assert.strictEqual(parseSource('daft punk around the world'), null);
    assert.strictEqual(parseSource('youtube.com/watch?v=dQw4w9WgXcQ'), null);
    assert.throws(() => parseSource('   '), /Nothing to play/);
  });

  it('refuses other schemes, credentials, and private hosts', function () {
    assert.throws(() => parseSource('file:///etc/passwd'), /Only http and https/);
    assert.throws(() => parseSource('ftp://example.com/a.mp3'), /Only http and https/);
    assert.throws(() => parseSource('https://user:pass@example.com/a.mp3'), /username or password/);
    for (const host of ['localhost', '127.0.0.1', '10.1.2.3', '192.168.1.5', '172.20.0.1', '169.254.169.254', '[::1]', 'printer.local']) {
      assert.throws(() => parseSource(`http://${host}/a.mp3`), /private hosts/, host);
    }
    assert.strictEqual(isPrivateHost('8.8.8.8'), false);
    assert.strictEqual(isPrivateHost('example.com'), false);
  });

  it('keys tracks by source, the same however they were linked', function () {
    const a = parseSource('https://youtu.be/dQw4w9WgXcQ');
    const b = parseSource('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    assert.strictEqual(sourceKey(a), 'youtube:dQw4w9WgXcQ');
    assert.strictEqual(trackId(a), trackId(b));
    assert.match(trackId(a), /^[0-9a-f]{64}$/);
  });
});
