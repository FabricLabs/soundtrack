'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const fs = require('fs');
const Soundtrack = require('../services/soundtrack');
const SoundtrackDiscord = require('../services/discord');
const { fakeResolver, until, tempDir, CATALOG } = require('./helpers');

let Doorman = null;
try {
  Doorman = require('@fabric/doorman');
} catch (_) { /* not installed */ }

// A Doorman adapter that can take commands, like the Discord one.
class CommandAdapter extends EventEmitter {
  constructor () {
    super();
    this.registered = null;
    this.supportsCommands = true;
    this.canSpeak = false;
  }

  async start () {
    this.emit('ready', { name: 'discord' });
  }

  async stop () {}

  async registerCommands (definitions) {
    this.registered = definitions;
  }
}

describe('Soundtrack through Doorman', function () {
  let dir;
  let soundtrack;
  let doorman;
  let adapter;

  before(function () {
    if (!Doorman || !Doorman.prototype || typeof Doorman.prototype.command !== 'function') this.skip();
  });

  beforeEach(async function () {
    dir = tempDir('doorman');
    soundtrack = new Soundtrack({ path: dir, resolver: fakeResolver(CATALOG) });
    await soundtrack.start();
    doorman = new Doorman({ http: false, local: false });
    doorman.on('error', () => {});
    adapter = new CommandAdapter();
    doorman.use(SoundtrackDiscord, { soundtrack });
    doorman.enable('discord', adapter);
    await doorman.start();
    await adapter.start();
  });

  afterEach(async function () {
    await doorman.stop();
    await soundtrack.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('registers the slash commands and answers one', async function () {
    await until(() => adapter.registered);
    assert.deepStrictEqual(adapter.registered.map((command) => command.name).sort(), ['join', 'leave', 'np', 'play', 'queue', 'skip', 'vote']);
    const vote = adapter.registered.find((command) => command.name === 'vote');
    assert.strictEqual(vote.options[0].autocomplete, true);

    const replies = [];
    adapter.emit('command', {
      name: 'play',
      user: '1',
      userName: 'Alice',
      channel: '50',
      guild: '7',
      options: { song: 'song a' },
      defer: async () => {},
      reply: async (result) => { replies.push(result); }
    });
    await until(() => replies.length);
    assert.strictEqual(replies.length, 1);
    assert.match(replies[0].content, /^Added \[Song A\]/);
    assert.strictEqual((await soundtrack.room('lobby')).current.track.title, 'Song A');
  });
});
