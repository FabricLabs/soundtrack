'use strict';

const assert = require('assert');
const fs = require('fs');
const Soundtrack = require('../services/soundtrack');
const { fakeResolver, fakeClock, tempDir, CATALOG } = require('./helpers');

const alice = { id: 'fabric:' + 'a'.repeat(64), name: 'Alice' };
const bob = { id: 'discord:2', name: 'Bob' };
const carol = { id: 'discord:3', name: 'Carol' };
const HOUR = 60 * 60 * 1000;

describe('Soundtrack auto-DJ, moderation, listeners, and sets', function () {
  let dir;
  let clock;
  let soundtrack;

  async function open (settings = {}) {
    soundtrack = new Soundtrack(Object.assign({
      path: dir,
      resolver: fakeResolver(CATALOG),
      now: clock.now,
      random: () => 0,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout
    }, settings));
    await soundtrack.start();
    return soundtrack;
  }

  beforeEach(async function () {
    dir = tempDir('features');
    clock = fakeClock();
    await open();
  });

  afterEach(async function () {
    await soundtrack.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('plays songs people chose before when the queue runs out, not recent ones', async function () {
    const events = [];
    soundtrack.on('play', (event) => events.push(`${event.entry.auto ? 'auto' : 'play'} ${event.track.title}`));
    soundtrack.on('idle', () => events.push('idle'));
    const ended = [];
    soundtrack.on('ended', (event) => ended.push([event.track.title, event.curator, event.auto, event.skipped]));

    await soundtrack.enqueue('lobby', 'song a', alice);
    await soundtrack.enqueue('lobby', 'song b', bob);
    await clock.advance(60 * 1000);
    await clock.advance(90 * 1000);
    assert.deepStrictEqual(events, ['play Song A', 'play Song B', 'idle'], 'both just played');
    assert.strictEqual(await soundtrack.wake('lobby'), false);

    await clock.advance(3 * HOUR);
    const stop = soundtrack.addAudience(() => 0);
    assert.strictEqual(await soundtrack.wake('lobby'), false, 'nobody is listening');
    stop();
    assert.strictEqual(await soundtrack.wake('lobby'), true);
    const room = await soundtrack.room('lobby', bob.id);
    assert.strictEqual(room.current.track.title, 'Song A');
    assert.strictEqual(room.current.auto, true);
    assert.strictEqual(room.current.curator, null);
    assert.strictEqual(room.you.canSkip, true, 'anyone may skip an auto-DJ pick');

    await clock.advance(60 * 1000);
    await clock.advance(90 * 1000);
    assert.deepStrictEqual(events.slice(3), ['auto Song A', 'auto Song B', 'idle']);
    assert.deepStrictEqual(ended, [['Song A', 'Alice', false, false], ['Song B', 'Bob', false, false], ['Song A', null, true, false], ['Song B', null, true, false]]);
    const plays = await soundtrack.plays('lobby');
    assert.strictEqual(plays[0].auto, true);

    const person = await soundtrack.person(soundtrack.personId(alice.id));
    assert.strictEqual(person.plays, 1, 'auto-DJ plays credit nobody');

    await clock.advance(3 * HOUR);
    await assert.rejects(soundtrack.updateRoom('lobby', { autoplay: false }, bob.id), (error) => error.status === 403);
    soundtrack.settings.admins = [alice.id];
    await soundtrack.updateRoom('lobby', { autoplay: false }, alice.id);
    assert.strictEqual(await soundtrack.wake('lobby'), false, 'the room turned it off');
  });

  it('lets a room\'s owner set its rules and moderators, who ban songs and listeners', async function () {
    await soundtrack.createRoom({ name: 'Chill' }, alice);
    const bobId = soundtrack.personId(bob.id);
    const carolId = soundtrack.personId(carol.id);
    let view = await soundtrack.room('chill', alice.id);
    assert.deepStrictEqual(view.owner, { id: soundtrack.personId(alice.id), name: 'Alice' });
    assert.strictEqual(view.you.role, 'owner');
    assert.deepStrictEqual(view.permissions, { add: 'everyone', skip: 'curator', remove: 'curator' });

    const b = await soundtrack.enqueue('chill', 'song a', bob);
    const c = await soundtrack.enqueue('chill', 'song b', carol);
    await soundtrack.enqueue('chill', 'song c', carol);
    assert.strictEqual(await soundtrack.canSkip('chill', carol.id), false);
    assert.strictEqual(await soundtrack.canSkip('chill', bob.id), true);
    await assert.rejects(soundtrack.updateRoom('chill', { description: 'x' }, bob.id), (error) => error.status === 403);

    await soundtrack.updateRoom('chill', { description: 'Lo-fi only', permissions: { add: 'moderators', skip: 'everyone' } }, alice.id);
    await assert.rejects(soundtrack.updateRoom('chill', { permissions: { skip: 'nobody' } }, alice.id), (error) => error.status === 400);
    await assert.rejects(soundtrack.enqueue('chill', 'song c', bob), /moderators can add/);
    assert.strictEqual(await soundtrack.canSkip('chill', carol.id), true);

    await assert.rejects(soundtrack.setModerator('chill', bobId, true, carol.id), (error) => error.status === 403);
    await soundtrack.setModerator('chill', bobId, true, alice.id);
    view = await soundtrack.room('chill', bob.id);
    assert.strictEqual(view.you.role, 'moderator');
    assert.deepStrictEqual(view.moderators, [{ id: bobId, name: 'Bob' }]);
    await assert.rejects(soundtrack.updateRoom('chill', { autoplay: false }, bob.id), /owner/);
    await soundtrack.updateRoom('chill', { name: 'Chill Out' }, bob.id);

    // A moderator takes out others' songs; with `remove: moderators`, curators can't.
    await soundtrack.updateRoom('chill', { permissions: { remove: 'moderators' } }, alice.id);
    view = await soundtrack.room('chill', carol.id);
    assert.ok(view.queue.every((entry) => !entry.removable));
    await assert.rejects(soundtrack.remove('chill', c.id, carol.id), /moderators can take/);
    await soundtrack.remove('chill', c.id, bob.id);

    await assert.rejects(soundtrack.ban('chill', { person: bobId }, alice), /can't be banned/);
    await assert.rejects(soundtrack.ban('chill', { person: carolId }, carol), (error) => error.status === 403);
    const bans = await soundtrack.ban('chill', { person: carolId }, bob);
    assert.deepStrictEqual(bans.people, [{ id: carolId, name: 'Carol' }]);
    view = await soundtrack.room('chill', carol.id);
    assert.strictEqual(view.queue.length, 0, 'their waiting songs went');
    assert.strictEqual(view.you.banned, true);
    assert.strictEqual(view.bans, undefined, 'only moderators see bans');
    await assert.rejects(soundtrack.chat('chill', carol, 'hi'), /banned/);
    await assert.rejects(soundtrack.vote('chill', b.id, carol.id, 1), /banned/);

    // Banning what plays skips it, and it can't be queued again.
    await soundtrack.ban('chill', { track: b.track.id }, alice);
    view = await soundtrack.room('chill', alice.id);
    assert.strictEqual(view.current, null);
    assert.deepStrictEqual(view.bans.tracks.map((track) => track.title), ['Song A']);
    await assert.rejects(soundtrack.enqueue('chill', 'song a', alice), /banned from this room/);
    assert.deepStrictEqual((await soundtrack.plays('chill'))[0].skipped, { by: 'Alice' });

    await soundtrack.unban('chill', { track: b.track.id }, bob.id);
    await soundtrack.unban('chill', { person: carolId }, bob.id);
    await soundtrack.enqueue('chill', 'song a', alice);
    await soundtrack.updateRoom('chill', { permissions: { add: 'everyone' } }, alice.id);
    await soundtrack.enqueue('chill', 'song b', carol);
    await soundtrack.setModerator('chill', bobId, false, alice.id);
    assert.deepStrictEqual((await soundtrack.room('chill')).moderators, []);

    const json = JSON.stringify(await soundtrack.room('chill', alice.id));
    assert.ok(!json.includes('discord:') && !json.includes('fabric:'), 'views carry names and listener ids only');
  });

  it('keeps a page per listener: top plays, recent plays, sets, and rooms', async function () {
    await soundtrack.createRoom({ name: 'Chill' }, alice);
    await soundtrack.enqueue('lobby', 'song a', alice);
    await clock.advance(60 * 1000);
    await clock.advance(3 * HOUR);
    await soundtrack.enqueue('chill', 'song a', alice);
    await soundtrack.enqueue('chill', 'song b', alice);
    await clock.advance(60 * 1000);

    const id = soundtrack.personId(alice.id);
    assert.match(id, /^[0-9a-f]{16}$/);
    assert.notStrictEqual(id, soundtrack.personId(bob.id));
    const page = await soundtrack.person(id, alice.id);
    assert.strictEqual(page.name, 'Alice');
    assert.strictEqual(page.plays, 3);
    assert.deepStrictEqual(page.top.map((item) => [item.track.title, item.plays]), [['Song A', 2], ['Song B', 1]]);
    assert.deepStrictEqual(page.recent.map((play) => [play.track.title, play.roomName]), [['Song B', 'Chill'], ['Song A', 'Chill'], ['Song A', 'Lobby']]);
    assert.deepStrictEqual(page.rooms, [{ slug: 'chill', name: 'Chill', role: 'owner' }]);
    assert.strictEqual(page.you, true);
    assert.strictEqual((await soundtrack.person(id, bob.id)).you, false);
    assert.ok(!JSON.stringify(page).includes('fabric:'));
    assert.strictEqual(await soundtrack.person('0'.repeat(16)), null);
    assert.strictEqual(await soundtrack.person('../x'), null);

    await soundtrack.stop();
    await open();
    assert.strictEqual(soundtrack.personId(alice.id), id, 'ids survive a restart');
  });

  it('keeps sets of songs and queues them, a song, or a whole set', async function () {
    const made = await soundtrack.createSet(alice, { name: 'Favorites', description: 'the good ones' });
    assert.match(made.id, /^[0-9a-f]{12}$/);
    await soundtrack.addToSet(made.id, { song: 'song a' }, alice.id);
    await soundtrack.addToSet(made.id, { song: 'song b' }, alice.id);
    let set = await soundtrack.addToSet(made.id, { song: 'song c' }, alice.id);
    assert.deepStrictEqual(set.tracks.map((track) => track.title), ['Song A', 'Song B', 'Song C']);
    assert.strictEqual(set.mine, true);
    assert.deepStrictEqual(set.owner, { id: soundtrack.personId(alice.id), name: 'Alice' });
    await assert.rejects(soundtrack.addToSet(made.id, { track: set.tracks[0].id }, alice.id), /already in this set/);
    await assert.rejects(soundtrack.addToSet(made.id, { song: 'live' }, alice.id), /Live streams/);
    await assert.rejects(soundtrack.addToSet(made.id, { song: 'song a' }, bob.id), (error) => error.status === 403);
    await assert.rejects(soundtrack.updateSet(made.id, { name: 'Mine' }, bob.id), (error) => error.status === 403);
    assert.strictEqual((await soundtrack.set(made.id, bob.id)).mine, false);

    await soundtrack.enqueue('lobby', 'song b', bob);
    const queued = await soundtrack.enqueueSet('lobby', made.id, carol);
    assert.deepStrictEqual(queued.added.map((entry) => entry.track.title), ['Song A', 'Song C']);
    assert.strictEqual(queued.skipped, 1, 'Song B was already queued');
    const again = await soundtrack.enqueueTrack('chill-nope', set.tracks[0].id, bob).catch((error) => error);
    assert.strictEqual(again.status, 404);
    await assert.rejects(soundtrack.enqueueTrack('lobby', 'f'.repeat(64), bob), /No such song/);

    set = await soundtrack.removeFromSet(made.id, set.tracks[1].id, alice.id);
    set = await soundtrack.updateSet(made.id, { name: 'Best' }, alice.id);
    assert.deepStrictEqual([set.name, set.tracks.length], ['Best', 2]);
    assert.deepStrictEqual((await soundtrack.person(soundtrack.personId(alice.id))).sets, [{ id: made.id, name: 'Best', size: 2 }]);
    await soundtrack.deleteSet(made.id, alice.id);
    await assert.rejects(soundtrack.set(made.id), (error) => error.status === 404);
    assert.deepStrictEqual((await soundtrack.person(soundtrack.personId(alice.id))).sets, []);
    await assert.rejects(soundtrack.set('../../x'), (error) => error.status === 404);
  });
});
