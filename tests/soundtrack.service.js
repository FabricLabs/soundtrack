'use strict';

const assert = require('assert');
const fs = require('fs');
const Soundtrack = require('../services/soundtrack');
const { fakeResolver, fakeClock, tempDir, CATALOG } = require('./helpers');

const alice = { id: 'discord:1', name: 'Alice' };
const bob = { id: 'discord:2', name: 'Bob' };

describe('Soundtrack service', function () {
  let dir;
  let clock;
  let resolver;
  let soundtrack;

  async function open () {
    soundtrack = new Soundtrack({ path: dir, resolver, now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    await soundtrack.start();
    return soundtrack;
  }

  beforeEach(async function () {
    dir = tempDir('service');
    clock = fakeClock();
    resolver = fakeResolver(CATALOG);
    await open();
  });

  afterEach(async function () {
    await soundtrack.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('makes the default room on start and lists rooms', async function () {
    const rooms = await soundtrack.rooms();
    assert.deepStrictEqual(rooms.map((room) => room.slug), ['lobby']);
    const created = await soundtrack.createRoom({ name: 'Late Night Jams!', description: 'quiet' }, alice);
    assert.strictEqual(created.slug, 'late-night-jams');
    assert.strictEqual(created.createdBy, 'Alice');
    await assert.rejects(soundtrack.createRoom({ name: 'late night jams' }, alice), /already exists/);
    assert.strictEqual(Soundtrack.slugify('2024'), 'room-2024');
    await assert.rejects(soundtrack.room('nope'), (error) => error.status === 404);
  });

  it('plays the first song at once and queues the rest by votes', async function () {
    const plays = [];
    soundtrack.on('play', (event) => plays.push(event.track.title));
    const first = await soundtrack.enqueue('lobby', 'song a', alice);
    assert.strictEqual(first.mine, true);
    assert.deepStrictEqual(plays, ['Song A']);

    const b = await soundtrack.enqueue('lobby', 'song b', alice);
    const c = await soundtrack.enqueue('lobby', 'song c', bob);
    let room = await soundtrack.room('lobby', bob.id);
    assert.strictEqual(room.current.track.title, 'Song A');
    assert.strictEqual(room.current.position, 0);
    assert.deepStrictEqual(room.queue.map((entry) => entry.track.title), ['Song B', 'Song C']);

    await soundtrack.vote('lobby', c.id, alice.id, 1);
    const voted = await soundtrack.vote('lobby', b.id, bob.id, -1);
    assert.strictEqual(voted.yours, -1);
    room = await soundtrack.room('lobby', bob.id);
    assert.deepStrictEqual(room.queue.map((entry) => [entry.track.title, entry.score, entry.mine]), [['Song C', 1, true], ['Song B', -1, false]]);
    assert.ok(!JSON.stringify(room).includes('discord:'), 'views carry names only');
  });

  it('refuses duplicates, live streams, long songs, and a full share', async function () {
    await soundtrack.enqueue('lobby', 'song a', alice);
    await assert.rejects(soundtrack.enqueue('lobby', 'https://youtu.be/aaaaaaaaaaa', bob), /already in the queue/);
    await assert.rejects(soundtrack.enqueue('lobby', 'live', bob), /Live streams/);
    await assert.rejects(soundtrack.enqueue('lobby', 'long', bob), /at most 20 minutes/);
    await assert.rejects(soundtrack.enqueue('lobby', 'nothing', bob), (error) => error.status === 400);
    await assert.rejects(soundtrack.enqueue('lobby', 'song b', null), (error) => error.status === 401);
    soundtrack.limits.maxPerCurator = 1;
    await soundtrack.enqueue('lobby', 'song b', bob);
    await assert.rejects(soundtrack.enqueue('lobby', 'song c', bob), /already have 1/);
  });

  it('moves on when a song ends, records plays, and goes idle', async function () {
    const events = [];
    soundtrack.on('play', (event) => events.push(`play ${event.track.title}`));
    soundtrack.on('idle', () => events.push('idle'));
    await soundtrack.enqueue('lobby', 'song a', alice);
    await soundtrack.enqueue('lobby', 'song b', bob);
    await clock.advance(30 * 1000);
    assert.strictEqual((await soundtrack.room('lobby')).current.position, 30);
    await clock.advance(30 * 1000);
    await clock.advance(90 * 1000);
    assert.deepStrictEqual(events, ['play Song A', 'play Song B', 'idle']);
    const plays = await soundtrack.plays('lobby');
    assert.deepStrictEqual(plays.map((play) => [play.track.title, play.curator, play.endedAt - play.startedAt]), [['Song B', 'Bob', 90000], ['Song A', 'Alice', 60000]]);
    const track = await soundtrack.track(plays[1].track.id);
    assert.strictEqual(track.plays, 1);
  });

  it('skips, takes songs out, and skips a song whose source is down', async function () {
    await soundtrack.enqueue('lobby', 'song a', alice);
    const b = await soundtrack.enqueue('lobby', 'song b', bob);
    const c = await soundtrack.enqueue('lobby', 'song c', bob);
    await assert.rejects(soundtrack.remove('lobby', c.id, alice.id), (error) => error.status === 403);
    await soundtrack.remove('lobby', c.id, bob.id);
    const next = await soundtrack.skip('lobby', alice);
    assert.strictEqual(next.track.title, 'Song B');
    assert.strictEqual(await soundtrack.reportDown('lobby', 'not-current', 'gone'), false);
    assert.strictEqual(await soundtrack.reportDown('lobby', b.id, 'HTTP 403'), true);
    const room = await soundtrack.room('lobby');
    assert.strictEqual(room.current, null);
    const plays = await soundtrack.plays('lobby');
    assert.strictEqual(plays[0].down, true);
    assert.deepStrictEqual(plays[1].skipped, { by: 'Alice' });
    assert.strictEqual((await soundtrack.track(b.track.id)).down, true);
    await assert.rejects(soundtrack.skip('lobby', alice), /Nothing is playing/);
  });

  it('keeps chat, capped, with names only', async function () {
    soundtrack.settings.chatHistory = 3;
    const seen = [];
    soundtrack.on('chat', (event) => seen.push(event.message.text));
    for (const text of ['one', 'two', 'three', 'four']) await soundtrack.chat('lobby', alice, text);
    await assert.rejects(soundtrack.chat('lobby', alice, '   '), /Say something/);
    const messages = await soundtrack.messages('lobby');
    assert.deepStrictEqual(messages.map((message) => message.text), ['two', 'three', 'four']);
    assert.strictEqual(messages[0].author, 'Alice');
    assert.deepStrictEqual(seen, ['one', 'two', 'three', 'four']);
  });

  it('picks up where it left off after a restart', async function () {
    await soundtrack.createRoom({ name: 'Second' }, alice);
    await soundtrack.enqueue('lobby', 'song a', alice);
    await soundtrack.enqueue('lobby', 'song b', bob);
    await soundtrack.saveRecord('discord', 'guild-1', { room: 'second' });
    await soundtrack.stop();

    clock.time += 70 * 1000;
    await open();
    assert.deepStrictEqual((await soundtrack.rooms()).map((room) => room.slug), ['lobby', 'second']);
    const room = await soundtrack.room('lobby');
    assert.strictEqual(room.current.track.title, 'Song B', 'Song A ended while stopped');
    assert.deepStrictEqual(await soundtrack.record('discord', 'guild-1'), { room: 'second' });
    await clock.advance(90 * 1000);
    assert.strictEqual((await soundtrack.room('lobby')).current, null);
  });
});
