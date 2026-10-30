'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');
const Store = require('@fabric/core/types/store');
const startStore = require('../functions/startStore');
const Queue = require('../functions/queue');
const { trackId, entryId } = require('../functions/trackId');

const INDEX_KEY = '/index/rooms';
const SECRET_KEY = '/secret';
const SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const PERSON = /^[0-9a-f]{16}$/;
const SET = /^[0-9a-f]{12}$/;
const TRACK = /^[0-9a-f]{64}$/;
const HOUR = 60 * 60 * 1000;

// Who may do what in a room, besides its moderators (who may do everything).
// `curator`: whoever added that song (anyone may skip an auto-DJ pick).
const PERMISSIONS = {
  add: ['everyone', 'moderators'],
  skip: ['curator', 'everyone', 'moderators'],
  remove: ['curator', 'moderators']
};
const DEFAULT_PERMISSIONS = { add: 'everyone', skip: 'curator', remove: 'curator' };

const MAX_MODERATORS = 50;
const MAX_BANS = 500;
const MAX_SETS = 50;
const MAX_SET_TRACKS = 500;
const MAX_TOP = 500;
const MAX_RECENT = 100;
const MAX_POOL = 1000;

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

function text (value, max) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

/**
 * Rooms where people listen together: each has a queue that everyone adds to
 * and votes on, and a clock that plays it in order, the same moment for every
 * listener (web page, stream, or Discord voice channel). Kept in a Fabric Store.
 *
 * When a room's queue runs out and someone is listening, the auto-DJ plays a
 * song people chose there before (not one played in the last few hours).
 * Rooms have an owner, moderators, bans, and rules for who may add, skip, and
 * take songs out. Everyone who adds a song gets a listener page (their top
 * plays and history) and may keep sets of songs to queue later.
 *
 * Events: `play { room, entry, track, startedAt }`, `ended { room, entry,
 * track, curator, auto, startedAt, endedAt, skipped, down }`, `idle { room }`,
 * `queue { room }`, `chat { room, message }`, `room { room }`, `error`.
 * People are `{ id, name }`, `id` an account key such as `fabric:<x-only>` or
 * `discord:<id>`. Views carry names and listener ids (an HMAC of the account
 * key under a secret kept in the Store), never account keys.
 */
