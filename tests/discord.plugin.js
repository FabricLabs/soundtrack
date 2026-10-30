'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const fs = require('fs');
const Soundtrack = require('../services/soundtrack');
const SoundtrackDiscord = require('../services/discord');
const { fakeResolver, fakeClock, until, tempDir, CATALOG } = require('./helpers');

function fakeDoorman () {
  const doorman = new EventEmitter();
  doorman.handles = new Map();
  doorman.voice = (target) => {
    if (!/^discord\/channels\/\d+$/.test(target)) throw new Error(`Not a channel: ${target}`);
    if (!doorman.handles.has(target)) {
      const handle = new EventEmitter();
      handle.userId = '999';
      handle.plays = [];
      handle.calls = [];
      handle.join = async () => { handle.calls.push('join'); };
      handle.play = async (options) => { handle.plays.push(options); };
      handle.stop = async () => { handle.calls.push('stop'); };
      handle.leave = async () => { handle.calls.push('leave'); };
      doorman.handles.set(target, handle);
    }
    return doorman.handles.get(target);
  };
  return doorman;
}

function invocation (name, overrides = {}) {
  const replies = [];
  const call = Object.assign({
    name,
    user: 'discord/users/1',
    userName: 'Alice',
    channel: 'discord/channels/50',
    guild: '7',
    voice: null,
    permissions: [],
    options: {},
    deferred: null,
    defer: async (options) => { call.deferred = options; },
    reply: async (result) => { replies.push(result); }
  }, overrides);
  call.replies = replies;
  return call;
}

async function run (plugin, call) {
  const result = await plugin.chatCommands[call.name].handler(call);
  return result;
}

