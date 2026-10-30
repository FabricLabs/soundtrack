'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const Soundtrack = require('../services/soundtrack');
const LastFM = require('../services/lastfm');
const { parseTrack, signature, scrobbles } = require('../functions/scrobble');
const { fakeResolver, fakeClock, until, tempDir, CATALOG } = require('./helpers');

const alice = { id: 'fabric:' + 'a'.repeat(64), name: 'Alice' };
const bob = { id: 'discord:2', name: 'Bob' };

describe('Last.fm', function () {
  it('reads artist and title from what a video is called', function () {
    assert.deepStrictEqual(parseTrack({ title: 'Daft Punk - Around the World (Official Video)' }), { artist: 'Daft Punk', track: 'Around the World' });
    assert.deepStrictEqual(parseTrack({ title: 'Boards of Canada – Roygbiv [HD]' }), { artist: 'Boards of Canada', track: 'Roygbiv' });
    assert.deepStrictEqual(parseTrack({ title: 'A - B - C' }), { artist: 'A', track: 'B - C' });
    assert.deepStrictEqual(parseTrack({ title: 'Windowlicker (Remastered 2019)', artist: 'Aphex Twin - Topic' }), { artist: 'Aphex Twin', track: 'Windowlicker' });
    assert.deepStrictEqual(parseTrack({ title: 'Hello', artist: 'AdeleVEVO' }), { artist: 'Adele', track: 'Hello' });
    assert.strictEqual(parseTrack({ title: 'untitled' }), null);
    assert.strictEqual(parseTrack({ title: '(Official Video)' }), null);
  });

  it('signs calls the way Last.fm checks them', function () {
    const md5 = (text) => crypto.createHash('md5').update(text).digest('hex');
    assert.strictEqual(signature({ b: '2', a: '1', format: 'json', callback: 'x' }, 's'), md5('a1b2s'));
    assert.strictEqual(signature({ a: '1', b: null }, 's'), md5('a1s'));
  });

  it('scrobbles a track over 30 s once half of it, or 4 minutes, was heard', function () {
    assert.strictEqual(scrobbles(30, 30), false);
    assert.strictEqual(scrobbles(60, 29), false);
    assert.strictEqual(scrobbles(60, 30), true);
    assert.strictEqual(scrobbles(3600, 239), false);
    assert.strictEqual(scrobbles(3600, 240), true);
    assert.strictEqual(scrobbles(null, 1000), false);
  });

  describe('service', function () {
    let dir;
    let clock;
    let soundtrack;
    let lastfm;
    let calls;
    let present;
    let refuse;

    async function fakeFetch (url, options = {}) {
      const params = Object.fromEntries(options.method === 'POST' ? new URLSearchParams(options.body) : new URL(url).searchParams);
      calls.push(params);
      const reply = (status, body) => ({ ok: status === 200, status, json: async () => body });
      if (refuse) return reply(403, { error: 4, message: 'Unauthorized Token' });
      if (params.method === 'auth.getSession') return reply(200, { session: { name: `fm_${params.token.slice(0, 5)}`, key: `sk-${params.token}` } });
      return reply(200, {});
    }

    const sent = (method) => calls.filter((call) => call.method === method);

    beforeEach(async function () {
      dir = tempDir('lastfm');
      clock = fakeClock();
      calls = [];
      present = [];
      refuse = false;
      soundtrack = new Soundtrack({
        path: dir,
        resolver: fakeResolver(CATALOG),
        now: clock.now,
        setTimeout: clock.setTimeout,
        clearTimeout: clock.clearTimeout,
        autoplay: { enabled: false }
      });
      await soundtrack.start();
      lastfm = new LastFM({ soundtrack, apiKey: 'key', apiSecret: 'secret', present: () => present, fetch: fakeFetch, now: clock.now }).start();
    });

    afterEach(async function () {
      lastfm.stop();
      await soundtrack.stop();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('is off without a key and secret', function () {
      assert.strictEqual(new LastFM({ soundtrack, apiKey: 'key' }).enabled, false);
      assert.strictEqual(lastfm.enabled, true);
      const url = new URL(lastfm.authorizeUrl('https://soundtrack.example/cb'));
      assert.strictEqual(url.origin + url.pathname, 'https://www.last.fm/api/auth/');
      assert.strictEqual(url.searchParams.get('api_key'), 'key');
      assert.strictEqual(url.searchParams.get('cb'), 'https://soundtrack.example/cb');
    });

    it('links an account with a signed session request, and unlinks it', async function () {
      await assert.rejects(lastfm.link(alice.id, 'no'), (error) => error.status === 400);
      assert.deepStrictEqual(await lastfm.link(alice.id, 'alicetoken'), { name: 'fm_alice' });
      const [call] = sent('auth.getSession');
      assert.strictEqual(call.token, 'alicetoken');
      assert.strictEqual(call.api_key, 'key');
      assert.strictEqual(call.format, 'json');
      const { api_sig: sig, format, ...signed } = call;
      assert.strictEqual(sig, signature(signed, 'secret'));
      assert.deepStrictEqual(await lastfm.linked(alice.id), { name: 'fm_alice' });
      assert.strictEqual(await lastfm.linked(bob.id), null);

      refuse = true;
      await assert.rejects(lastfm.link(bob.id, 'bobtokenxx'), (error) => error.status === 502);
      assert.strictEqual(await lastfm.linked(bob.id), null);

      await lastfm.unlink(alice.id);
      assert.strictEqual(await lastfm.linked(alice.id), null);
    });

    it('shows now playing and scrobbles for linked listeners who heard enough', async function () {
      await lastfm.link(alice.id, 'alicetoken');
      await lastfm.link(bob.id, 'bobtokenxx');
      present = [alice.id];

      await soundtrack.enqueue('lobby', 'song a', alice);
      await until(() => sent('track.updateNowPlaying').length === 1);
      const now = sent('track.updateNowPlaying')[0];
      assert.deepStrictEqual([now.artist, now.track, now.duration, now.sk], ['Artist A', 'Song A', '60', 'sk-alicetoken']);
      const startedAt = clock.now();

      // Bob opens the room partway through: he didn't hear it from the start.
      present = [alice.id, bob.id];
      await clock.advance(61 * 1000);
      await until(() => sent('track.scrobble').length === 1);
      const scrobble = sent('track.scrobble')[0];
      assert.deepStrictEqual([scrobble.artist, scrobble.track, scrobble.timestamp, scrobble.sk], ['Artist A', 'Song A', String(Math.floor(startedAt / 1000)), 'sk-alicetoken']);

      // Skipped after 10 s: too little heard to count.
      await soundtrack.enqueue('lobby', 'song a', bob);
      await until(() => sent('track.updateNowPlaying').length === 3);
      await clock.advance(10 * 1000);
      await soundtrack.skip('lobby', bob);

      // No artist to credit: nothing is sent.
      await soundtrack.enqueue('lobby', 'song b', bob);
      await clock.advance(91 * 1000);
      await new Promise((resolve) => setImmediate(resolve));
      assert.strictEqual(sent('track.updateNowPlaying').length, 3);
      assert.strictEqual(sent('track.scrobble').length, 1);
    });
  });
});
