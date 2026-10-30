'use strict';

const EventEmitter = require('events');
const Store = require('@fabric/core/types/store');
const startStore = require('../functions/startStore');
const Queue = require('../functions/queue');
const { trackId, entryId } = require('../functions/trackId');

const INDEX_KEY = '/index/rooms';
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

/**
 * An error with an HTTP status, so routes and commands can answer plainly.
 * @private
 */
function failure (status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

/**
 * A room slug for a name: lowercase letters, digits, and dashes. All-digit
 * slugs get a `room-` prefix (Store paths read digit-only segments as array
 * indexes).
 * @param {string} name
 * @returns {string}
 */
function slugify (name) {
  const slug = String(name || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48).replace(/-+$/, '');
  if (!slug) return 'room';
  return /^\d+$/.test(slug) ? `room-${slug}`.slice(0, 48) : slug;
}

function trackSummary (track) {
  return {
    id: track.id,
    source: track.source,
    title: track.title,
    artist: track.artist || null,
    duration: track.duration,
    thumbnail: track.thumbnail || null
  };
}

/**
 * Rooms where people listen together: each has a queue that everyone adds to
 * and votes on, and a clock that plays it in order, the same moment for every
 * listener (web page or Discord voice channel). Kept in a Fabric Store.
 *
 * Events: `play { room, entry, track, startedAt }`, `idle { room }`,
 * `queue { room }`, `chat { room, message }`, `room { room }`, `error`.
 * People are `{ id, name }`, `id` an account key such as `discord:<id>`;
 * views carry names only.
 */
class Soundtrack extends EventEmitter {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.path] Store directory.
   * @param {{ slug: string, name: string }} [settings.room] Room made on start.
   * @param {Object} [settings.queue] `{ maxEntries, maxDuration, maxPerCurator }`.
   * @param {Object} settings.resolver `lookup(input)` and `stream(track)` (see Resolver).
   * @param {Function} [settings.now] Clock (tests).
   * @param {Function} [settings.setTimeout] Timer (tests).
   * @param {Function} [settings.clearTimeout] Timer (tests).
   */
  constructor (settings = {}) {
    super();
    this.settings = Object.assign({
      path: './stores/soundtrack',
      room: { slug: 'lobby', name: 'Lobby' },
      queue: {},
      resolver: null,
      chatHistory: 200,
      playHistory: 500,
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (timer) => clearTimeout(timer)
    }, Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)));
    this.limits = Object.assign({ maxEntries: 200, maxDuration: 20 * 60, maxPerCurator: 10 }, this.settings.queue);
    this.resolver = this.settings.resolver;
    this.store = null;
    this._queue = Promise.resolve();
    this._rooms = [];
    this._timers = new Map();
  }

  get defaultRoom () {
    return this.settings.room && this.settings.room.slug;
  }

  async start () {
    this.store = new Store({ name: 'SOUNDTRACK', path: this.settings.path, persistent: true, verbosity: 1 });
    await startStore(this.store);
    const index = await this.store.get(INDEX_KEY);
    this._rooms = (index && Array.isArray(index.slugs)) ? [...index.slugs] : [];
    const room = this.settings.room;
    if (room && room.slug && !this._rooms.includes(room.slug)) {
      await this._serial(() => this._createRoom({ slug: room.slug, name: room.name || room.slug }, null));
    }
    await this._serial(async () => {
      const now = this.settings.now();
      for (const slug of this._rooms) {
        const queue = await this._readQueue(slug);
        const end = Queue.endsAt(queue);
        if (queue.current && end <= now) await this._next(slug, queue, { ended: true });
        else if (queue.current) this._schedule(slug, queue);
      }
    });
    return this;
  }

  async stop () {
    for (const timer of this._timers.values()) this.settings.clearTimeout(timer);
    this._timers.clear();
    await this._queue.catch(() => {});
    if (this.store) await this.store.stop();
    return this;
  }

  _serial (fn) {
    const run = this._queue.then(fn, fn);
    this._queue = run.catch(() => {});
    return run;
  }

  async _read (key, fallback) {
    const value = await this.store.get(key);
    return value && typeof value === 'object' ? structuredClone(value) : fallback;
  }

  async _readQueue (slug) {
    const queue = await this._read(`/queues/${slug}`, null);
    return queue && Array.isArray(queue.entries) ? queue : Queue.emptyQueue();
  }

  async _room (slug) {
    const room = SLUG.test(String(slug || '')) && this._rooms.includes(slug) ? await this._read(`/rooms/${slug}`, null) : null;
    if (!room) throw failure(404, 'No such room.');
    return room;
  }

  // Rooms

  /**
   * Every room, with what it is playing.
   * @returns {Promise<Array>}
   */
  async rooms () {
    const list = [];
    for (const slug of this._rooms) {
      const room = await this._read(`/rooms/${slug}`, null);
      if (!room) continue;
      const queue = await this._readQueue(slug);
      list.push({
        slug,
        name: room.name,
        description: room.description || '',
        createdBy: room.createdBy || null,
        current: queue.current ? trackSummary(queue.current.entry.track) : null,
        upcoming: queue.entries.length
      });
    }
    return list;
  }

  /**
   * One room: details, what is playing (and how far in), the queue in play order.
   * @param {string} slug
   * @param {string} [viewer] Account key; adds that person's own votes and entries.
   * @returns {Promise<Object>}
   */
  async room (slug, viewer = null) {
    const room = await this._room(slug);
    const queue = await this._readQueue(slug);
    const now = this.settings.now();
    return {
      slug,
      name: room.name,
      description: room.description || '',
      createdAt: room.createdAt,
      now,
      current: queue.current
        ? { ...this._entryView(queue.current.entry, viewer), startedAt: queue.current.startedAt, position: Queue.position(queue, now) }
        : null,
      queue: queue.entries.map((entry) => this._entryView(entry, viewer))
    };
  }

  _entryView (entry, viewer) {
    const votes = Object.values(entry.votes || {});
    return {
      id: entry.id,
      track: entry.track,
      curator: entry.curator ? entry.curator.name : null,
      requestedAt: entry.requestedAt,
      score: Queue.score(entry),
      up: votes.filter((value) => value > 0).length,
      down: votes.filter((value) => value < 0).length,
      yours: viewer ? ((entry.votes || {})[viewer] || 0) : 0,
      mine: !!(viewer && entry.curator && entry.curator.id === viewer)
    };
  }

  /**
   * Make a room.
   * @param {{ name: string, description?: string, slug?: string }} details
   * @param {{ id: string, name: string }|null} creator
   * @returns {Promise<Object>} the room
   */
  async createRoom (details, creator) {
    return this._serial(() => this._createRoom(details, creator));
  }

  async _createRoom (details = {}, creator) {
    const name = String(details.name || '').trim().slice(0, 64);
    if (!name) throw failure(400, 'A room needs a name.');
    const slug = details.slug ? String(details.slug) : slugify(name);
    if (!SLUG.test(slug) || /^\d+$/.test(slug)) throw failure(400, 'Room slugs are lowercase letters, digits, and dashes.');
    if (this._rooms.includes(slug)) throw failure(409, 'A room with that name already exists.');
    const room = {
      slug,
      name,
      description: String(details.description || '').trim().slice(0, 280),
      createdAt: this.settings.now(),
      createdBy: creator ? creator.name : null
    };
    await this.store.set(`/rooms/${slug}`, room);
    await this.store.set(`/queues/${slug}`, Queue.emptyQueue());
    this._rooms.push(slug);
    await this.store.set(INDEX_KEY, { slugs: [...this._rooms] });
    this.emit('room', { room: slug });
    return room;
  }

  // Queue

  /**
   * Find what someone asked for and add it to a room's queue. An idle room
   * starts playing it.
   * @param {string} slug
   * @param {string} input A link or search text.
   * @param {{ id: string, name: string }} curator
   * @returns {Promise<Object>} the entry (view)
   */
  async enqueue (slug, input, curator) {
    if (!curator || !curator.id) throw failure(401, 'Sign in to add songs.');
    await this._room(slug);
    if (!this.resolver) throw failure(503, 'Adding songs is not set up.');
    let found;
    try {
      found = await this.resolver.lookup(input);
    } catch (error) {
      throw failure(400, error.message);
    }
    if (found.live || !Number.isFinite(found.duration) || found.duration <= 0) {
      throw failure(400, 'Live streams and songs without a length can\'t be queued.');
    }
    if (found.duration > this.limits.maxDuration) {
      throw failure(400, `Songs are at most ${Math.round(this.limits.maxDuration / 60)} minutes long.`);
    }
    return this._serial(async () => {
      const queue = await this._readQueue(slug);
      const id = trackId(found.source);
      if ((queue.current && queue.current.entry.track.id === id) || queue.entries.some((entry) => entry.track.id === id)) {
        throw failure(409, 'That song is already in the queue.');
      }
      if (queue.entries.length >= this.limits.maxEntries) throw failure(409, 'The queue is full.');
      if (queue.entries.filter((entry) => entry.curator && entry.curator.id === curator.id).length >= this.limits.maxPerCurator) {
        throw failure(409, `You already have ${this.limits.maxPerCurator} songs waiting.`);
      }
      const now = this.settings.now();
      const stored = await this._read(`/tracks/${id}`, null);
      const track = Object.assign(stored || { id, firstSeenAt: now, plays: 0, lastPlayedAt: null }, {
        source: found.source,
        title: found.title,
        artist: found.artist,
        duration: found.duration,
        thumbnail: found.thumbnail,
        down: null
      });
      await this.store.set(`/tracks/${id}`, track);
      const entry = {
        id: entryId(),
        track: trackSummary(track),
        curator: { id: String(curator.id), name: String(curator.name || 'Someone') },
        requestedAt: now,
        votes: {}
      };
      const next = Queue.enqueue(queue, entry);
      if (!next.current) await this._next(slug, next, {});
      else await this._save(slug, next);
      return this._entryView(entry, curator.id);
    });
  }

  /**
   * Vote on an upcoming song: 1 up, -1 down, 0 to take your vote back.
   * @param {string} slug
   * @param {string} id Entry id.
   * @param {string} voter Account key.
   * @param {number} value
   * @returns {Promise<Object>} the entry (view)
   */
  async vote (slug, id, voter, value) {
    if (!voter) throw failure(401, 'Sign in to vote.');
    await this._room(slug);
    return this._serial(async () => {
      let queue = await this._readQueue(slug);
      try {
        queue = Queue.vote(queue, id, voter, Number(value));
      } catch (error) {
        throw failure(error.message.startsWith('A vote') ? 400 : 404, error.message);
      }
      await this._save(slug, queue);
      return this._entryView(queue.entries.find((entry) => entry.id === id), voter);
    });
  }

  /**
   * Take an upcoming song out of the queue: its curator may, and so may
   * anyone the caller has decided can moderate (`force`).
   * @param {string} slug
   * @param {string} id Entry id.
   * @param {string} by Account key.
   * @param {Object} [options]
   * @param {boolean} [options.force]
   * @returns {Promise<boolean>}
   */
  async remove (slug, id, by, options = {}) {
    await this._room(slug);
    return this._serial(async () => {
      const queue = await this._readQueue(slug);
      const entry = queue.entries.find((item) => item.id === id);
      if (!entry) throw failure(404, 'That song is not in the queue.');
      if (!options.force && !(entry.curator && entry.curator.id === by)) throw failure(403, 'Only whoever added it can take it out.');
      await this._save(slug, Queue.remove(queue, id));
      return true;
    });
  }

  /**
   * Skip what is playing. Who may skip is up to the caller.
   * @param {string} slug
   * @param {{ name: string }} [by]
   * @returns {Promise<Object|null>} what plays next (view), or null.
   */
  async skip (slug, by) {
    await this._room(slug);
    return this._serial(async () => {
      const queue = await this._readQueue(slug);
      if (!queue.current) throw failure(409, 'Nothing is playing.');
      const next = await this._next(slug, queue, { skipped: true, by: by ? by.name : null });
      return next.current ? this._entryView(next.current.entry, null) : null;
    });
  }

  /**
   * A player could not play this entry (the source is gone or refuses us):
   * mark its track down and move on. Ignored once that entry is no longer current.
   * @param {string} slug
   * @param {string} id Entry id.
   * @param {string} reason
   * @returns {Promise<boolean>} whether it was skipped
   */
  async reportDown (slug, id, reason) {
    await this._room(slug);
    return this._serial(async () => {
      const queue = await this._readQueue(slug);
      if (!queue.current || queue.current.entry.id !== id) return false;
      const key = `/tracks/${queue.current.entry.track.id}`;
      const track = await this._read(key, null);
      if (track) await this.store.set(key, { ...track, down: { at: this.settings.now(), reason: String(reason || '').slice(0, 200) } });
      await this._next(slug, queue, { down: true });
      return true;
    });
  }

  /**
   * Where to fetch a track's audio right now.
   * @param {Object} track Track (or summary) with `source`.
   * @returns {Promise<{ url: string, headers: Object }>}
   */
  async stream (track) {
    if (!this.resolver) throw new Error('Playback is not set up.');
    return this.resolver.stream(track);
  }

  async _save (slug, queue) {
    await this.store.set(`/queues/${slug}`, queue);
    this.emit('queue', { room: slug });
  }

  // Close out what is playing (if anything) and start the next entry.
  async _next (slug, queue, outcome) {
    const now = this.settings.now();
    if (queue.current) await this._closePlay(slug, queue.current, now, outcome);
    const next = Queue.advance(queue, now);
    await this.store.set(`/queues/${slug}`, next);
    if (next.current) {
      const key = `/tracks/${next.current.entry.track.id}`;
      const track = await this._read(key, null);
      if (track) await this.store.set(key, { ...track, plays: (track.plays || 0) + 1, lastPlayedAt: now });
      await this._openPlay(slug, next.current);
      this._schedule(slug, next);
      this.emit('play', { room: slug, entry: next.current.entry, track: next.current.entry.track, startedAt: next.current.startedAt });
    } else {
      this._unschedule(slug);
      this.emit('idle', { room: slug });
    }
    this.emit('queue', { room: slug });
    return next;
  }

  async _openPlay (slug, current) {
    const record = await this._read(`/plays/${slug}`, { plays: [] });
    record.plays.unshift({
      entry: current.entry.id,
      track: current.entry.track,
      curator: current.entry.curator ? current.entry.curator.name : null,
      score: Queue.score(current.entry),
      startedAt: current.startedAt,
      endedAt: null
    });
    record.plays = record.plays.slice(0, this.settings.playHistory);
    await this.store.set(`/plays/${slug}`, record);
  }

  async _closePlay (slug, current, now, outcome = {}) {
    const record = await this._read(`/plays/${slug}`, { plays: [] });
    const play = record.plays.find((item) => item.entry === current.entry.id);
    if (!play) return;
    play.endedAt = now;
    if (outcome.skipped) play.skipped = { by: outcome.by || null };
    if (outcome.down) play.down = true;
    await this.store.set(`/plays/${slug}`, record);
  }

  _schedule (slug, queue) {
    this._unschedule(slug);
    const end = Queue.endsAt(queue);
    if (end === null) return;
    const id = queue.current.entry.id;
    const timer = this.settings.setTimeout(() => {
      this._timers.delete(slug);
      return this._serial(async () => {
        const latest = await this._readQueue(slug);
        if (latest.current && latest.current.entry.id === id) await this._next(slug, latest, { ended: true });
      }).catch((error) => this.emit('error', error));
    }, Math.max(0, end - this.settings.now()));
    if (timer && typeof timer.unref === 'function') timer.unref();
    this._timers.set(slug, timer);
  }

  _unschedule (slug) {
    const timer = this._timers.get(slug);
    if (timer !== undefined) this.settings.clearTimeout(timer);
    this._timers.delete(slug);
  }

  // History and chat

  /**
   * What a room played, newest first.
   * @param {string} slug
   * @param {number} [limit]
   * @returns {Promise<Array>}
   */
  async plays (slug, limit = 50) {
    await this._room(slug);
    const record = await this._read(`/plays/${slug}`, { plays: [] });
    return record.plays.slice(0, Math.max(1, Math.min(Number(limit) || 50, this.settings.playHistory)));
  }

  /**
   * A track and how often it was played.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async track (id) {
    if (!/^[0-9a-f]{64}$/.test(String(id))) return null;
    const track = await this._read(`/tracks/${id}`, null);
    if (!track) return null;
    return { ...trackSummary(track), plays: track.plays || 0, firstSeenAt: track.firstSeenAt, lastPlayedAt: track.lastPlayedAt, down: !!track.down };
  }

  /**
   * Say something in a room.
   * @param {string} slug
   * @param {{ id: string, name: string }} author
   * @param {string} text
   * @returns {Promise<Object>} the message (view)
   */
  async chat (slug, author, text) {
    if (!author || !author.id) throw failure(401, 'Sign in to chat.');
    const body = String(text || '').trim().slice(0, 500);
    if (!body) throw failure(400, 'Say something.');
    await this._room(slug);
    return this._serial(async () => {
      const record = await this._read(`/chat/${slug}`, { messages: [] });
      const message = { id: entryId(), author: { id: String(author.id), name: String(author.name || 'Someone') }, text: body, at: this.settings.now() };
      record.messages.push(message);
      record.messages = record.messages.slice(-this.settings.chatHistory);
      await this.store.set(`/chat/${slug}`, record);
      const view = this._messageView(message);
      this.emit('chat', { room: slug, message: view });
      return view;
    });
  }

  /**
   * A room's recent chat, oldest first.
   * @param {string} slug
   * @param {number} [limit]
   * @returns {Promise<Array>}
   */
  async messages (slug, limit = 50) {
    await this._room(slug);
    const record = await this._read(`/chat/${slug}`, { messages: [] });
    return record.messages.slice(-Math.max(1, Math.min(Number(limit) || 50, this.settings.chatHistory))).map((message) => this._messageView(message));
  }

  _messageView (message) {
    return { id: message.id, author: message.author.name, text: message.text, at: message.at };
  }

  // Records for plugins (e.g. Discord bindings), under `/plugins/<name>/…`.

  async record (name, key) {
    return this._read(`/plugins/${name}/${key}`, null);
  }

  async saveRecord (name, key, value) {
    return this._serial(() => this.store.set(`/plugins/${name}/${key}`, value));
  }
}

module.exports = Soundtrack;
module.exports.slugify = slugify;
module.exports.failure = failure;