describe('Soundtrack Discord plugin', function () {
  let dir;
  let clock;
  let soundtrack;
  let doorman;
  let plugin;
  let posts;

  beforeEach(async function () {
    dir = tempDir('discord');
    clock = fakeClock(Date.now());
    soundtrack = new Soundtrack({ path: dir, resolver: fakeResolver(CATALOG), now: clock.now, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    await soundtrack.start();
    doorman = fakeDoorman();
    plugin = new SoundtrackDiscord({ soundtrack, siteUrl: 'https://soundtrack.example' });
    posts = [];
    plugin.on('message', (message) => posts.push(message));
    plugin.trust(doorman);
    await plugin.start();
  });

  afterEach(async function () {
    await plugin.stop();
    await soundtrack.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('offers its commands to Doorman', function () {
    assert.strictEqual(SoundtrackDiscord.pluginName, 'soundtrack');
    assert.deepStrictEqual(Object.keys(plugin.chatCommands), ['play', 'queue', 'np', 'vote', 'skip', 'join', 'leave']);
    for (const spec of Object.values(plugin.chatCommands)) {
      assert.strictEqual(typeof spec.handler, 'function');
      assert.ok(spec.description.length <= 100);
    }
  });

  it('/play from a voice channel binds it, plays, and posts without pings', async function () {
    const call = invocation('play', { voice: 'discord/channels/60', options: { song: 'song a' } });
    const reply = await run(plugin, call);
    assert.deepStrictEqual(call.deferred, { ephemeral: false });
    assert.match(reply.content, /Added \[Song A\]\(<https:\/\/www\.youtube\.com\/watch\?v=aaaaaaaaaaa>\) by Artist A \(1:00\), playing now\./);
    await until(() => posts.length && doorman.handles.has('discord/channels/60') && doorman.handles.get('discord/channels/60').plays.length);

    const binding = plugin.binding('7');
    assert.deepStrictEqual([binding.room, binding.voice, binding.text], ['lobby', 'discord/channels/60', 'discord/channels/50']);
    const handle = doorman.handles.get('discord/channels/60');
    assert.strictEqual(handle.plays.length, 1);
    assert.strictEqual(handle.plays[0].url, 'https://media.example/aaaaaaaaaaa.webm');
    assert.deepStrictEqual(handle.plays[0].headers, { Referer: 'x' });
    assert.ok(handle.plays[0].seek >= 0 && handle.plays[0].seek < 5);
    assert.strictEqual(posts.length, 1);
    assert.strictEqual(posts[0].target, 'discord/channels/50');
    assert.deepStrictEqual(posts[0].object.allowedMentions, { parse: [] });
    assert.match(posts[0].object.content, /^Now playing \[Song A\].*added by Alice$/);

    const saved = await soundtrack.record('soundtrack', 'guild-7');
    assert.strictEqual(saved.voice, 'discord/channels/60');
  });

  it('/queue and /np show the room; /vote reorders it, with autocomplete', async function () {
    await run(plugin, invocation('play', { options: { song: 'song a' } }));
    await run(plugin, invocation('play', { options: { song: 'song b' } }));
    const c = await run(plugin, invocation('play', { user: 'discord/users/2', userName: 'Bob', options: { song: 'song c' } }));
    assert.match(c.content, /#2 in the queue\.\nJoin a voice channel and run \/join/);

    const choices = await plugin.chatCommands.vote.autocomplete(invocation('vote', { focused: { name: 'song', value: 'song c' } }));
    assert.strictEqual(choices.length, 1);
    assert.match(choices[0].name, /^Song C \(\+0\)$/);
    const vote = await run(plugin, invocation('vote', { options: { song: choices[0].value, vote: 'up' } }));
    assert.strictEqual(vote.ephemeral, true);
    assert.match(vote.content, /is at \+1/);

    const queue = await run(plugin, invocation('queue'));
    assert.strictEqual(queue.ephemeral, true);
    const lines = queue.content.split('\n');
    assert.strictEqual(lines[0], '**Lobby**');
    assert.match(lines[1], /^Now: \[Song A\]/);
    assert.match(lines[2], /^1\. \[Song C\].*\+1, from Bob$/);
    assert.match(lines[3], /^2\. \[Song B\].*\+0, from Alice$/);
    assert.strictEqual(lines[4], '<https://soundtrack.example/rooms/lobby>');

    const np = await run(plugin, invocation('np'));
    assert.match(np.content, /^Now playing \[Song A\].*0:00 in, added by Alice\./);
    const bad = await run(plugin, invocation('vote', { options: { song: 'nope', vote: 'up' } }));
    assert.deepStrictEqual(bad, { content: 'That song is not in the queue.', ephemeral: true });
  });

  it('/skip: the curator and managers skip, listeners vote by majority', async function () {
    await run(plugin, invocation('join', { voice: 'discord/channels/60' }));
    await run(plugin, invocation('play', { options: { song: 'song a' } }));
    await run(plugin, invocation('play', { options: { song: 'song b' } }));
    await run(plugin, invocation('play', { options: { song: 'song c' } }));
    for (const user of ['1', '2', '3', '4', '999']) doorman.emit('join', { user: `discord/users/${user}`, channel: 'discord/channels/60' });
    assert.deepStrictEqual(plugin.listeners('discord/channels/60'), ['discord/users/1', 'discord/users/2', 'discord/users/3', 'discord/users/4']);

    const outsider = await run(plugin, invocation('skip', { user: 'discord/users/8', userName: 'Eve' }));
    assert.match(outsider.content, /can vote to/);
    const first = await run(plugin, invocation('skip', { user: 'discord/users/2', userName: 'Bob', voice: 'discord/channels/60' }));
    assert.match(first.content, /Vote to skip counted \(1 of 3 needed\)/);
    await run(plugin, invocation('skip', { user: 'discord/users/3', userName: 'Cy', voice: 'discord/channels/60' }));
    doorman.emit('part', { user: 'discord/users/4', channel: 'discord/channels/60' });
    const third = await run(plugin, invocation('skip', { user: 'discord/users/3', userName: 'Cy', voice: 'discord/channels/60' }));
    assert.match(third.content, /^Skipped \[Song A\].*\(2 of 2 votes\)\. Next: \[Song B\]/);

    const mine = await run(plugin, invocation('skip'));
    assert.match(mine.content, /^Skipped \[Song B\]/);
    const manager = await run(plugin, invocation('skip', { user: 'discord/users/2', userName: 'Bob', permissions: ['ManageChannels'] }));
    assert.match(manager.content, /^Skipped \[Song C\].*The queue is empty\./);
    await until(() => doorman.handles.get('discord/channels/60').calls.includes('stop'));
  });

  it('/join picks a room, /leave stops; others listening need a manager', async function () {
    await soundtrack.createRoom({ name: 'Second' }, null);
    const rooms = await plugin.chatCommands.join.autocomplete(invocation('join', { focused: { name: 'room', value: 'sec' } }));
    assert.deepStrictEqual(rooms, [{ name: 'Second', value: 'second' }]);
    const none = await run(plugin, invocation('join'));
    assert.match(none.content, /Join a voice channel first/);
    const joined = await run(plugin, invocation('join', { options: { channel: '61', room: 'second' } }));
    assert.match(joined.content, /^Playing \*\*Second\*\* in <#61>/);
    assert.deepStrictEqual(doorman.handles.get('discord/channels/61').calls, ['join']);
    assert.strictEqual(plugin.roomFor('7'), 'second');

    doorman.emit('presence', { user: 'discord/users/2', status: 'online', channel: 'discord/channels/61' });
    const refused = await run(plugin, invocation('leave'));
    assert.match(refused.content, /Others are still listening/);
    const moved = await run(plugin, invocation('join', { options: { channel: '62' } }));
    assert.match(moved.content, /People are listening in another channel/);
    const left = await run(plugin, invocation('leave', { permissions: ['ManageChannels'] }));
    assert.strictEqual(left.content, 'Stopped playing in voice.');
    assert.ok(doorman.handles.get('discord/channels/61').calls.includes('leave'));
    assert.strictEqual(plugin.binding('7').voice, null);
  });

  it('reports a source that will not play and resumes bound rooms on reconnect', async function () {
    await run(plugin, invocation('join', { voice: 'discord/channels/60' }));
    await run(plugin, invocation('play', { options: { song: 'song a' } }));
    await run(plugin, invocation('play', { options: { song: 'song b' } }));
    const handle = doorman.handles.get('discord/channels/60');
    await until(() => handle.plays.length);
    assert.strictEqual(handle.plays.length, 1);

    soundtrack.resolver.failStream = 'HTTP Error 403'; // fails once
    const errors = [];
    plugin.on('error', (error) => errors.push(error));
    await plugin.resume();
    await until(() => handle.plays.length > 1);
    const room = await soundtrack.room('lobby');
    assert.strictEqual(room.current.track.title, 'Song B', 'Song A was reported down and skipped');
    assert.ok(errors.some((error) => /could not get audio for Song A/.test(error)));
    assert.strictEqual(handle.plays[handle.plays.length - 1].meta.entry, room.current.id);

    const before = handle.plays.length;
    doorman.emit('service', { name: 'discord' });
    await until(() => handle.plays.length > before);
    assert.strictEqual(handle.plays.length, before + 1);
    assert.strictEqual(handle.plays[handle.plays.length - 1].meta.entry, room.current.id);
  });
});
