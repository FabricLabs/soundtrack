'use strict';

const EventEmitter = require('events');

const NAME = 'soundtrack';
const MAX_LIST = 10;
const MAX_CHOICES = 25;
const NO_PINGS = { parse: [] };

/** `discord/users/<id>` → `discord:<id>`. */
function accountKey (user) {
  const parts = String(user || '').split('/');
  return parts.length === 3 && parts[1] === 'users' ? `${parts[0]}:${parts[2]}` : null;
}

function escape (text) {
  return String(text || '').replace(/([\\*_`~|[\]])/g, '\\$1');
}

function clock (seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

function describe (track) {
  const title = `[${escape(track.title)}](<${track.source.uri}>)`;
  return `${title}${track.artist ? ` by ${escape(track.artist)}` : ''} (${clock(track.duration)})`;
}

// Who chose a song: a name, or the auto-DJ.
function credit (curator, auto) {
  if (auto) return ', picked by the auto-DJ';
  return curator ? `, added by ${escape(curator)}` : '';
}

function errorReply (error) {
  return { content: error && error.status ? error.message : 'That did not work.', ephemeral: true };
}

/**
 * Soundtrack on Discord, as a Doorman plugin: slash commands to add, vote on,
 * and skip songs, and a voice channel per server that plays the room's queue,
 * with a now-playing post in the server's chosen text channel.
 *
 * A server plays `settings.room` until someone picks another with `/join`.
 * Bindings (room, voice channel, text channel per server) are kept in the
 * Soundtrack Store. Replies and posts never ping anyone.
 */
class SoundtrackDiscord extends EventEmitter {
  /**
   * @param {Object} settings
   * @param {Object} settings.soundtrack Soundtrack service (started).
   * @param {string} [settings.room] Room for servers without a binding (default: the Soundtrack's default room).
   * @param {string} [settings.siteUrl] Link to the web player in replies.
   * @param {string} [settings.service] Doorman service name (default `discord`).
   */
  constructor (settings = {}) {
    super();
    this.settings = Object.assign({ soundtrack: null, room: null, siteUrl: null, service: 'discord' }, settings);
    this.soundtrack = this.settings.soundtrack;
    this.doorman = null;
    this.bindings = new Map();
    this.present = new Map();
    this.skipVotes = new Map();
    this._listeners = [];
    this._removeAudience = null;

    const song = { name: 'song', type: 'string', description: 'An upcoming song', required: true, autocomplete: true };
    this.chatCommands = {
      play: {
        description: 'Add a song to the queue (a link or a search)',
        options: [{ name: 'song', type: 'string', description: 'YouTube or SoundCloud link, audio file URL, or search', required: true }],
        handler: (invocation) => this.play(invocation)
      },
      queue: {
        description: 'Show what is playing and what is next',
        handler: (invocation) => this.queue(invocation)
      },
      np: {
        description: 'Show what is playing now',
        handler: (invocation) => this.nowPlaying(invocation)
      },
      vote: {
        description: 'Vote an upcoming song up or down',
        options: [
          song,
          { name: 'vote', type: 'string', description: 'Up, down, or take your vote back', required: true, choices: [{ name: 'up', value: 'up' }, { name: 'down', value: 'down' }, { name: 'clear', value: 'clear' }] }
        ],
        handler: (invocation) => this.vote(invocation),
        autocomplete: (invocation) => this.upcomingChoices(invocation)
      },
      skip: {
        description: 'Skip the song that is playing (or vote to)',
        handler: (invocation) => this.skip(invocation)
      },
      join: {
        description: 'Play the queue in a voice channel and post songs here',
        options: [
          { name: 'channel', type: 'channel', description: 'Voice channel (default: the one you are in)' },
          { name: 'room', type: 'string', description: 'Which room to play', autocomplete: true }
        ],
        handler: (invocation) => this.join(invocation),
        autocomplete: (invocation) => this.roomChoices(invocation)
      },
      leave: {
        description: 'Stop playing in voice',
        handler: (invocation) => this.leave(invocation)
      }
    };
  }

  static get pluginName () {
    return NAME;
  }

  get defaultRoom () {
    return this.settings.room || (this.soundtrack && this.soundtrack.defaultRoom);
  }

  trust (doorman) {
    this.doorman = doorman;
    const on = (emitter, event, fn) => {
      emitter.on(event, fn);
      this._listeners.push([emitter, event, fn]);
    };
    if (this.soundtrack) this._removeAudience = this.soundtrack.addAudience((room) => this._audience(room));
    on(doorman, 'join', (event) => this._enter(event.user, event.channel));
    on(doorman, 'part', (event) => this._exit(event.user, event.channel));
    on(doorman, 'presence', (event) => {
      if (!event.channel) return;
      if (event.status === 'online') this._enter(event.user, event.channel);
      else this._exit(event.user, event.channel);
    });
    on(doorman, 'service', (event) => {
      if (event && event.name === this.settings.service) this.resume().catch((error) => this._error(error));
    });
    if (this.soundtrack) {
      on(this.soundtrack, 'play', (event) => this._onPlay(event).catch((error) => this._error(error)));
      on(this.soundtrack, 'idle', (event) => this._onIdle(event));
    }
    return this;
  }

  async start () {
    if (!this.soundtrack) throw new Error('soundtrack plugin needs settings.soundtrack');
    const index = await this.soundtrack.record(NAME, 'guilds');
    for (const guild of (index && index.ids) || []) {
      const binding = await this.soundtrack.record(NAME, `guild-${guild}`);
      if (binding) this.bindings.set(guild, binding);
    }
    return this;
  }

  async stop () {
    for (const [emitter, event, fn] of this._listeners) emitter.removeListener(event, fn);
    this._listeners = [];
    if (this._removeAudience) this._removeAudience();
    this._removeAudience = null;
    return this;
  }

  _error (error) {
    this.emit('error', `[SOUNDTRACK:DISCORD] ${error && error.message ? error.message : error}`);
  }

  // Who is in which voice channel

  _enter (user, channel) {
    for (const [other, users] of this.present) if (other !== channel) users.delete(user);
    if (!this.present.has(channel)) this.present.set(channel, new Set());
    this.present.get(channel).add(user);
    for (const binding of this.bindings.values()) {
      if (binding.voice === channel) this.soundtrack.wake(binding.room).catch((error) => this._error(error));
    }
  }

  // How many hear a room in the voice channels it plays in.
  _audience (room) {
    let count = 0;
    for (const binding of this.bindings.values()) {
      if (binding.room === room && binding.voice) count += this.listeners(binding.voice).length;
    }
    return count;
  }

  _exit (user, channel) {
    const users = this.present.get(channel);
    if (users) users.delete(user);
  }

  /**
   * People in a voice channel, not counting the bot.
   * @param {string} channel `discord/channels/<id>`
   * @returns {string[]}
   */
  listeners (channel) {
    const users = [...(this.present.get(channel) || [])];
    let self = null;
    try {
      const handle = this.doorman && this.doorman.voice(channel);
      self = handle && handle.userId ? `${this.settings.service}/users/${handle.userId}` : null;
    } catch (_) { /* no voice on this service */ }
    return users.filter((user) => user !== self);
  }

  // Bindings

  binding (guild) {
    return this.bindings.get(String(guild)) || null;
  }

  roomFor (guild) {
    const binding = guild ? this.binding(guild) : null;
    return (binding && binding.room) || this.defaultRoom;
  }

  async _bind (guild, changes) {
    const id = String(guild);
    const binding = Object.assign({ guild: id, room: this.defaultRoom, voice: null, text: null }, this.binding(id), changes, { updatedAt: Date.now() });
    this.bindings.set(id, binding);
    await this.soundtrack.saveRecord(NAME, `guild-${id}`, binding);
    await this.soundtrack.saveRecord(NAME, 'guilds', { ids: [...this.bindings.keys()] });
    return binding;
  }

  // Playback

  async _onPlay (event) {
    const jobs = [];
    for (const binding of this.bindings.values()) {
      if (binding.room !== event.room) continue;
      if (binding.text) this._post(binding.text, `Now playing ${describe(event.track)}${credit(event.entry.curator && event.entry.curator.name, event.entry.auto)}`);
      if (binding.voice) jobs.push(this._playIn(binding, event.room, event.entry.id, event.track, event.startedAt));
    }
    await Promise.all(jobs);
  }

  _onIdle (event) {
    for (const binding of this.bindings.values()) {
      if (binding.room !== event.room || !binding.voice) continue;
      try {
        Promise.resolve(this.doorman.voice(binding.voice).stop()).catch((error) => this._error(error));
      } catch (error) {
        this._error(error);
      }
    }
  }

  async _playIn (binding, room, entry, track, startedAt) {
    let handle;
    try {
      handle = this.doorman.voice(binding.voice);
    } catch (error) {
      return this._error(error);
    }
    if (!handle.listenerCount('error')) handle.on('error', (error) => this._error(error));
    let stream;
    try {
      stream = await this.soundtrack.stream(track);
    } catch (error) {
      this._error(`could not get audio for ${track.title}: ${error.message}`);
      await this.soundtrack.reportDown(room, entry, error.message).catch((failure) => this._error(failure));
      return;
    }
    const seek = Math.max(0, (Date.now() - startedAt) / 1000);
    try {
      await handle.play({ url: stream.url, headers: stream.headers, seek, meta: { room, entry } });
    } catch (error) {
      this._error(`could not play in ${binding.voice}: ${error.message}`);
    }
  }

  /**
   * After the bot reconnects, pick up every bound room that is playing.
   * @returns {Promise<void>}
   */
  async resume () {
    for (const binding of this.bindings.values()) {
      if (!binding.voice) continue;
      let room;
      try {
        room = await this.soundtrack.room(binding.room);
      } catch (_) {
        continue;
      }
      if (room.current) await this._playIn(binding, binding.room, room.current.id, room.current.track, room.current.startedAt);
    }
  }

  _post (target, content) {
    this.emit('message', { target, object: { content, allowedMentions: NO_PINGS } });
  }

  _link (room) {
    return this.settings.siteUrl ? `\n<${this.settings.siteUrl.replace(/\/$/, '')}/rooms/${room}>` : '';
  }

  _person (invocation) {
    return { id: accountKey(invocation.user), name: invocation.userName || 'Someone' };
  }

  _canManage (invocation) {
    const permissions = invocation.permissions || [];
    return permissions.includes('ManageChannels') || permissions.includes('Administrator');
  }

  // Commands

  async play (invocation) {
    if (!invocation.guild) return { content: 'Use /play in a server.', ephemeral: true };
    if (typeof invocation.defer === 'function') await invocation.defer({ ephemeral: false });
    const room = this.roomFor(invocation.guild);
    try {
      const binding = this.binding(invocation.guild);
      if ((!binding || !binding.voice) && invocation.voice) {
        await this._bind(invocation.guild, { room, voice: invocation.voice, text: invocation.channel });
      }
      const entry = await this.soundtrack.enqueue(room, String((invocation.options || {}).song || ''), this._person(invocation));
      const view = await this.soundtrack.room(room);
      const playing = view.current && view.current.id === entry.id;
      const place = view.queue.findIndex((item) => item.id === entry.id) + 1;
      const where = playing ? 'playing now' : `#${place} in the queue`;
      const voice = this.binding(invocation.guild) && this.binding(invocation.guild).voice;
      const hint = voice ? '' : '\nJoin a voice channel and run /join to listen here.';
      return { content: `Added ${describe(entry.track)}, ${where}.${hint}` };
    } catch (error) {
      return errorReply(error);
    }
  }

  async queue (invocation) {
    const room = this.roomFor(invocation.guild);
    try {
      const view = await this.soundtrack.room(room, accountKey(invocation.user));
      const lines = [`**${escape(view.name)}**`];
      if (view.current) lines.push(`Now: ${describe(view.current.track)} (${clock(view.current.position)} in)`);
      else lines.push('Nothing is playing. Add something with /play.');
      view.queue.slice(0, MAX_LIST).forEach((entry, index) => {
        lines.push(`${index + 1}. ${describe(entry.track)}, ${entry.score >= 0 ? '+' : ''}${entry.score}${entry.curator ? `, from ${escape(entry.curator)}` : ''}`);
      });
      if (view.queue.length > MAX_LIST) lines.push(`…and ${view.queue.length - MAX_LIST} more.`);
      return { content: lines.join('\n') + this._link(room), ephemeral: true };
    } catch (error) {
      return errorReply(error);
    }
  }

  async nowPlaying (invocation) {
    const room = this.roomFor(invocation.guild);
    try {
      const view = await this.soundtrack.room(room);
      if (!view.current) return { content: 'Nothing is playing. Add something with /play.', ephemeral: true };
      const current = view.current;
      return {
        content: `Now playing ${describe(current.track)}, ${clock(current.position)} in` +
          `${credit(current.curator, current.auto)}.${this._link(room)}`
      };
    } catch (error) {
      return errorReply(error);
    }
  }

  async upcomingChoices (invocation) {
    let view;
    try {
      view = await this.soundtrack.room(this.roomFor(invocation.guild));
    } catch (_) {
      return [];
    }
    const query = String(invocation.focused && invocation.focused.value ? invocation.focused.value : '').toLowerCase();
    return view.queue
      .filter((entry) => !query || `${entry.track.title} ${entry.track.artist || ''}`.toLowerCase().includes(query))
      .slice(0, MAX_CHOICES)
      .map((entry) => ({ name: `${entry.track.title}${entry.track.artist ? ` by ${entry.track.artist}` : ''} (${entry.score >= 0 ? '+' : ''}${entry.score})`.slice(0, 100), value: entry.id }));
  }

  async vote (invocation) {
    const options = invocation.options || {};
    const value = { up: 1, down: -1, clear: 0 }[options.vote];
    if (value === undefined) return { content: 'Vote up, down, or clear.', ephemeral: true };
    try {
      const entry = await this.soundtrack.vote(this.roomFor(invocation.guild), String(options.song || ''), accountKey(invocation.user), value);
      return { content: `${describe(entry.track)} is at ${entry.score >= 0 ? '+' : ''}${entry.score}.`, ephemeral: true };
    } catch (error) {
      return errorReply(error);
    }
  }

  async skip (invocation) {
    const room = this.roomFor(invocation.guild);
    const caller = accountKey(invocation.user);
    try {
      const view = await this.soundtrack.room(room, caller);
      if (!view.current) return { content: 'Nothing is playing.', ephemeral: true };
      const binding = this.binding(invocation.guild);
      let allowed = (view.you && view.you.canSkip) || this._canManage(invocation);
      let tally = '';
      if (!allowed) {
        if (!binding || !binding.voice || invocation.voice !== binding.voice) {
          return { content: 'Only whoever added this song, the room\'s moderators, or someone who can manage channels can skip it; listeners in the voice channel can vote to.', ephemeral: true };
        }
        const listeners = this.listeners(binding.voice);
        let votes = this.skipVotes.get(room);
        if (!votes || votes.entry !== view.current.id) {
          votes = { entry: view.current.id, voters: new Set() };
          this.skipVotes.set(room, votes);
        }
        votes.voters.add(invocation.user);
        const counted = [...votes.voters].filter((user) => listeners.includes(user)).length;
        const needed = Math.floor(listeners.length / 2) + 1;
        allowed = counted >= needed;
        tally = `${counted} of ${needed}`;
        if (!allowed) return { content: `Vote to skip counted (${tally} needed).` };
      }
      this.skipVotes.delete(room);
      const next = await this.soundtrack.skip(room, this._person(invocation));
      const after = next ? ` Next: ${describe(next.track)}.` : ' The queue is empty.';
      return { content: `Skipped ${describe(view.current.track)}${tally ? ` (${tally} votes)` : ''}.${after}` };
    } catch (error) {
      return errorReply(error);
    }
  }

  async roomChoices (invocation) {
    const query = String(invocation.focused && invocation.focused.value ? invocation.focused.value : '').toLowerCase();
    const rooms = await this.soundtrack.rooms();
    return rooms
      .filter((room) => !query || room.name.toLowerCase().includes(query) || room.slug.includes(query))
      .slice(0, MAX_CHOICES)
      .map((room) => ({ name: room.name.slice(0, 100), value: room.slug }));
  }

  async join (invocation) {
    if (!invocation.guild) return { content: 'Use /join in a server.', ephemeral: true };
    const options = invocation.options || {};
    const voice = options.channel ? `${this.settings.service}/channels/${options.channel}` : invocation.voice;
    if (!voice) return { content: 'Join a voice channel first, or name one.', ephemeral: true };
    const current = this.binding(invocation.guild);
    if (current && current.voice && current.voice !== voice && this.listeners(current.voice).length && !this._canManage(invocation)) {
      return { content: 'People are listening in another channel; someone who can manage channels can move the bot.', ephemeral: true };
    }
    if (typeof invocation.defer === 'function') await invocation.defer({ ephemeral: false });
    const room = options.room ? String(options.room) : this.roomFor(invocation.guild);
    let view;
    try {
      view = await this.soundtrack.room(room);
    } catch (error) {
      return errorReply(error);
    }
    if (current && current.voice && current.voice !== voice) {
      try {
        await this.doorman.voice(current.voice).leave();
      } catch (_) { /* not connected */ }
    }
    const binding = await this._bind(invocation.guild, { room, voice, text: invocation.channel });
    try {
      const handle = this.doorman.voice(voice);
      await handle.join();
    } catch (error) {
      await this._bind(invocation.guild, { voice: null });
      return { content: `Could not join that channel: ${error.message}`, ephemeral: true };
    }
    if (view.current) await this._playIn(binding, room, view.current.id, view.current.track, view.current.startedAt);
    else if (await this.soundtrack.wake(room).catch(() => false)) view = await this.soundtrack.room(room);
    const playing = view.current ? ` Playing ${describe(view.current.track)}.` : ' The queue is empty; add something with /play.';
    return { content: `Playing **${escape(view.name)}** in <#${voice.split('/')[2]}>, songs posted here.${playing}` };
  }

  async leave (invocation) {
    const binding = invocation.guild ? this.binding(invocation.guild) : null;
    if (!binding || !binding.voice) return { content: 'Not playing in voice here.', ephemeral: true };
    const others = this.listeners(binding.voice).filter((user) => user !== invocation.user);
    if (others.length && !this._canManage(invocation)) {
      return { content: 'Others are still listening; someone who can manage channels can stop it.', ephemeral: true };
    }
    try {
      await this.doorman.voice(binding.voice).leave();
    } catch (_) { /* not connected */ }
    await this._bind(invocation.guild, { voice: null, text: null });
    return { content: 'Stopped playing in voice.' };
  }
}

module.exports = SoundtrackDiscord;
module.exports.accountKey = accountKey;
module.exports.clock = clock;
