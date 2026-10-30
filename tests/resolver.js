'use strict';

const assert = require('assert');
const Resolver = require('../services/resolver');

function runner (outputs) {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args]);
    const output = outputs.shift();
    if (output instanceof Error) throw output;
    return typeof output === 'string' ? output : JSON.stringify(output);
  };
  run.calls = calls;
  return run;
}

describe('Resolver', function () {
  it('searches YouTube through yt-dlp, after `--`', async function () {
    const run = runner([{ entries: [{ id: 'dQw4w9WgXcQ', webpage_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', title: 'Never Gonna Give You Up', uploader: 'Rick Astley', duration: 213, thumbnail: 'https://i.ytimg.com/x.jpg' }] }]);
    const found = await new Resolver({ run }).lookup('-rick astley');
    assert.deepStrictEqual(run.calls[0], ['yt-dlp', '-J', '--no-playlist', '--no-warnings', '--', 'ytsearch1:-rick astley']);
    assert.deepStrictEqual(found, {
      source: { type: 'youtube', id: 'dQw4w9WgXcQ', uri: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      title: 'Never Gonna Give You Up',
      artist: 'Rick Astley',
      duration: 213,
      thumbnail: 'https://i.ytimg.com/x.jpg',
      live: false
    });
  });

  it('looks up links by their canonical URL and reports live streams', async function () {
    const run = runner([{ title: 'Radio', is_live: true, channel: 'Station' }]);
    const found = await new Resolver({ run }).lookup('https://youtu.be/aaaaaaaaaaa');
    assert.strictEqual(run.calls[0][5], 'https://www.youtube.com/watch?v=aaaaaaaaaaa');
    assert.strictEqual(found.live, true);
    assert.strictEqual(found.duration, null);
    assert.strictEqual(found.artist, 'Station');
  });

  it('probes audio files with ffprobe, and falls back to yt-dlp', async function () {
    const run = runner([{ format: { duration: '61.5', tags: { title: 'Tagged' } } }]);
    const found = await new Resolver({ run }).lookup('https://cdn.example.com/My%20Song.mp3');
    assert.strictEqual(run.calls[0][0], 'ffprobe');
    assert.deepStrictEqual([found.title, found.duration, found.source.type], ['Tagged', 61.5, 'direct']);

    const fallback = runner([new Error('probe failed'), { title: 'From yt-dlp', duration: 30 }]);
    const again = await new Resolver({ run: fallback }).lookup('https://cdn.example.com/a.mp3');
    assert.strictEqual(fallback.calls[1][0], 'yt-dlp');
    assert.strictEqual(again.title, 'From yt-dlp');
  });

  it('refuses unsafe links before running anything', async function () {
    const run = runner([]);
    await assert.rejects(new Resolver({ run }).lookup('file:///etc/passwd'), /Only http and https/);
    await assert.rejects(new Resolver({ run }).lookup('http://127.0.0.1:8080/a.mp3'), /private hosts/);
    assert.strictEqual(run.calls.length, 0);
  });

  it('asks for the playable URL and headers at play time', async function () {
    const run = runner([{ url: 'https://rr1.googlevideo.com/x', http_headers: { 'User-Agent': 'ua' } }]);
    const resolver = new Resolver({ run });
    const stream = await resolver.stream({ source: { type: 'youtube', id: 'aaaaaaaaaaa', uri: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' } });
    assert.deepStrictEqual(run.calls[0], ['yt-dlp', '-j', '--no-playlist', '--no-warnings', '-f', 'bestaudio/best', '--', 'https://www.youtube.com/watch?v=aaaaaaaaaaa']);
    assert.deepStrictEqual(stream, { url: 'https://rr1.googlevideo.com/x', headers: { 'User-Agent': 'ua' } });
    assert.deepStrictEqual(await resolver.stream({ source: { type: 'direct', uri: 'https://cdn.example.com/a.mp3' } }), { url: 'https://cdn.example.com/a.mp3', headers: {} });
  });

  it('says when yt-dlp is missing', async function () {
    const resolver = new Resolver({ ytdlp: '/nonexistent/yt-dlp' });
    await assert.rejects(resolver.lookup('anything'), /yt-dlp not found/);
  });
});