class Soundtrack extends EventEmitter {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.path] Store directory.
   * @param {{ slug: string, name: string }} [settings.room] Room made on start.
   * @param {Object} [settings.queue] `{ maxEntries, maxDuration, maxPerCurator }`.
   * @param {Object} [settings.autoplay] `{ enabled, recentMs }` for the auto-DJ.
   * @param {string[]} [settings.admins] Account keys that moderate every room.
   * @param {Object} settings.resolver `lookup(input)` and `stream(track)` (see Resolver).
   * @param {Function} [settings.now] Clock (tests).
   * @param {Function} [settings.random] `() => [0, 1)` (tests).
   * @param {Function} [settings.setTimeout] Timer (tests).
   * @param {Function} [settings.clearTimeout] Timer (tests).
   */
  constructor (settings = {}) {
    super();
    this.settings = Object.assign({
      path: './stores/soundtrack',
      room: { slug: 'lobby', name: 'Lobby' },
      queue: {},
      autoplay: {},
      admins: [],
      resolver: null,
      chatHistory: 200,
      playHistory: 500,
      now: () => Date.now(),
      random: () => Math.random(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (timer) => clearTimeout(timer)
    }, Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)));
    this.limits = Object.assign({ maxEntries: 200, maxDuration: 20 * 60, maxPerCurator: 10 }, this.settings.queue);
    this.autoplay = Object.assign({ enabled: true, recentMs: 3 * HOUR }, this.settings.autoplay);
    this.resolver = this.settings.resolver;
    this.store = null;
    this._secret = null;
    this._queue = Promise.resolve();
    this._rooms = [];
    this._timers = new Map();
    this._audiences = new Set();
  }

  get defaultRoom () {
    return this.settings.room && this.settings.room.slug;
  }

  async start () {
    this.store = new Store({ name: 'SOUNDTRACK', path: this.settings.path, persistent: true, verbosity: 1 });
    await startStore(this.store);
    const secret = await this.store.get(SECRET_KEY);
    if (secret && /^[0-9a-f]{64}$/.test(secret.key)) {
      this._secret = secret.key;
    } else {
      this._secret = crypto.randomBytes(32).toString('hex');
      await this.store.set(SECRET_KEY, { key: this._secret });
    }
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

  // Audience: who can hear a room right now, so the auto-DJ plays only for
  // someone. With no audience registered (a bare service), rooms count as heard.

  /**
   * Count a room's listeners from somewhere (web pages, the stream, Discord voice).
   * @param {function(string): number} count
   * @returns {function(): void} removes it
   */
  addAudience (count) {
    this._audiences.add(count);
    return () => this._audiences.delete(count);
  }

  _heard (slug) {
    if (!this._audiences.size) return true;
    let total = 0;
    for (const count of this._audiences) {
      try {
        total += Number(count(slug)) || 0;
      } catch (_) { /* a broken counter counts nobody */ }
    }
    return total > 0;
  }

  /**
   * Someone started listening: an idle room with songs in its pool starts
   * the auto-DJ.
   * @param {string} slug
   * @returns {Promise<boolean>} whether something started
   */
  async wake (slug) {
    if (!this._rooms.includes(slug)) return false;
    return this._serial(async () => {
      const queue = await this._readQueue(slug);
      if (queue.current || queue.entries.length) return false;
      const now = this.settings.now();
      const entry = await this._autoPick(slug, now);
      if (!entry) return false;
      await this._begin(slug, { current: { entry, startedAt: now }, entries: [] }, now);
      return true;
    });
  }

  // People

  /**
   * The public listener id for an account key: stable, and not the key.
   * @param {string} account
   * @returns {string|null} 16 hex characters
   */
  personId (account) {
    if (!account || !this._secret) return null;
    return crypto.createHmac('sha256', this._secret).update(`person:${account}`).digest('hex').slice(0, 16);
  }

  _personKey (id) {
    return `/people/p${id}`;
  }

  // Remember someone who acted, and their latest name. Inside `_serial`.
  async _touch (person) {
    if (!person || !person.id) return null;
    const id = this.personId(String(person.id));
    const key = this._personKey(id);
    let record = await this._read(key, null);
    let changed = false;
    if (!record) {
      record = { id, account: String(person.id), name: null, since: this.settings.now(), plays: 0, top: {}, recent: [], sets: [] };
      changed = true;
    }
    const name = text(person.name, 64);
    if (name && record.name !== name) {
      record.name = name;
      changed = true;
    }
    if (changed) await this.store.set(key, record);
    return record;
  }

  /**
   * Give someone who signed in a listener page, under their latest name.
   * @param {{ id: string, name: string }} user
   * @returns {Promise<string|null>} their listener id
   */
  async remember (user) {
    if (!user || !user.id) return null;
    const record = await this._serial(() => this._touch(user));
    return record.id;
  }

  async _personRef (account) {
    const id = this.personId(account);
    const record = await this._read(this._personKey(id), null);
    return { id, name: (record && record.name) || 'Someone' };
  }

  async _account (personId) {
    if (!PERSON.test(String(personId || ''))) return null;
    const record = await this._read(this._personKey(personId), null);
    return record ? record.account : null;
  }

  // Credit a play to whoever chose it. Inside `_serial`.
  async _credit (curator, track, slug, now) {
    if (!curator || !curator.id) return;
    const record = await this._touch(curator);
    record.plays = (record.plays || 0) + 1;
    record.top = record.top || {};
    record.top[track.id] = (record.top[track.id] || 0) + 1;
    const ids = Object.keys(record.top);
    if (ids.length > MAX_TOP) {
      ids.sort((a, b) => record.top[a] - record.top[b]).slice(0, ids.length - MAX_TOP).forEach((id) => { delete record.top[id]; });
    }
    record.recent = [{ track: trackSummary(track), room: slug, at: now }, ...(record.recent || [])].slice(0, MAX_RECENT);
    await this.store.set(this._personKey(record.id), record);
  }

  /**
   * Someone's listener page: name, top plays (songs they chose, by how
   * often they played), what they chose lately, their sets, and the rooms
   * they run.
   * @param {string} id Listener id.
   * @param {string} [viewer] Account key; `you` is true on their own page.
   * @returns {Promise<Object|null>}
   */
  async person (id, viewer = null) {
    if (!PERSON.test(String(id || ''))) return null;
    const record = await this._read(this._personKey(id), null);
    if (!record) return null;
    const top = [];
    for (const [track, plays] of Object.entries(record.top || {}).sort((a, b) => b[1] - a[1]).slice(0, 25)) {
      const stored = await this._read(`/tracks/${track}`, null);
      if (stored) top.push({ track: trackSummary(stored), plays });
    }
    const sets = [];
    for (const setId of record.sets || []) {
      const set = await this._read(`/sets/s${setId}`, null);
      if (set && !set.deleted) sets.push({ id: setId, name: set.name, size: set.tracks.length });
    }
    const rooms = [];
    for (const slug of this._rooms) {
      const room = await this._read(`/rooms/${slug}`, null);
      if (!room) continue;
      const role = room.owner === record.account ? 'owner' : (room.moderators || []).includes(record.account) ? 'moderator' : null;
      if (role) rooms.push({ slug, name: room.name, role });
    }
    const names = new Map();
    for (const slug of new Set((record.recent || []).map((play) => play.room))) {
      const room = await this._read(`/rooms/${slug}`, null);
      if (room) names.set(slug, room.name);
    }
    return {
      id,
      name: record.name || 'Someone',
      since: record.since,
      plays: record.plays || 0,
      top,
      recent: (record.recent || []).slice(0, 50).map((play) => ({ track: play.track, room: play.room, roomName: names.get(play.room) || play.room, at: play.at })),
      sets,
      rooms,
      you: !!viewer && viewer === record.account
    };
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

  _role (room, account) {
    if (!account) return null;
    if ((this.settings.admins || []).includes(account)) return 'admin';
    if (room.owner && room.owner === account) return 'owner';
    if ((room.moderators || []).includes(account)) return 'moderator';
    return null;
  }

  _banned (room, account) {
    return !!account && ((room.bans && room.bans.people) || []).includes(account);
  }

  _permissions (room) {
    return Object.assign({}, DEFAULT_PERMISSIONS, room.permissions);
  }

  // May `account` do `action` (add, skip, remove) in this room, to `entry`?
  _may (room, account, action, entry = null) {
    if (!account || this._banned(room, account)) return false;
    if (this._role(room, account)) return true;
    const rule = this._permissions(room)[action];
    if (rule === 'everyone') return true;
    if (rule !== 'curator' || !entry) return false;
    if (entry.auto) return action === 'skip';
    return !!(entry.curator && entry.curator.id === account);
  }

  /**
   * Whether someone may skip what a room is playing.
   * @param {string} slug
   * @param {string} account
   * @returns {Promise<boolean>}
   */
  async canSkip (slug, account) {
    const room = await this._room(slug);
    const queue = await this._readQueue(slug);
    return !!queue.current && this._may(room, account, 'skip', queue.current.entry);
  }

  /**
   * One room: details, what is playing (and how far in), the queue in play
   * order, who runs it and its rules; for a viewer, what they may do; for its
   * moderators, its bans.
   * @param {string} slug
   * @param {string} [viewer] Account key.
   * @returns {Promise<Object>}
   */
  async room (slug, viewer = null) {
    const room = await this._room(slug);
    const queue = await this._readQueue(slug);
    const now = this.settings.now();
    const role = this._role(room, viewer);
    const view = {
      slug,
      name: room.name,
      description: room.description || '',
      createdAt: room.createdAt,
      owner: room.owner ? await this._personRef(room.owner) : null,
      moderators: await Promise.all((room.moderators || []).map((account) => this._personRef(account))),
      permissions: this._permissions(room),
      autoplay: room.autoplay !== false,
      now,
      current: queue.current
        ? { ...this._entryView(room, queue.current.entry, viewer), startedAt: queue.current.startedAt, position: Queue.position(queue, now) }
        : null,
      queue: queue.entries.map((entry) => this._entryView(room, entry, viewer)),
      you: viewer
        ? {
            person: this.personId(viewer),
            role,
            banned: this._banned(room, viewer),
            canAdd: this._may(room, viewer, 'add'),
            canSkip: !!queue.current && this._may(room, viewer, 'skip', queue.current.entry)
          }
        : null
    };
    if (role) {
      const bans = room.bans || {};
      const tracks = [];
      for (const id of bans.tracks || []) {
        const track = await this._read(`/tracks/${id}`, null);
        if (track) tracks.push(trackSummary(track));
      }
      view.bans = { tracks, people: await Promise.all((bans.people || []).map((account) => this._personRef(account))) };
    }
    return view;
  }

  _entryView (room, entry, viewer) {
    const votes = Object.values(entry.votes || {});
    return {
      id: entry.id,
      track: entry.track,
      curator: entry.curator ? entry.curator.name : null,
      curatorId: entry.curator ? this.personId(entry.curator.id) : null,
      auto: !!entry.auto,
      requestedAt: entry.requestedAt,
      score: Queue.score(entry),
      up: votes.filter((value) => value > 0).length,
      down: votes.filter((value) => value < 0).length,
      yours: viewer ? ((entry.votes || {})[viewer] || 0) : 0,
      mine: !!(viewer && entry.curator && entry.curator.id === viewer),
      removable: !!viewer && this._may(room, viewer, 'remove', entry)
    };
  }

  /**
   * Make a room; whoever makes it owns it.
   * @param {{ name: string, description?: string, slug?: string }} details
   * @param {{ id: string, name: string }|null} creator
   * @returns {Promise<Object>} the room
   */
  async createRoom (details, creator) {
    return this._serial(() => this._createRoom(details, creator));
  }

  async _createRoom (details = {}, creator) {
    const name = text(details.name, 64);
    if (!name) throw failure(400, 'A room needs a name.');
    const slug = details.slug ? String(details.slug) : slugify(name);
    if (!SLUG.test(slug) || /^\d+$/.test(slug)) throw failure(400, 'Room slugs are lowercase letters, digits, and dashes.');
    if (this._rooms.includes(slug)) throw failure(409, 'A room with that name already exists.');
    if (creator) await this._touch(creator);
    const room = {
      slug,
      name,
      description: text(details.description, 280),
      createdAt: this.settings.now(),
      createdBy: creator ? creator.name : null,
      owner: creator ? String(creator.id) : null,
      moderators: [],
      bans: { tracks: [], people: [] },
      permissions: { ...DEFAULT_PERMISSIONS },
      autoplay: true
    };
    await this.store.set(`/rooms/${slug}`, room);
    await this.store.set(`/queues/${slug}`, Queue.emptyQueue());
    this._rooms.push(slug);
    await this.store.set(INDEX_KEY, { slugs: [...this._rooms] });
    this.emit('room', { room: slug });
    return { slug, name, description: room.description, createdAt: room.createdAt, createdBy: room.createdBy };
  }

  /**
   * Change a room: its moderators may rename it and change its description;
   * its owner also sets who may add, skip, and remove, and the auto-DJ.
   * @param {string} slug
   * @param {{ name?: string, description?: string, permissions?: Object, autoplay?: boolean }} changes
   * @param {string} by Account key.
   * @returns {Promise<Object>} the room (view)
   */
  async updateRoom (slug, changes = {}, by) {
    return this._serial(async () => {
      const room = await this._room(slug);
      const role = this._role(room, by);
      if (!role) throw failure(403, 'Only this room\'s moderators can change it.');
      if (changes.name !== undefined) {
        const name = text(changes.name, 64);
        if (!name) throw failure(400, 'A room needs a name.');
        room.name = name;
      }
      if (changes.description !== undefined) room.description = text(changes.description, 280);
      if (changes.permissions !== undefined || changes.autoplay !== undefined) {
        if (role === 'moderator') throw failure(403, 'Only the room\'s owner can change its rules.');
        if (changes.permissions !== undefined) {
          const permissions = this._permissions(room);
          for (const [action, rule] of Object.entries(changes.permissions || {})) {
            if (!PERMISSIONS[action] || !PERMISSIONS[action].includes(rule)) throw failure(400, `“${action}” can be ${Object.values(PERMISSIONS[action] || []).join(', ') || 'nothing'}.`);
            permissions[action] = rule;
          }
          room.permissions = permissions;
        }
        if (changes.autoplay !== undefined) room.autoplay = !!changes.autoplay;
      }
      await this.store.set(`/rooms/${slug}`, room);
      this.emit('room', { room: slug });
      this.emit('queue', { room: slug });
      return this.room(slug, by);
    });
  }

  /**
   * Make someone a moderator of a room, or not. Only its owner may.
   * @param {string} slug
   * @param {string} personId Listener id.
   * @param {boolean} on
   * @param {string} by Account key.
   * @returns {Promise<Array>} the moderators
   */
  async setModerator (slug, personId, on, by) {
    return this._serial(async () => {
      const room = await this._room(slug);
      const role = this._role(room, by);
      if (role !== 'owner' && role !== 'admin') throw failure(403, 'Only the room\'s owner can choose its moderators.');
      const account = await this._account(personId);
      if (!account) throw failure(404, 'No such listener.');
      const moderators = new Set(room.moderators || []);
      if (on) {
        if (account === room.owner) throw failure(409, 'The owner already runs this room.');
        if (this._banned(room, account)) throw failure(409, 'Unban them first.');
        if (!moderators.has(account) && moderators.size >= MAX_MODERATORS) throw failure(409, `A room has at most ${MAX_MODERATORS} moderators.`);
        moderators.add(account);
      } else {
        moderators.delete(account);
      }
      room.moderators = [...moderators];
      await this.store.set(`/rooms/${slug}`, room);
      this.emit('room', { room: slug });
      this.emit('queue', { room: slug });
      return Promise.all(room.moderators.map((item) => this._personRef(item)));
    });
  }

  /**
   * Ban a song (out of the queue and the auto-DJ, skipped if playing) or a
   * listener (their waiting songs go; they can't add, vote, or chat there).
   * Moderators may; nobody may ban a moderator.
   * @param {string} slug
   * @param {{ track?: string, person?: string }} target
   * @param {{ id: string, name: string }} by
   * @returns {Promise<Object>} the bans (view)
   */
  async ban (slug, target = {}, by) {
    return this._serial(async () => {
      const room = await this._room(slug);
      if (!this._role(room, by && by.id)) throw failure(403, 'Only this room\'s moderators can ban.');
      room.bans = { tracks: [], people: [], ...room.bans };
      let queue = await this._readQueue(slug);
      let skip = false;
      if (target.track) {
        const id = String(target.track);
        if (!TRACK.test(id) || !await this._read(`/tracks/${id}`, null)) throw failure(404, 'No such song.');
        if (!room.bans.tracks.includes(id)) room.bans.tracks.push(id);
        queue = { ...queue, entries: queue.entries.filter((entry) => entry.track.id !== id) };
        skip = !!(queue.current && queue.current.entry.track.id === id);
        const pool = await this._read(`/pool/${slug}`, { tracks: {} });
        if (pool.tracks[id]) {
          delete pool.tracks[id];
          await this.store.set(`/pool/${slug}`, pool);
        }
      } else if (target.person) {
        const account = await this._account(target.person);
        if (!account) throw failure(404, 'No such listener.');
        if (this._role(room, account)) throw failure(409, 'Moderators can\'t be banned; take them off first.');
        if (!room.bans.people.includes(account)) room.bans.people.push(account);
        queue = { ...queue, entries: queue.entries.filter((entry) => !(entry.curator && entry.curator.id === account)) };
      } else {
        throw failure(400, 'Ban a song or a listener.');
      }
      if (room.bans.tracks.length > MAX_BANS || room.bans.people.length > MAX_BANS) throw failure(409, 'Too many bans in this room.');
      await this.store.set(`/rooms/${slug}`, room);
      if (skip) await this._next(slug, queue, { skipped: true, by: by.name || null });
      else await this._save(slug, queue);
      this.emit('room', { room: slug });
      return (await this.room(slug, by.id)).bans;
    });
  }

  /**
   * Lift a ban.
   * @param {string} slug
   * @param {{ track?: string, person?: string }} target
   * @param {string} by Account key.
   * @returns {Promise<Object>} the bans (view)
   */
  async unban (slug, target = {}, by) {
    return this._serial(async () => {
      const room = await this._room(slug);
      if (!this._role(room, by)) throw failure(403, 'Only this room\'s moderators can lift bans.');
      room.bans = { tracks: [], people: [], ...room.bans };
      if (target.track) room.bans.tracks = room.bans.tracks.filter((id) => id !== String(target.track));
      else if (target.person) {
        const account = await this._account(target.person);
        room.bans.people = room.bans.people.filter((item) => item !== account);
      } else throw failure(400, 'Unban a song or a listener.');
      await this.store.set(`/rooms/${slug}`, room);
      this.emit('room', { room: slug });
      this.emit('queue', { room: slug });
      return (await this.room(slug, by)).bans;
    });
  }

  // Queue

  _checkAdd (room, curator) {
    if (this._banned(room, curator.id)) throw failure(403, 'You are banned from this room.');
    if (!this._may(room, curator.id, 'add')) throw failure(403, 'Only this room\'s moderators can add songs.');
  }

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
    this._checkAdd(await this._room(slug), curator);
    const found = await this._lookup(input);
    return this._serial(() => this._add(slug, found, curator));
  }

  /**
   * Queue a song this site already knows (from history, a listener page, or a set).
   * @param {string} slug
   * @param {string} id Track id.
   * @param {{ id: string, name: string }} curator
   * @returns {Promise<Object>} the entry (view)
   */
  async enqueueTrack (slug, id, curator) {
    if (!curator || !curator.id) throw failure(401, 'Sign in to add songs.');
    this._checkAdd(await this._room(slug), curator);
    return this._serial(async () => this._add(slug, await this._known(id), curator));
  }

  /**
   * Queue a set's songs, in order, as far as the queue's limits allow.
   * Songs already queued or banned there are passed over.
   * @param {string} slug
   * @param {string} setId
   * @param {{ id: string, name: string }} curator
   * @returns {Promise<{ added: Array, skipped: number }>}
   */
  async enqueueSet (slug, setId, curator) {
    if (!curator || !curator.id) throw failure(401, 'Sign in to add songs.');
    this._checkAdd(await this._room(slug), curator);
    return this._serial(async () => {
      const set = await this._readSet(setId);
      const added = [];
      let skipped = 0;
      for (const id of set.tracks) {
        try {
          added.push(await this._add(slug, await this._known(id), curator));
        } catch (error) {
          if (/already have|queue is full/.test(error.message)) {
            skipped += set.tracks.length - added.length - skipped;
            break;
          }
          skipped++;
        }
      }
      return { added, skipped };
    });
  }

  async _lookup (input) {
    if (!this.resolver) throw failure(503, 'Adding songs is not set up.');
    let found;
    try {
      found = await this.resolver.lookup(input);
    } catch (error) {
      throw failure(400, error.message);
    }
    return found;
  }

  async _known (id) {
    const track = TRACK.test(String(id || '')) ? await this._read(`/tracks/${id}`, null) : null;
    if (!track) throw failure(404, 'No such song.');
    return { source: track.source, title: track.title, artist: track.artist, duration: track.duration, thumbnail: track.thumbnail, live: false };
  }

  _checkTrack (found) {
    if (found.live || !Number.isFinite(found.duration) || found.duration <= 0) {
      throw failure(400, 'Live streams and songs without a length can\'t be queued.');
    }
    if (found.duration > this.limits.maxDuration) {
      throw failure(400, `Songs are at most ${Math.round(this.limits.maxDuration / 60)} minutes long.`);
    }
  }

  // Save what a lookup found as a track. Inside `_serial`.
  async _storeTrack (found) {
    const id = trackId(found.source);
    const stored = await this._read(`/tracks/${id}`, null);
    const track = Object.assign(stored || { id, firstSeenAt: this.settings.now(), plays: 0, lastPlayedAt: null }, {
      source: found.source,
      title: found.title,
      artist: found.artist,
      duration: found.duration,
      thumbnail: found.thumbnail,
      down: null
    });
    await this.store.set(`/tracks/${id}`, track);
    return track;
  }

  // Inside `_serial`.
  async _add (slug, found, curator) {
    const room = await this._room(slug);
    this._checkAdd(room, curator);
    this._checkTrack(found);
    const queue = await this._readQueue(slug);
    const id = trackId(found.source);
    if (((room.bans && room.bans.tracks) || []).includes(id)) throw failure(403, 'That song is banned from this room.');
    if ((queue.current && queue.current.entry.track.id === id) || queue.entries.some((entry) => entry.track.id === id)) {
      throw failure(409, 'That song is already in the queue.');
    }
    if (queue.entries.length >= this.limits.maxEntries) throw failure(409, 'The queue is full.');
    if (queue.entries.filter((entry) => entry.curator && entry.curator.id === curator.id).length >= this.limits.maxPerCurator) {
      throw failure(409, `You already have ${this.limits.maxPerCurator} songs waiting.`);
    }
    await this._touch(curator);
    const track = await this._storeTrack(found);
    const entry = {
      id: entryId(),
      track: trackSummary(track),
      curator: { id: String(curator.id), name: String(curator.name || 'Someone') },
      requestedAt: this.settings.now(),
      votes: {}
    };
    const next = Queue.enqueue(queue, entry);
    if (!next.current) await this._next(slug, next, {});
    else await this._save(slug, next);
    return this._entryView(room, entry, curator.id);
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
    const room = await this._room(slug);
    if (this._banned(room, voter)) throw failure(403, 'You are banned from this room.');
    return this._serial(async () => {
      let queue = await this._readQueue(slug);
      try {
        queue = Queue.vote(queue, id, voter, Number(value));
      } catch (error) {
        throw failure(error.message.startsWith('A vote') ? 400 : 404, error.message);
      }
      await this._save(slug, queue);
      return this._entryView(room, queue.entries.find((entry) => entry.id === id), voter);
    });
  }

  /**
   * Take an upcoming song out of the queue: as the room's rules allow
   * (its curator, or moderators), or anyone the caller has decided can
   * moderate (`force`, e.g. Discord's Manage Channels).
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
      const room = await this._room(slug);
      const queue = await this._readQueue(slug);
      const entry = queue.entries.find((item) => item.id === id);
      if (!entry) throw failure(404, 'That song is not in the queue.');
      if (!options.force && !this._may(room, by, 'remove', entry)) {
        throw failure(403, this._permissions(room).remove === 'moderators' ? 'Only this room\'s moderators can take songs out.' : 'Only whoever added it can take it out.');
      }
      await this._save(slug, Queue.remove(queue, id));
      return true;
    });
  }

  /**
   * Skip what is playing. Who may skip is up to the caller (see `canSkip`).
   * @param {string} slug
   * @param {{ name: string }} [by]
   * @returns {Promise<Object|null>} what plays next (view), or null.
   */
  async skip (slug, by) {
    await this._room(slug);
    return this._serial(async () => {
      const room = await this._room(slug);
      const queue = await this._readQueue(slug);
      if (!queue.current) throw failure(409, 'Nothing is playing.');
      const next = await this._next(slug, queue, { skipped: true, by: by ? by.name : null });
      return next.current ? this._entryView(room, next.current.entry, null) : null;
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

  // Close out what is playing (if anything) and start the next entry, or an
  // auto-DJ pick when the queue is empty.
  async _next (slug, queue, outcome) {
    const now = this.settings.now();
    if (queue.current) await this._closePlay(slug, queue.current, now, outcome);
    let next = Queue.advance(queue, now);
    if (!next.current) {
      const entry = await this._autoPick(slug, now);
      if (entry) next = { current: { entry, startedAt: now }, entries: next.entries };
    }
    return this._begin(slug, next, now);
  }

  async _begin (slug, next, now) {
    await this.store.set(`/queues/${slug}`, next);
    if (next.current) {
      const entry = next.current.entry;
      const key = `/tracks/${entry.track.id}`;
      const track = await this._read(key, null);
      if (track) await this.store.set(key, { ...track, plays: (track.plays || 0) + 1, lastPlayedAt: now });
      await this._pool(slug, entry, now);
      if (!entry.auto) await this._credit(entry.curator, entry.track, slug, now);
      await this._openPlay(slug, next.current);
      this._schedule(slug, next);
      this.emit('play', { room: slug, entry, track: entry.track, startedAt: next.current.startedAt });
    } else {
      this._unschedule(slug);
      this.emit('idle', { room: slug });
    }
    this.emit('queue', { room: slug });
    return next;
  }

  // The auto-DJ's pool: songs people chose in this room, with when each last
  // played here.
  async _pool (slug, entry, now) {
    const pool = await this._read(`/pool/${slug}`, { tracks: {} });
    const item = pool.tracks[entry.track.id] || {};
    item.lastPlayedAt = now;
    if (!entry.auto) item.curatedAt = now;
    if (!item.curatedAt) return;
    pool.tracks[entry.track.id] = item;
    const ids = Object.keys(pool.tracks);
    if (ids.length > MAX_POOL) {
      ids.sort((a, b) => pool.tracks[a].curatedAt - pool.tracks[b].curatedAt).slice(0, ids.length - MAX_POOL).forEach((id) => { delete pool.tracks[id]; });
    }
    await this.store.set(`/pool/${slug}`, pool);
  }

  // A song for an empty queue: chosen at random from the room's pool, not
  // played there lately, not banned, not down. Null when nobody is listening.
  async _autoPick (slug, now) {
    if (!this.autoplay.enabled || !this._heard(slug)) return null;
    const room = await this._read(`/rooms/${slug}`, null);
    if (!room || room.autoplay === false) return null;
    const pool = await this._read(`/pool/${slug}`, { tracks: {} });
    const banned = new Set((room.bans && room.bans.tracks) || []);
    const cutoff = now - this.autoplay.recentMs;
    const candidates = Object.keys(pool.tracks).filter((id) => !banned.has(id) && (pool.tracks[id].lastPlayedAt || 0) <= cutoff);
    while (candidates.length) {
      const [id] = candidates.splice(Math.floor(this.settings.random() * candidates.length), 1);
      const track = await this._read(`/tracks/${id}`, null);
      if (!track || track.down || !(track.duration > 0) || track.duration > this.limits.maxDuration) continue;
      return { id: entryId(), track: trackSummary(track), curator: null, auto: true, requestedAt: now, votes: {} };
    }
    return null;
  }

  async _openPlay (slug, current) {
    const record = await this._read(`/plays/${slug}`, { plays: [] });
    record.plays.unshift({
      entry: current.entry.id,
      track: current.entry.track,
      curator: current.entry.curator ? current.entry.curator.name : null,
      curatorId: current.entry.curator ? this.personId(current.entry.curator.id) : null,
      auto: !!current.entry.auto,
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
    if (play) {
      play.endedAt = now;
      if (outcome.skipped) play.skipped = { by: outcome.by || null };
      if (outcome.down) play.down = true;
      await this.store.set(`/plays/${slug}`, record);
    }
    this.emit('ended', {
      room: slug,
      entry: current.entry.id,
      track: current.entry.track,
      curator: current.entry.curator ? current.entry.curator.name : null,
      auto: !!current.entry.auto,
      startedAt: current.startedAt,
      endedAt: now,
      skipped: !!outcome.skipped,
      down: !!outcome.down
    });
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

  // Sets: a listener's saved lists of songs.

  async _readSet (id) {
    const set = SET.test(String(id || '')) ? await this._read(`/sets/s${id}`, null) : null;
    if (!set || set.deleted) throw failure(404, 'No such set.');
    return set;
  }

  async _ownSet (id, by) {
    const set = await this._readSet(id);
    if (!by || set.owner !== by) throw failure(403, 'Only whoever made this set can change it.');
    return set;
  }

  async _setView (set, viewer) {
    const tracks = [];
    for (const id of set.tracks) {
      const track = await this._read(`/tracks/${id}`, null);
      if (track) tracks.push(trackSummary(track));
    }
    return {
      id: set.id,
      name: set.name,
      description: set.description || '',
      owner: await this._personRef(set.owner),
      tracks,
      mine: !!viewer && viewer === set.owner,
      createdAt: set.createdAt,
      updatedAt: set.updatedAt
    };
  }

  /**
   * One set, with its songs.
   * @param {string} id
   * @param {string} [viewer] Account key.
   * @returns {Promise<Object>}
   */
  async set (id, viewer = null) {
    return this._setView(await this._readSet(id), viewer);
  }

  /**
   * Make a set.
   * @param {{ id: string, name: string }} owner
   * @param {{ name: string, description?: string }} details
   * @returns {Promise<Object>} the set (view)
   */
  async createSet (owner, details = {}) {
    if (!owner || !owner.id) throw failure(401, 'Sign in to make a set.');
    const name = text(details.name, 64);
    if (!name) throw failure(400, 'A set needs a name.');
    return this._serial(async () => {
      const person = await this._touch(owner);
      if ((person.sets || []).length >= MAX_SETS) throw failure(409, `You can keep at most ${MAX_SETS} sets.`);
      const now = this.settings.now();
      const set = { id: entryId(), owner: String(owner.id), name, description: text(details.description, 280), tracks: [], createdAt: now, updatedAt: now };
      await this.store.set(`/sets/s${set.id}`, set);
      person.sets = [...(person.sets || []), set.id];
      await this.store.set(this._personKey(person.id), person);
      return this._setView(set, owner.id);
    });
  }

  /**
   * Rename a set or change its description.
   * @param {string} id
   * @param {{ name?: string, description?: string }} changes
   * @param {string} by Account key.
   * @returns {Promise<Object>} the set (view)
   */
  async updateSet (id, changes = {}, by) {
    return this._serial(async () => {
      const set = await this._ownSet(id, by);
      if (changes.name !== undefined) {
        const name = text(changes.name, 64);
        if (!name) throw failure(400, 'A set needs a name.');
        set.name = name;
      }
      if (changes.description !== undefined) set.description = text(changes.description, 280);
      set.updatedAt = this.settings.now();
      await this.store.set(`/sets/s${id}`, set);
      return this._setView(set, by);
    });
  }

  /**
   * Delete a set.
   * @param {string} id
   * @param {string} by Account key.
   * @returns {Promise<boolean>}
   */
  async deleteSet (id, by) {
    return this._serial(async () => {
      await this._ownSet(id, by);
      await this.store.set(`/sets/s${id}`, { id, deleted: true, deletedAt: this.settings.now() });
      const key = this._personKey(this.personId(by));
      const person = await this._read(key, null);
      if (person) {
        person.sets = (person.sets || []).filter((item) => item !== id);
        await this.store.set(key, person);
      }
      return true;
    });
  }

  /**
   * Add a song to a set: one this site knows (`track`), or a link or search (`song`).
   * @param {string} id
   * @param {{ track?: string, song?: string }} what
   * @param {string} by Account key.
   * @returns {Promise<Object>} the set (view)
   */
  async addToSet (id, what = {}, by) {
    await this._ownSet(id, by);
    const found = what.track ? null : await this._lookup(String(what.song || ''));
    return this._serial(async () => {
      const set = await this._ownSet(id, by);
      let track;
      if (found) {
        this._checkTrack(found);
        track = await this._storeTrack(found);
      } else {
        await this._known(what.track);
        track = { id: String(what.track) };
      }
      if (set.tracks.includes(track.id)) throw failure(409, 'That song is already in this set.');
      if (set.tracks.length >= MAX_SET_TRACKS) throw failure(409, `A set holds at most ${MAX_SET_TRACKS} songs.`);
      set.tracks.push(track.id);
      set.updatedAt = this.settings.now();
      await this.store.set(`/sets/s${id}`, set);
      return this._setView(set, by);
    });
  }

  /**
   * Take a song out of a set.
   * @param {string} id
   * @param {string} track Track id.
   * @param {string} by Account key.
   * @returns {Promise<Object>} the set (view)
   */
  async removeFromSet (id, track, by) {
    return this._serial(async () => {
      const set = await this._ownSet(id, by);
      if (!set.tracks.includes(track)) throw failure(404, 'That song is not in this set.');
      set.tracks = set.tracks.filter((item) => item !== track);
      set.updatedAt = this.settings.now();
      await this.store.set(`/sets/s${id}`, set);
      return this._setView(set, by);
    });
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
    if (!TRACK.test(String(id))) return null;
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
  async chat (slug, author, body) {
    if (!author || !author.id) throw failure(401, 'Sign in to chat.');
    const said = text(body, 500);
    if (!said) throw failure(400, 'Say something.');
    const room = await this._room(slug);
    if (this._banned(room, author.id)) throw failure(403, 'You are banned from this room.');
    return this._serial(async () => {
      await this._touch(author);
      const record = await this._read(`/chat/${slug}`, { messages: [] });
      const message = { id: entryId(), author: { id: String(author.id), name: String(author.name || 'Someone') }, text: said, at: this.settings.now() };
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
    return { id: message.id, author: message.author.name, authorId: this.personId(message.author.id), text: message.text, at: message.at };
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
module.exports.PERMISSIONS = PERMISSIONS;
