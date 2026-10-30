'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const fs = require('fs');
const Soundtrack = require('../services/soundtrack');
const Broadcast = require('../services/broadcast');
const { encoderArgs } = require('../services/broadcast');
const { fakeResolver, until, tempDir, CATALOG } = require('./helpers');

const alice = { id: 'discord:1', name: 'Alice' };

// `child_process.spawn` without processes: each call is a child whose
// stdout the test writes to.
function fakeSpawn () {
  const calls = [];
  const spawn = (command, args) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.killed = false;
    child.kill = () => {
      child.killed = true;
      setImmediate(() => child.emit('exit', null, 'SIGKILL'));
    };
    calls.push({ command, args, child });
    return child;
  };
  spawn.calls = calls;
  return spawn;
}

function listener () {
  const req = new EventEmitter();
  const res = new EventEmitter();
  Object.assign(res, {
    statusCode: null,
    headers: {},
    chunks: [],
    ended: false,
    destroyed: false,
    writableLength: 0,
    setHeader (name, value) { res.headers[name.toLowerCase()] = value; },
    write (chunk) { res.chunks.push(chunk); return true; },
    end () { res.ended = true; req.emit('close'); },
    destroy () { res.destroyed = true; req.emit('close'); }
  });
  return { req, res };
}

describe('Room streams', function () {
  let dir;
  let resolver;
  let soundtrack;
  let spawn;
  let broadcast;

  beforeEach(async function () {
    dir = tempDir('broadcast');
    resolver = fakeResolver(CATALOG);
    soundtrack = new Soundtrack({ path: dir, resolver });
    await soundtrack.start();
    spawn = fakeSpawn();
    broadcast = new Broadcast({ soundtrack, spawn, ffmpeg: 'ffmpeg-test', maxListeners: 3, maxBuffered: 100 }).start();
  });

  afterEach(async function () {
    broadcast.stop();
    await soundtrack.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('encodes a source from where the room is, or silence', function () {
    const silence = encoderArgs(null);
    assert.ok(silence.includes('anullsrc=r=44100:cl=stereo'));
    assert.ok(silence.includes('-re'));
    const args = encoderArgs({ url: 'https://media.example/a.webm', headers: { Referer: 'x', 'Bad\r\nKey': 'v\r\nInjected: 1' }, seek: 12.5 }, { bitrate: 999 });
    assert.strictEqual(args[args.indexOf('-headers') + 1], 'Referer: x\r\nBadKey: vInjected: 1\r\n');
    assert.strictEqual(args[args.indexOf('-ss') + 1], '12.500');
    assert.strictEqual(args[args.indexOf('-i') + 1], 'https://media.example/a.webm');
    assert.ok(args.indexOf('-ss') < args.indexOf('-i'), 'seek on the input');
    assert.strictEqual(args[args.indexOf('-b:a') + 1], '320k');
    assert.strictEqual(args[args.indexOf('-protocol_whitelist') + 1].includes('file'), false);
    assert.deepStrictEqual(args.slice(-3), ['-f', 'mp3', 'pipe:1']);
  });

  it('runs one encoder per room while someone listens, following what plays', async function () {
    const one = listener();
    const two = listener();
    broadcast.attach(one.req, one.res, 'lobby');
    broadcast.attach(two.req, two.res, 'lobby');
    assert.strictEqual(one.res.headers['content-type'], 'audio/mpeg');
    await until(() => spawn.calls.length === 1);
    assert.strictEqual(spawn.calls[0].command, 'ffmpeg-test');
    assert.ok(spawn.calls[0].args.includes('anullsrc=r=44100:cl=stereo'), 'silence while idle');
    assert.strictEqual(broadcast.listeners('lobby'), 2);
    assert.strictEqual(soundtrack._heard('lobby'), true);
    assert.strictEqual(soundtrack._heard('elsewhere'), false, 'stream listeners are the room\'s audience');

    spawn.calls[0].child.stdout.emit('data', Buffer.from('frame'));
    assert.deepStrictEqual([one.res.chunks.length, two.res.chunks.length], [1, 1]);

    await soundtrack.enqueue('lobby', 'song a', alice);
    await until(() => spawn.calls.length === 2);
    assert.strictEqual(spawn.calls[0].child.killed, true);
    const args = spawn.calls[1].args;
    assert.strictEqual(args[args.indexOf('-i') + 1], 'https://media.example/aaaaaaaaaaa.webm');
    assert.ok(args.includes('Referer: x\r\n'));

    // The source ends before the clock moves on: silence until it does.
    spawn.calls[1].child.emit('exit', 0, null);
    await until(() => spawn.calls.length === 3);
    assert.ok(spawn.calls[2].args.includes('anullsrc=r=44100:cl=stereo'));

    one.req.emit('close');
    assert.strictEqual(spawn.calls[2].child.killed, false);
    two.req.emit('close');
    assert.strictEqual(spawn.calls[2].child.killed, true, 'nobody left');
    assert.strictEqual(broadcast.listeners('lobby'), 0);
  });

  it('drops a listener who falls behind, caps listeners, and skips a song it can\'t get', async function () {
    const slow = listener();
    const fast = listener();
    broadcast.attach(slow.req, slow.res, 'lobby');
    broadcast.attach(fast.req, fast.res, 'lobby');
    await until(() => spawn.calls.length === 1);
    slow.res.writableLength = 101;
    spawn.calls[0].child.stdout.emit('data', Buffer.from('frame'));
    assert.strictEqual(slow.res.destroyed, true);
    assert.strictEqual(fast.res.chunks.length, 1);
    assert.strictEqual(broadcast.listeners('lobby'), 1);

    const others = [listener(), listener(), listener()];
    for (const other of others) broadcast.attach(other.req, other.res, 'lobby');
    assert.strictEqual(others[2].res.statusCode, 503);

    resolver.failStream = 'HTTP 403';
    await soundtrack.enqueue('lobby', 'song a', alice);
    await until(async () => (await soundtrack.room('lobby')).current === null && (await soundtrack.plays('lobby')).length === 1);
    assert.strictEqual((await soundtrack.plays('lobby'))[0].down, true);
  });
});
