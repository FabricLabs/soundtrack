'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const Key = require('@fabric/core/types/key');
const passportCore = require('@fabric/core/functions/passport');
const Soundtrack = require('../services/soundtrack');
const SoundtrackWeb = require('../services/web');
const { fakeResolver, until, tempDir, CATALOG } = require('./helpers');

// A raw request, for headers fetch won't send (Host).
function raw (port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host: '127.0.0.1',
      port,
      path,
      method,
      headers: Object.assign(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}, headers)
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, json: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function cookieFrom (setCookie, name) {
  const line = [].concat(setCookie || []).find((cookie) => cookie.startsWith(`${name}=`));
  return line ? line.split(';')[0] : null;
}

describe('Soundtrack web API', function () {
  let dir;
  let soundtrack;
  let web;
  let server;
  let base;
  let port;

  beforeEach(async function () {
    dir = tempDir('web');
    soundtrack = new Soundtrack({ path: dir, resolver: fakeResolver(CATALOG) });
    await soundtrack.start();
    server = http.createServer((req, res) => web.middleware()(req, res, () => { res.statusCode = 418; res.end(); }));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
    base = `http://127.0.0.1:${port}`;
    web = new SoundtrackWeb({ soundtrack, siteUrl: base, production: false });
    web.start();
  });

  afterEach(async function () {
    web.stop();
    await new Promise((resolve) => server.close(resolve));
    await soundtrack.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function json (cookie, method, body) {
    return {
      method,
      headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
      body: body === undefined ? undefined : JSON.stringify(body)
    };
  }

  async function startPassport () {
    const res = await fetch(`${base}/services/soundtrack/passport/challenges`, json(null, 'POST', {}));
    assert.strictEqual(res.status, 200);
    const binding = res.headers.getSetCookie().find((cookie) => cookie.startsWith('soundtrack.passport='));
    assert.match(binding, /Path=\/services\/soundtrack\/passport; HttpOnly; SameSite=Strict/);
    const body = await res.json();
    const read = passportCore.readChallenge(body.challenge);
    assert.ok(read.ok, read.error);
    return { uri: body.challenge, origin: read.challenge.origin, cookie: binding.split(';')[0] };
  }

  // What Passport answers: an assertion for the challenge, signed by `key`.
  function sign (started, key, origin = started.origin) {
    return passportCore.signAssertion({ origin, challenge: started.uri, signer: 'passport', network: 'mainnet' }, key).uri;
  }

  function claim (assertion, cookie) {
    return fetch(`${base}/services/soundtrack/passport`, json(cookie, 'POST', { assertion }));
  }

  async function signIn (key = new Key(), name = 'Alice') {
    const started = await startPassport();
    const res = await claim(sign(started, key), started.cookie);
    assert.strictEqual(res.status, 200);
    const cookie = cookieFrom(res.headers.getSetCookie(), 'soundtrack.session');
    assert.ok(cookie);
    if (name) {
      const renamed = await fetch(`${base}/services/soundtrack/session`, json(cookie, 'PATCH', { name }));
      assert.strictEqual(renamed.status, 200);
    }
    return cookie;
  }

  it('serves rooms and passes other paths along', async function () {
    const list = await (await fetch(`${base}/services/soundtrack`)).json();
    assert.deepStrictEqual(list.rooms.map((room) => room.slug), ['lobby']);
    assert.strictEqual((await fetch(`${base}/elsewhere`)).status, 418);
    assert.strictEqual((await fetch(`${base}/services/soundtrack/rooms/nope`)).status, 404);
    const session = await (await fetch(`${base}/services/soundtrack/session`)).json();
    assert.deepStrictEqual(session, { user: null, passport: true, lastfm: null });
    assert.strictEqual((await fetch(`${base}/services/soundtrack/login`)).status, 404, 'no Discord sign-in');
  });

  it('signs in with Passport and keeps writes to signed-in people', async function () {
    assert.strictEqual((await fetch(`${base}/services/soundtrack/rooms/lobby/queue`, json(null, 'POST', { song: 'song a' }))).status, 401);
    const key = new Key();
    const xonly = key.pubkey.slice(2);
    const started = await startPassport();
    assert.strictEqual(started.origin, base);
    const signedIn = await claim(sign(started, key), started.cookie);
    const first = await signedIn.json();
    assert.deepStrictEqual(first, { user: { id: `fabric:${xonly}`, name: `Listener ${xonly.slice(0, 6)}` }, named: false });
    const cookie = cookieFrom(signedIn.headers.getSetCookie(), 'soundtrack.session');
    assert.ok(signedIn.headers.getSetCookie().some((line) => /^soundtrack\.passport=;.*Max-Age=0/.test(line)), 'the binding is cleared');

    const renamed = await (await fetch(`${base}/services/soundtrack/session`, json(cookie, 'PATCH', { name: '  Alice\n\u0007 ' }))).json();
    assert.strictEqual(renamed.user.name, 'Alice');
    const session = await (await fetch(`${base}/services/soundtrack/session`, { headers: { Cookie: cookie } })).json();
    assert.deepStrictEqual(session.user, { id: `fabric:${xonly}`, name: 'Alice', person: soundtrack.personId(`fabric:${xonly}`) });
    assert.strictEqual((await fetch(`${base}/services/soundtrack/session`, json(cookie, 'PATCH', { name: ' ' }))).status, 400);

    // The same key signing in again is the same person, with the name kept.
    const again = await startPassport();
    const back = await (await claim(sign(again, key), again.cookie)).json();
    assert.deepStrictEqual(back, { user: { id: `fabric:${xonly}`, name: 'Alice' }, named: true });

    const added = await fetch(`${base}/services/soundtrack/rooms/lobby/queue`, json(cookie, 'POST', { song: 'song a' }));
    assert.strictEqual(added.status, 201);
    const second = await (await fetch(`${base}/services/soundtrack/rooms/lobby/queue`, json(cookie, 'POST', { song: 'song b' }))).json();
    const voted = await (await fetch(`${base}/services/soundtrack/rooms/lobby/queue/${second.id}/votes`, json(cookie, 'POST', { vote: -1 }))).json();
    assert.strictEqual(voted.score, -1);

    const room = await (await fetch(`${base}/services/soundtrack/rooms/lobby`, { headers: { Cookie: cookie } })).json();
    assert.strictEqual(room.current.track.title, 'Song A');
    assert.strictEqual(room.current.curator, 'Alice');
    assert.strictEqual(room.current.mine, true);
    assert.strictEqual(room.queue[0].yours, -1);
    assert.ok(!JSON.stringify(room).includes(xonly), 'room views carry names, not keys');

    const removed = await fetch(`${base}/services/soundtrack/rooms/lobby/queue/${second.id}`, { method: 'DELETE', headers: { Cookie: cookie } });
    assert.strictEqual(removed.status, 200);
    const skipped = await (await fetch(`${base}/services/soundtrack/rooms/lobby/skip`, json(cookie, 'POST', {}))).json();
    assert.strictEqual(skipped.next, null);

    const made = await (await fetch(`${base}/services/soundtrack/rooms`, json(cookie, 'POST', { name: 'Chill' }))).json();
    assert.strictEqual(made.slug, 'chill');

    const out = await fetch(`${base}/services/soundtrack/logout`, json(cookie, 'POST', {}));
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    const after = await (await fetch(`${base}/services/soundtrack/session`, { headers: { Cookie: cookie } })).json();
    assert.strictEqual(after.user, null);
  });

  it('redeems each challenge once, with its binding, for this origin only', async function () {
    const key = new Key();
    const started = await startPassport();
    const assertion = sign(started, key);

    const unbound = await claim(assertion, null);
    assert.strictEqual(unbound.status, 401);
    assert.match((await unbound.json()).error, /Start Passport sign-in again/);

    const otherBinding = await startPassport();
    const mixed = await claim(assertion, otherBinding.cookie);
    assert.strictEqual(mixed.status, 401, 'another challenge’s binding does not redeem this one');

    const fresh = await startPassport();
    const evil = passportCore.createChallenge({ origin: 'https://evil.test' });
    const forged = passportCore.signAssertion({ origin: 'https://evil.test', challenge: evil.uri, signer: 'passport', network: 'mainnet' }, key).uri;
    const refused = await claim(forged, fresh.cookie);
    assert.strictEqual(refused.status, 401);
    assert.match((await refused.json()).error, /origin mismatch/);
    const spent = await claim(sign(fresh, key), fresh.cookie);
    assert.strictEqual(spent.status, 401, 'a refused claim spends the challenge');

    const good = await startPassport();
    assert.strictEqual((await claim(sign(good, key), good.cookie)).status, 200);
    assert.strictEqual((await claim(sign(good, key), good.cookie)).status, 401, 'no replay');
    assert.strictEqual((await claim('not a frame', good.cookie)).status, 400);
  });

  it('issues challenges only for pinned origins, never for the Host header', async function () {
    web.stop();
    web = new SoundtrackWeb({ soundtrack, siteUrl: 'https://soundtrack.example', production: true }).start();
    assert.strictEqual((await raw(port, '/services/soundtrack/passport/challenges', { method: 'POST', body: {} })).status, 400);
    const spoofed = await raw(port, '/services/soundtrack/passport/challenges', { method: 'POST', body: {}, headers: { Host: 'evil.test', 'X-Forwarded-Proto': 'https' } });
    assert.strictEqual(spoofed.status, 400);

    const proxied = { Host: 'soundtrack.example', 'X-Forwarded-Proto': 'https' };
    const issued = await raw(port, '/services/soundtrack/passport/challenges', { method: 'POST', body: {}, headers: proxied });
    assert.strictEqual(issued.status, 200);
    assert.strictEqual(passportCore.readChallenge(issued.json.challenge).challenge.origin, 'https://soundtrack.example');
    const binding = [].concat(issued.headers['set-cookie']).find((line) => line.startsWith('soundtrack.passport='));
    assert.match(binding, /; Secure$/);
    const assertion = passportCore.signAssertion({ origin: 'https://soundtrack.example', challenge: issued.json.challenge, signer: 'passport', network: 'mainnet' }, new Key()).uri;
    const claimed = await raw(port, '/services/soundtrack/passport', { method: 'POST', body: { assertion }, headers: Object.assign({ Cookie: binding.split(';')[0] }, proxied) });
    assert.strictEqual(claimed.status, 200, JSON.stringify(claimed.json));
    assert.match(cookieFrom(claimed.headers['set-cookie'], 'soundtrack.session'), /^soundtrack\.session=[0-9a-f]{64}$/);

    assert.strictEqual(new SoundtrackWeb({ soundtrack, siteUrl: 'not a url', production: true }).loginEnabled, false, 'production with nothing to pin: Passport stays off');
  });

  it('refuses cross-site writes and non-JSON posts, and forgets Discord sessions', async function () {
    const cookie = await signIn();
    const cross = await fetch(`${base}/services/soundtrack/rooms/lobby/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: 'https://evil.example' },
      body: JSON.stringify({ text: 'hi' })
    });
    assert.strictEqual(cross.status, 403);
    const crossChallenge = await fetch(`${base}/services/soundtrack/passport/challenges`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: '{}'
    });
    assert.strictEqual(crossChallenge.status, 403);
    const form = await fetch(`${base}/services/soundtrack/rooms/lobby/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
      body: 'text=hi'
    });
    assert.strictEqual(form.status, 403);
    const sameSite = await fetch(`${base}/services/soundtrack/rooms/lobby/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: base },
      body: JSON.stringify({ text: 'hi' })
    });
    assert.strictEqual(sameSite.status, 201);

    const token = crypto.randomBytes(32).toString('hex');
    const hashed = crypto.createHash('sha256').update(token).digest('hex');
    await soundtrack.saveRecord('web', `session-${hashed}`, { user: { id: 'discord:42', name: 'Old' }, expiresAt: Date.now() + 60000 });
    const old = await (await fetch(`${base}/services/soundtrack/session`, { headers: { Cookie: `soundtrack.session=${token}` } })).json();
    assert.strictEqual(old.user, null);
  });

  it('streams room events', async function () {
    const cookie = await signIn();
    const controller = new AbortController();
    const response = await fetch(`${base}/services/soundtrack/rooms/lobby/events`, { signal: controller.signal });
    assert.strictEqual(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = response.body.getReader();
    let text = '';
    const read = (async () => {
      while (!/event: chat/.test(text)) {
        const { value, done } = await reader.read();
        if (done) break;
        text += Buffer.from(value).toString('utf8');
      }
    })();
    await fetch(`${base}/services/soundtrack/rooms/lobby/chat`, json(cookie, 'POST', { text: 'hello' }));
    await read;
    controller.abort();
    assert.match(text, /event: chat\ndata: \{"id":"[0-9a-f]{12}","author":"Alice","authorId":"[0-9a-f]{16}","text":"hello","at":\d+\}/);
    assert.ok(!text.includes('fabric:'));
  });

  it('counts listeners by display name and guests by stream', async function () {
    const cookie = await signIn();
    const made = await (await fetch(`${base}/services/soundtrack/rooms`, json(cookie, 'POST', { name: 'Chill' }))).json();
    const listList = async () => (await (await fetch(`${base}/services/soundtrack/rooms`)).json()).rooms;
    assert.strictEqual((await listList()).find((room) => room.slug === made.slug).createdBy, 'Alice');

    const controller = new AbortController();
    const streams = [];
    for (const headers of [{ Cookie: cookie }, { Cookie: cookie }, {}]) {
      streams.push(await fetch(`${base}/services/soundtrack/rooms/chill/events`, { headers, signal: controller.signal }));
    }
    const room = await (await fetch(`${base}/services/soundtrack/rooms/chill`)).json();
    assert.deepStrictEqual(room.listeners, { count: 2, names: ['Alice'], people: [{ id: room.owner.id, name: 'Alice' }] });
    assert.match(room.owner.id, /^[0-9a-f]{16}$/);
    assert.strictEqual((await listList()).find((item) => item.slug === 'chill').listeners, 2);
    assert.strictEqual((await listList()).find((item) => item.slug === 'lobby').listeners, 0);

    const reader = streams[2].body.getReader();
    const first = Buffer.from((await reader.read()).value).toString('utf8');
    assert.ok(!first.includes('fabric:'));
    controller.abort();
    await until(() => web.listeners('chill').count === 0, 2000);
  });

  it('lets a room\'s owner run it, with moderators who ban songs and listeners', async function () {
    const aliceKey = new Key();
    const alice = await signIn(aliceKey, 'Alice');
    const bob = await signIn(new Key(), 'Bob');
    const personOf = async (cookie) => (await (await fetch(`${base}/services/soundtrack/session`, { headers: { Cookie: cookie } })).json()).user.person;
    const bobId = await personOf(bob);
    const rooms = `${base}/services/soundtrack/rooms`;
    await fetch(rooms, json(alice, 'POST', { name: 'Chill' }));

    assert.strictEqual((await fetch(`${rooms}/chill`, json(null, 'PATCH', { description: 'x' }))).status, 401);
    assert.strictEqual((await fetch(`${rooms}/chill`, json(bob, 'PATCH', { description: 'x' }))).status, 403);
    const patched = await (await fetch(`${rooms}/chill`, json(alice, 'PATCH', { description: 'Lo-fi', permissions: { add: 'moderators' } }))).json();
    assert.strictEqual(patched.description, 'Lo-fi');
    assert.strictEqual(patched.permissions.add, 'moderators');
    assert.strictEqual((await fetch(`${rooms}/chill/queue`, json(bob, 'POST', { song: 'song a' }))).status, 403);

    assert.strictEqual((await fetch(`${rooms}/chill/moderators`, json(bob, 'POST', { person: bobId }))).status, 403);
    const made = await (await fetch(`${rooms}/chill/moderators`, json(alice, 'POST', { person: bobId }))).json();
    assert.deepStrictEqual(made.moderators, [{ id: bobId, name: 'Bob' }]);
    assert.strictEqual((await fetch(`${rooms}/chill/queue`, json(bob, 'POST', { song: 'song a' }))).status, 201);
    const asBob = await (await fetch(`${rooms}/chill`, { headers: { Cookie: bob } })).json();
    assert.deepStrictEqual([asBob.you.role, asBob.you.canSkip], ['moderator', true]);
    assert.deepStrictEqual(asBob.bans, { tracks: [], people: [] });
    assert.strictEqual((await (await fetch(`${rooms}/chill`)).json()).bans, undefined, 'bans are for moderators');
    assert.ok(!JSON.stringify(asBob).includes(aliceKey.pubkey.slice(2)) && !JSON.stringify(asBob).includes('fabric:'), 'listener ids, not keys');

    const removed = await (await fetch(`${rooms}/chill/moderators/${bobId}`, { method: 'DELETE', headers: { Cookie: alice } })).json();
    assert.deepStrictEqual(removed.moderators, []);
    await fetch(`${rooms}/chill`, json(alice, 'PATCH', { permissions: { add: 'everyone' } }));
    const banned = await (await fetch(`${rooms}/chill/bans`, json(alice, 'POST', { person: bobId }))).json();
    assert.deepStrictEqual(banned.bans.people, [{ id: bobId, name: 'Bob' }]);
    assert.strictEqual((await fetch(`${rooms}/chill/chat`, json(bob, 'POST', { text: 'hi' }))).status, 403);
    assert.strictEqual((await fetch(`${rooms}/chill/bans`, json(bob, 'POST', { person: bobId }))).status, 403);
    const lifted = await (await fetch(`${rooms}/chill/bans/people/${bobId}`, { method: 'DELETE', headers: { Cookie: alice } })).json();
    assert.deepStrictEqual(lifted.bans.people, []);

    const playing = (await (await fetch(`${rooms}/chill`)).json()).current;
    assert.strictEqual(playing.track.title, 'Song A');
    const bannedSong = await (await fetch(`${rooms}/chill/bans`, json(alice, 'POST', { track: playing.track.id }))).json();
    assert.deepStrictEqual(bannedSong.bans.tracks.map((track) => track.title), ['Song A']);
    assert.strictEqual((await (await fetch(`${rooms}/chill`)).json()).current, null, 'a banned song stops');
    const again = await fetch(`${rooms}/chill/queue`, json(bob, 'POST', { song: 'song a' }));
    assert.strictEqual(again.status, 403);
    assert.match((await again.json()).error, /banned/);
    await fetch(`${rooms}/chill/bans/tracks/${playing.track.id}`, { method: 'DELETE', headers: { Cookie: alice } });
    assert.strictEqual((await fetch(`${rooms}/chill/queue`, json(bob, 'POST', { track: playing.track.id }))).status, 201, 're-queue a song by id');
  });

  it('serves listener pages and sets', async function () {
    const alice = await signIn(new Key(), 'Alice');
    const bob = await signIn(new Key(), 'Bob');
    const session = await (await fetch(`${base}/services/soundtrack/session`, { headers: { Cookie: bob } })).json();
    const bobId = session.user.person;
    await fetch(`${base}/services/soundtrack/rooms/lobby/queue`, json(bob, 'POST', { song: 'song a' }));

    const page = await (await fetch(`${base}/services/soundtrack/people/${bobId}`)).json();
    assert.deepStrictEqual([page.name, page.you, page.plays], ['Bob', false, 1]);
    assert.deepStrictEqual(page.recent.map((play) => [play.track.title, play.roomName]), [['Song A', 'Lobby']]);
    assert.strictEqual(page.lastfm, undefined);
    assert.strictEqual((await (await fetch(`${base}/services/soundtrack/people/${bobId}`, { headers: { Cookie: bob } })).json()).you, true);
    assert.strictEqual((await fetch(`${base}/services/soundtrack/people/0000000000000000`)).status, 404);

    const sets = `${base}/services/soundtrack/sets`;
    assert.strictEqual((await fetch(sets, json(null, 'POST', { name: 'Faves' }))).status, 401);
    const made = await fetch(sets, json(bob, 'POST', { name: 'Faves' }));
    assert.strictEqual(made.status, 201);
    const set = await made.json();
    const added = await (await fetch(`${sets}/${set.id}/tracks`, json(bob, 'POST', { song: 'song b' }))).json();
    assert.deepStrictEqual(added.tracks.map((track) => track.title), ['Song B']);
    assert.strictEqual((await fetch(`${sets}/${set.id}`, json(alice, 'PATCH', { name: 'Mine' }))).status, 403);
    const renamed = await (await fetch(`${sets}/${set.id}`, json(bob, 'PATCH', { name: 'Best' }))).json();
    assert.strictEqual(renamed.name, 'Best');
    const shown = await (await fetch(`${sets}/${set.id}`)).json();
    assert.deepStrictEqual([shown.mine, shown.owner], [false, { id: bobId, name: 'Bob' }]);
    assert.deepStrictEqual((await (await fetch(`${base}/services/soundtrack/people/${bobId}`)).json()).sets, [{ id: set.id, name: 'Best', size: 1 }]);

    const queued = await (await fetch(`${base}/services/soundtrack/rooms/lobby/queue`, json(alice, 'POST', { set: set.id }))).json();
    assert.strictEqual(queued.added.length, 1);

    const trackId = added.tracks[0].id;
    assert.deepStrictEqual((await (await fetch(`${sets}/${set.id}/tracks/${trackId}`, { method: 'DELETE', headers: { Cookie: bob } })).json()).tracks, []);
    assert.strictEqual((await fetch(`${sets}/${set.id}`, { method: 'DELETE', headers: { Cookie: bob } })).status, 200);
    assert.strictEqual((await fetch(`${sets}/${set.id}`)).status, 404);
  });

  it('serves each room as a stream when broadcasting is on', async function () {
    assert.strictEqual((await (await fetch(`${base}/services/soundtrack/rooms/lobby`)).json()).stream, null);
    assert.strictEqual((await fetch(`${base}/services/soundtrack/rooms/lobby/stream`)).status, 404);

    const attached = [];
    const broadcast = {
      listeners: (slug) => (slug === 'lobby' ? 3 : 0),
      attach (req, res, slug) {
        attached.push(slug);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'audio/mpeg');
        res.end('mp3');
      }
    };
    web.stop();
    web = new SoundtrackWeb({ soundtrack, siteUrl: base, production: false, broadcast }).start();
    const room = await (await fetch(`${base}/services/soundtrack/rooms/lobby`)).json();
    assert.strictEqual(room.stream, '/services/soundtrack/rooms/lobby/stream');
    assert.strictEqual(room.listeners.count, 3, 'stream listeners count');
    const stream = await fetch(`${base}${room.stream}`);
    assert.deepStrictEqual([stream.status, stream.headers.get('content-type'), await stream.text()], [200, 'audio/mpeg', 'mp3']);
    assert.strictEqual((await fetch(`${base}/services/soundtrack/rooms/nope/stream`)).status, 404);
    assert.deepStrictEqual(attached, ['lobby']);
  });

  it('links Last.fm through its callback, for the session that asked', async function () {
    assert.strictEqual((await fetch(`${base}/services/soundtrack/lastfm/connect`, { redirect: 'manual' })).status, 404, 'off without a key');
    const links = new Map();
    const lastfm = {
      enabled: true,
      authorizeUrl: (callback) => `https://www.last.fm/api/auth/?api_key=key&cb=${encodeURIComponent(callback)}`,
      async link (account, token) {
        if (token !== 'goodtoken') throw Object.assign(new Error('refused'), { status: 502 });
        links.set(account, { name: 'fm_alice' });
        return { name: 'fm_alice' };
      },
      async linked (account) { return links.get(account) || null; },
      async unlink (account) { links.delete(account); }
    };
    web.stop();
    web = new SoundtrackWeb({ soundtrack, siteUrl: base, production: false, lastfm }).start();
    const alice = await signIn(new Key(), 'Alice');
    const bob = await signIn(new Key(), 'Bob');
    const aliceId = (await (await fetch(`${base}/services/soundtrack/session`, { headers: { Cookie: alice } })).json()).user.person;
    const page = `/people/${aliceId}`;

    const signedOut = await fetch(`${base}/services/soundtrack/lastfm/connect`, { redirect: 'manual' });
    assert.deepStrictEqual([signedOut.status, signedOut.headers.get('location')], [302, '/']);

    const connect = async (cookie) => {
      const res = await fetch(`${base}/services/soundtrack/lastfm/connect`, { redirect: 'manual', headers: { Cookie: cookie } });
      assert.strictEqual(res.status, 302);
      const line = res.headers.getSetCookie().find((item) => item.startsWith('soundtrack.lastfm='));
      assert.match(line, /^soundtrack\.lastfm=[0-9a-f]{64}; Path=\/services\/soundtrack\/lastfm; HttpOnly; SameSite=Lax/);
      return { location: res.headers.get('location'), state: line.split(';')[0] };
    };
    const callback = async (cookie, token) => {
      const res = await fetch(`${base}/services/soundtrack/lastfm/callback?token=${token}`, { redirect: 'manual', headers: { Cookie: cookie } });
      assert.strictEqual(res.status, 302);
      assert.ok(res.headers.getSetCookie().some((line) => /^soundtrack\.lastfm=;.*Max-Age=0/.test(line)), 'the state is cleared');
      return res.headers.get('location');
    };

    const first = await connect(alice);
    assert.strictEqual(new URL(first.location).searchParams.get('cb'), `${base}/services/soundtrack/lastfm/callback`);
    assert.strictEqual(await callback(alice, 'goodtoken'), `${page}?lastfm=expired`, 'no state, no link');
    assert.strictEqual(links.size, 0);

    const stolen = await connect(alice);
    const bobPage = `/people/${(await (await fetch(`${base}/services/soundtrack/session`, { headers: { Cookie: bob } })).json()).user.person}`;
    assert.strictEqual(await callback(`${bob}; ${stolen.state}`, 'goodtoken'), `${bobPage}?lastfm=expired`, 'another session\'s state');

    const refused = await connect(alice);
    assert.strictEqual(await callback(`${alice}; ${refused.state}`, 'badtoken'), `${page}?lastfm=refused`);

    const good = await connect(alice);
    assert.strictEqual(await callback(`${alice}; ${good.state}`, 'goodtoken'), `${page}?lastfm=linked`);
    assert.strictEqual(await callback(`${alice}; ${good.state}`, 'goodtoken'), `${page}?lastfm=expired`, 'each state works once');

    const session = await (await fetch(`${base}/services/soundtrack/session`, { headers: { Cookie: alice } })).json();
    assert.deepStrictEqual(session.lastfm, { linked: { name: 'fm_alice' } });
    assert.deepStrictEqual((await (await fetch(`${base}/services/soundtrack${page}`, { headers: { Cookie: alice } })).json()).lastfm, { linked: { name: 'fm_alice' } });
    assert.strictEqual((await (await fetch(`${base}/services/soundtrack${page}`)).json()).lastfm, undefined, 'only on your own page');
    const unlinked = await fetch(`${base}/services/soundtrack/lastfm`, { method: 'DELETE', headers: { Cookie: alice } });
    assert.deepStrictEqual(await unlinked.json(), { linked: null });
    assert.strictEqual(links.size, 0);
  });
});
