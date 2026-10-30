'use strict';

const crypto = require('crypto');
const { createPassportRelyingParty } = require('@fabric/http/functions/passportRelyingParty');

const BASE = '/services/soundtrack';
const SESSION_COOKIE = 'soundtrack.session';
const PASSPORT_COOKIE = 'soundtrack.passport';
const PASSPORT_PATH = `${BASE}/passport`;
const LASTFM_COOKIE = 'soundtrack.lastfm';
const LASTFM_PATH = `${BASE}/lastfm`;
const LASTFM_STATE_MS = 10 * 60 * 1000;
const PASSPORT_PURPOSE = 'Sign in to add songs, vote, and chat.';
const CHALLENGE_MS = 2 * 60 * 1000;
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const HEARTBEAT_MS = 25000;
const MAX_STREAMS = 1000;
const MAX_JSON = 64 * 1024;
const MAX_NAME = 32;

function sendJson (res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function parseCookies (header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    try {
      out[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch (_) { /* malformed cookie */ }
  }
  return out;
}

function sha256 (value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function requestProto (req) {
  const forwarded = req.headers['x-forwarded-proto'];
  if (typeof forwarded === 'string' && forwarded.trim()) return forwarded.split(',')[0].trim();
  return req.socket && req.socket.encrypted ? 'https' : 'http';
}

function isLoopbackOrigin (origin) {
  try {
    const host = new URL(origin).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || /^127\./.test(host);
  } catch (_) {
    return false;
  }
}

// A display name someone picked: one line, no control characters.
function cleanName (value) {
  const name = String(value == null ? '' : value).replace(/\p{Cc}/gu, '').replace(/\s+/g, ' ').trim();
  return name.slice(0, MAX_NAME);
}

async function readBody (req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON) throw Object.assign(new Error('Request body too large.'), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    throw Object.assign(new Error('Send JSON.'), { status: 400 });
  }
}

/**
 * Soundtrack over HTTP: JSON under `/services/soundtrack`, a Server-Sent
 * Events stream per room, and Fabric Passport sign-in (v2, `@fabric/core`
 * `docs/PASSPORT.md`) for anything that writes.
 *
 * Signed-in people are `{ id: 'fabric:<x-only pubkey>', name }`, the name one
 * they pick here. Challenges are issued only for pinned origins, and the
 * binding secret that redeems one lives in an HttpOnly cookie. Sessions are
 * random tokens in an HttpOnly cookie, kept (hashed) in the Soundtrack Store.
 * Responses carry display names and listener ids only, never account keys.
 *
 * Also serves listener pages, sets, room moderation, each room's MP3 stream
 * (with `broadcast`), and Last.fm linking (with `lastfm`). Pages with a room
 * open count as its audience, so the auto-DJ plays for them.
 */
class SoundtrackWeb {
  /**
   * @param {Object} settings
   * @param {Object} settings.soundtrack Soundtrack service.
   * @param {string} settings.siteUrl Public origin (pinned for Passport, cookie `Secure`).
   * @param {Object} [settings.passport]
   * @param {string[]} [settings.passport.origins] Origins Passport sign-in is offered on (default `siteUrl`; any loopback origin while developing on one).
   * @param {boolean} [settings.production] Default `NODE_ENV === 'production'`.
   * @param {Object} [settings.broadcast] Broadcast service (rooms as MP3 streams).
   * @param {Object} [settings.lastfm] LastFM service.
   * @param {Function} [settings.now] Clock (tests).
   */
  constructor (settings = {}) {
    this.settings = Object.assign({
      soundtrack: null,
      siteUrl: 'http://localhost:15005',
      passport: {},
      production: process.env.NODE_ENV === 'production',
      broadcast: null,
      lastfm: null,
      now: () => Date.now()
    }, settings);
    this.soundtrack = this.settings.soundtrack;
    this.broadcast = this.settings.broadcast;
    this.lastfm = this.settings.lastfm && this.settings.lastfm.enabled ? this.settings.lastfm : null;
    this.passport = this._createPassport();
    this._taking = Promise.resolve();
    this.streams = new Map();
    this._streamCount = 0;
    this._heartbeat = null;
    this._removeAudience = null;
    this._forward = {
      queue: (event) => this._publish(event.room, 'queue', {}),
      play: (event) => this._publish(event.room, 'play', { entry: event.entry.id, startedAt: event.startedAt }),
      idle: (event) => this._publish(event.room, 'idle', {}),
      chat: (event) => this._publish(event.room, 'chat', event.message),
      room: (event) => {
        this._publishAll('rooms', {});
        if (event && event.room) this._publish(event.room, 'room', {});
      }
    };
  }

  get loginEnabled () {
    return !!this.passport;
  }

  get secure () {
    return String(this.settings.siteUrl).startsWith('https:');
  }

  // Pinned origins: the configured list, else the site's own origin. A
  // loopback site while developing pins nothing, which offers sign-in on any
  // loopback origin (localhost and 127.0.0.1 alike) and nowhere else.
  _createPassport () {
    const production = !!this.settings.production;
    let origins = [].concat((this.settings.passport && this.settings.passport.origins) || []).filter(Boolean);
    if (!origins.length) {
      let site = null;
      try { site = new URL(this.settings.siteUrl).origin; } catch (_) {}
      if (site && (production || !isLoopbackOrigin(site))) origins = [site];
    }
    const challengeStore = {
      put: (key, record) => this.soundtrack.saveRecord('web', `passport-${key}`, record),
      take: (key) => this._take(key)
    };
    try {
      return createPassportRelyingParty({
        pinnedOrigins: origins,
        production,
        purpose: PASSPORT_PURPOSE,
        challengeTtlMs: CHALLENGE_MS,
        challengeStore,
        now: this.settings.now
      });
    } catch (_) {
      // Production with nothing to pin: Passport stays off.
      return null;
    }
  }

  // Spend a challenge: one at a time, so two claims racing for the same one
  // can't both get it.
  _take (key) {
    const taken = this._taking.then(async () => {
      if (!/^[0-9a-f]{64}$/.test(key)) return null;
      const record = await this.soundtrack.record('web', `passport-${key}`);
      if (!record || !record.nonce) return null;
      await this.soundtrack.saveRecord('web', `passport-${key}`, { spentAt: this.settings.now() });
      return record.expiresAt > this.settings.now() ? record : null;
    });
    this._taking = taken.catch(() => {});
    return taken;
  }

  start () {
    for (const [event, fn] of Object.entries(this._forward)) this.soundtrack.on(event, fn);
    this._removeAudience = this.soundtrack.addAudience((room) => {
      const clients = this.streams.get(room);
      return clients ? clients.size : 0;
    });
    this._heartbeat = setInterval(() => this._publishAll(null), HEARTBEAT_MS);
    this._heartbeat.unref();
    return this;
  }

  stop () {
    for (const [event, fn] of Object.entries(this._forward)) this.soundtrack.removeListener(event, fn);
    if (this._removeAudience) this._removeAudience();
    clearInterval(this._heartbeat);
    for (const clients of this.streams.values()) for (const res of clients.keys()) res.end();
    this.streams.clear();
    this._streamCount = 0;
    return this;
  }

  // Live updates

  _publish (room, event, data) {
    const clients = this.streams.get(room);
    if (!clients) return;
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients.keys()) res.write(frame);
  }

  _publishAll (event, data) {
    const frame = event ? `event: ${event}\ndata: ${JSON.stringify(data)}\n\n` : ': keep-alive\n\n';
    for (const clients of this.streams.values()) for (const res of clients.keys()) res.write(frame);
  }

  /**
   * Who has a room open: signed-in people by display name and listener id
   * (once each, in the order they arrived) and a count that adds one per
   * signed-out page and one per listener of the room's MP3 stream.
   * @param {string} room
   * @returns {{ count: number, names: string[], people: Array<{ id: string, name: string }> }}
   */
  listeners (room) {
    const clients = this.streams.get(room);
    const radio = this.broadcast ? this.broadcast.listeners(room) : 0;
    if (!clients) return { count: radio, names: [], people: [] };
    const people = new Map();
    let guests = 0;
    for (const user of clients.values()) {
      if (user) people.set(user.id, user.name);
      else guests++;
    }
    return {
      count: people.size + guests + radio,
      names: [...people.values()],
      people: [...people].map(([id, name]) => ({ id: this.soundtrack.personId(id), name }))
    };
  }

  /**
   * Account keys of the signed-in people with a room open (never served).
   * @param {string} room
   * @returns {string[]}
   */
  present (room) {
    const clients = this.streams.get(room);
    return clients ? [...new Set([...clients.values()].filter(Boolean).map((user) => user.id))] : [];
  }

  _subscribe (req, res, room, user = null) {
    if (this._streamCount >= MAX_STREAMS) return sendJson(res, 503, { error: 'Too many listeners right now.' });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    // `no-transform` keeps compression middleware from buffering the stream.
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.write('retry: 3000\n\n');
    if (!this.streams.has(room)) this.streams.set(room, new Map());
    this.streams.get(room).set(res, user ? { id: user.id, name: user.name } : null);
    this._streamCount++;
    this._publish(room, 'listeners', this.listeners(room));
    this.soundtrack.wake(room).catch(() => {});
    req.on('close', () => {
      const clients = this.streams.get(room);
      if (clients && clients.delete(res)) this._streamCount--;
      if (clients && !clients.size) this.streams.delete(room);
      this._publish(room, 'listeners', this.listeners(room));
    });
  }

  async _rooms () {
    return (await this.soundtrack.rooms()).map((room) => ({ ...room, listeners: this.listeners(room.slug).count }));
  }

  // Sessions

  _cookie (name, value, maxAgeMs, path = '/') {
    return `${name}=${encodeURIComponent(value)}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${this.secure ? '; Secure' : ''}`;
  }

  /**
   * The signed-in person, or null. Sessions from before Passport (Discord
   * sign-in) no longer count.
   * @param {Object} req
   * @returns {Promise<{ id: string, name: string }|null>}
   */
  async session (req) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
    const record = await this.soundtrack.record('web', `session-${sha256(token)}`);
    if (!record || !record.user || record.expiresAt <= this.settings.now()) return null;
    const id = String(record.user.id || '');
    if (!/^fabric:[0-9a-f]{64}$/.test(id)) return null;
    return { id, name: await this._name(id) };
  }

  async _name (id) {
    const profile = await this.soundtrack.record('web', `profile-${id.slice('fabric:'.length)}`);
    return (profile && profile.name) || `Listener ${id.slice('fabric:'.length, 'fabric:'.length + 6)}`;
  }

  // The pinned origin this request came in on, or null. Passport signs for
  // the origin its browser shows, so a challenge for any other could never
  // be redeemed here.
  _origin (req) {
    if (!this.passport || !req.headers.host) return null;
    return this.passport.resolveOrigin(`${requestProto(req)}://${req.headers.host}`);
  }

  _passportCookie (req, value, maxAgeMs) {
    const secure = requestProto(req) === 'https' ? '; Secure' : '';
    return `${PASSPORT_COOKIE}=${value}; Path=${PASSPORT_PATH}; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure}`;
  }

  async _challenge (req, res) {
    if (!this.passport) return sendJson(res, 503, { error: 'Passport sign-in is not set up.' });
    const origin = this._origin(req);
    if (!origin) return sendJson(res, 400, { error: 'Passport sign-in is not offered on this address.' });
    const issued = await this.passport.issueChallenge({ origin });
    res.setHeader('Set-Cookie', this._passportCookie(req, issued.bindingSecret, CHALLENGE_MS));
    sendJson(res, 200, { challenge: issued.challenge, expiresAt: issued.expiresAt });
  }

  async _claim (req, res) {
    if (!this.passport) return sendJson(res, 503, { error: 'Passport sign-in is not set up.' });
    const body = await readBody(req);
    const assertion = typeof body.assertion === 'string' ? body.assertion.trim() : '';
    const secret = parseCookies(req.headers.cookie)[PASSPORT_COOKIE] || '';
    const clear = this._passportCookie(req, '', 0);
    if (!/^fabric:/i.test(assertion) || assertion.length > 48 * 1024) {
      res.setHeader('Set-Cookie', clear);
      return sendJson(res, 400, { error: 'A signed Passport assertion is required.' });
    }
    if (!/^[0-9a-f]{64}$/.test(secret)) {
      res.setHeader('Set-Cookie', clear);
      return sendJson(res, 401, { error: 'Start Passport sign-in again.' });
    }
    const verified = await this.passport.redeem(secret, assertion);
    if (!verified.ok) {
      res.setHeader('Set-Cookie', clear);
      return sendJson(res, 401, { error: `Passport sign-in was refused: ${verified.error}.` });
    }
    if (this._origin(req) !== verified.origin) {
      res.setHeader('Set-Cookie', clear);
      return sendJson(res, 401, { error: 'Sign-in was started on another address.' });
    }
    const id = `fabric:${String(verified.identity.pubkey).toLowerCase().slice(-64)}`;
    const token = crypto.randomBytes(32).toString('hex');
    await this.soundtrack.saveRecord('web', `session-${sha256(token)}`, {
      user: { id },
      signer: verified.signer,
      createdAt: this.settings.now(),
      expiresAt: this.settings.now() + SESSION_MS
    });
    res.setHeader('Set-Cookie', [clear, this._cookie(SESSION_COOKIE, token, SESSION_MS)]);
    const named = !!await this.soundtrack.record('web', `profile-${id.slice('fabric:'.length)}`);
    const name = await this._name(id);
    await this.soundtrack.remember({ id, name });
    sendJson(res, 200, { user: { id, name }, named });
  }

  async _rename (req, res) {
    const user = await this.session(req);
    if (!user) return sendJson(res, 401, { error: 'Sign in first.' });
    const name = cleanName((await readBody(req)).name);
    if (!name) return sendJson(res, 400, { error: 'Pick a name.' });
    await this.soundtrack.saveRecord('web', `profile-${user.id.slice('fabric:'.length)}`, { name, updatedAt: this.settings.now() });
    await this.soundtrack.remember({ id: user.id, name });
    sendJson(res, 200, { user: { id: user.id, name } });
  }

  async _logout (req, res) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token && /^[0-9a-f]{64}$/.test(token)) {
      await this.soundtrack.saveRecord('web', `session-${sha256(token)}`, { revokedAt: this.settings.now() });
    }
    res.setHeader('Set-Cookie', this._cookie(SESSION_COOKIE, '', 0));
    sendJson(res, 200, { user: null });
  }

  // Last.fm: a state cookie ties Last.fm's callback to the session that asked.

  _lastfmCookie (value, maxAgeMs) {
    return `${LASTFM_COOKIE}=${value}; Path=${LASTFM_PATH}; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${this.secure ? '; Secure' : ''}`;
  }

  _redirect (res, location, cookie) {
    res.statusCode = 302;
    if (cookie) res.setHeader('Set-Cookie', cookie);
    res.setHeader('Location', location);
    res.setHeader('Cache-Control', 'no-store');
    res.end();
  }

  async _lastfmConnect (req, res, user) {
    if (!this.lastfm) return sendJson(res, 404, { error: 'Last.fm is not set up.' });
    if (!user) return this._redirect(res, '/');
    const state = crypto.randomBytes(32).toString('hex');
    await this.soundtrack.saveRecord('lastfm', `state-${sha256(state)}`, { account: user.id, expiresAt: this.settings.now() + LASTFM_STATE_MS });
    const callback = `${String(this.settings.siteUrl).replace(/\/+$/, '')}${LASTFM_PATH}/callback`;
    this._redirect(res, this.lastfm.authorizeUrl(callback), this._lastfmCookie(state, LASTFM_STATE_MS));
  }

  async _lastfmCallback (req, res, url, user) {
    if (!this.lastfm) return sendJson(res, 404, { error: 'Last.fm is not set up.' });
    const clear = this._lastfmCookie('', 0);
    if (!user) return this._redirect(res, '/', clear);
    const page = `/people/${this.soundtrack.personId(user.id)}`;
    const state = parseCookies(req.headers.cookie)[LASTFM_COOKIE] || '';
    const key = /^[0-9a-f]{64}$/.test(state) ? `state-${sha256(state)}` : null;
    const record = key ? await this.soundtrack.record('lastfm', key) : null;
    if (key) await this.soundtrack.saveRecord('lastfm', key, { spentAt: this.settings.now() });
    if (!record || record.account !== user.id || !(record.expiresAt > this.settings.now())) {
      return this._redirect(res, `${page}?lastfm=expired`, clear);
    }
    try {
      await this.lastfm.link(user.id, url.searchParams.get('token'));
    } catch (_) {
      return this._redirect(res, `${page}?lastfm=refused`, clear);
    }
    this._redirect(res, `${page}?lastfm=linked`, clear);
  }

  // Requests

  /**
   * Express-style middleware for everything under `/services/soundtrack`.
   * @returns {Function}
   */
  middleware () {
    return (req, res, next) => {
      const url = new URL(req.url, 'http://local');
      if (url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`)) return next();
      this._route(req, res, url).catch((error) => {
        if (res.headersSent) return res.end();
        sendJson(res, error.status || 500, { error: error.status ? error.message : 'Something went wrong.' });
      });
    };
  }

  _writeAllowed (req) {
    const type = String(req.headers['content-type'] || '');
    if (req.method !== 'DELETE' && !type.startsWith('application/json')) return false;
    const origin = req.headers.origin;
    if (!origin) return true;
    let site = null;
    try { site = new URL(this.settings.siteUrl).origin; } catch (_) {}
    if (origin === site) return true;
    if (this.passport && this.passport.pinnedOrigins.includes(origin)) return true;
    return isLoopbackOrigin(origin) && origin === `${requestProto(req)}://${req.headers.host}`;
  }

  async _route (req, res, url) {
    const parts = url.pathname.slice(BASE.length).split('/').filter(Boolean).map(decodeURIComponent);
    const method = req.method;
    const st = this.soundtrack;

    if (!parts.length && method === 'GET') return sendJson(res, 200, { rooms: await this._rooms(), defaultRoom: st.defaultRoom });
    if (parts[0] === 'session' && parts.length === 1 && method === 'GET') {
      const user = await this.session(req);
      return sendJson(res, 200, {
        user: user ? { ...user, person: st.personId(user.id) } : null,
        passport: this.loginEnabled,
        lastfm: this.lastfm ? { linked: user ? await this.lastfm.linked(user.id) : null } : null
      });
    }
    if (parts[0] === 'tracks' && parts.length === 2 && method === 'GET') {
      const track = await st.track(parts[1]);
      return track ? sendJson(res, 200, track) : sendJson(res, 404, { error: 'No such track.' });
    }

    const writes = method === 'POST' || method === 'DELETE' || method === 'PATCH';
    if (writes && !this._writeAllowed(req)) return sendJson(res, 403, { error: 'Send JSON from this site.' });
    if (parts[0] === 'passport' && parts[1] === 'challenges' && parts.length === 2 && method === 'POST') return this._challenge(req, res);
    if (parts[0] === 'passport' && parts.length === 1 && method === 'POST') return this._claim(req, res);
    if (parts[0] === 'session' && parts.length === 1 && method === 'PATCH') return this._rename(req, res);
    if (parts[0] === 'logout' && parts.length === 1 && method === 'POST') return this._logout(req, res);

    const user = await this.session(req);
    const viewer = user ? user.id : null;

    if (parts[0] === 'lastfm') {
      if (parts[1] === 'connect' && parts.length === 2 && method === 'GET') return this._lastfmConnect(req, res, user);
      if (parts[1] === 'callback' && parts.length === 2 && method === 'GET') return this._lastfmCallback(req, res, url, user);
      if (parts.length === 1 && method === 'DELETE') {
        if (!this.lastfm) return sendJson(res, 404, { error: 'Last.fm is not set up.' });
        if (!user) return sendJson(res, 401, { error: 'Sign in first.' });
        await this.lastfm.unlink(user.id);
        return sendJson(res, 200, { linked: null });
      }
      return sendJson(res, 404, { error: 'Not found.' });
    }

    if (parts[0] === 'people' && parts.length === 2 && method === 'GET') {
      const person = await st.person(parts[1], viewer);
      if (!person) return sendJson(res, 404, { error: 'No such listener.' });
      if (person.you && this.lastfm) person.lastfm = { linked: await this.lastfm.linked(viewer) };
      return sendJson(res, 200, person);
    }

    if (parts[0] === 'sets') return this._sets(req, res, parts, user);

    if (parts[0] !== 'rooms') return sendJson(res, 404, { error: 'Not found.' });

    if (parts.length === 1) {
      if (method === 'GET') return sendJson(res, 200, { rooms: await this._rooms() });
      if (method === 'POST') {
        if (!user) return sendJson(res, 401, { error: 'Sign in to make a room.' });
        const body = await readBody(req);
        return sendJson(res, 201, await st.createRoom({ name: body.name, description: body.description }, user));
      }
    }

    const slug = parts[1];
    if (parts.length === 2 && method === 'GET') {
      const stream = this.broadcast ? `${BASE}/rooms/${encodeURIComponent(slug)}/stream` : null;
      return sendJson(res, 200, { ...await st.room(slug, viewer), listeners: this.listeners(slug), stream });
    }
    if (parts.length === 2 && method === 'PATCH') {
      if (!user) return sendJson(res, 401, { error: 'Sign in first.' });
      const body = await readBody(req);
      const changes = {};
      for (const key of ['name', 'description', 'permissions', 'autoplay']) if (body[key] !== undefined) changes[key] = body[key];
      return sendJson(res, 200, await st.updateRoom(slug, changes, viewer));
    }
    if (parts.length === 3 && parts[2] === 'stream' && method === 'GET') {
      if (!this.broadcast) return sendJson(res, 404, { error: 'Streams are off here.' });
      await st.room(slug);
      return this.broadcast.attach(req, res, slug);
    }
    if (parts[2] === 'moderators' && (method === 'POST' || method === 'DELETE')) {
      if (!user) return sendJson(res, 401, { error: 'Sign in first.' });
      if (method === 'POST' && parts.length === 3) {
        const body = await readBody(req);
        return sendJson(res, 200, { moderators: await st.setModerator(slug, String(body.person || ''), true, viewer) });
      }
      if (method === 'DELETE' && parts.length === 4) {
        return sendJson(res, 200, { moderators: await st.setModerator(slug, parts[3], false, viewer) });
      }
    }
    if (parts[2] === 'bans' && (method === 'POST' || method === 'DELETE')) {
      if (!user) return sendJson(res, 401, { error: 'Sign in first.' });
      if (method === 'POST' && parts.length === 3) {
        const body = await readBody(req);
        const target = body.track ? { track: String(body.track) } : body.person ? { person: String(body.person) } : {};
        return sendJson(res, 200, { bans: await st.ban(slug, target, user) });
      }
      if (method === 'DELETE' && parts.length === 5 && (parts[3] === 'tracks' || parts[3] === 'people')) {
        const target = parts[3] === 'tracks' ? { track: parts[4] } : { person: parts[4] };
        return sendJson(res, 200, { bans: await st.unban(slug, target, viewer) });
      }
    }
    if (parts.length === 3 && parts[2] === 'events' && method === 'GET') {
      await st.room(slug);
      return this._subscribe(req, res, slug, user);
    }
    if (parts.length === 3 && parts[2] === 'plays' && method === 'GET') {
      return sendJson(res, 200, { plays: await st.plays(slug, url.searchParams.get('limit')) });
    }
    if (parts.length === 3 && parts[2] === 'chat') {
      if (method === 'GET') return sendJson(res, 200, { messages: await st.messages(slug, url.searchParams.get('limit')) });
      if (method === 'POST') {
        const body = await readBody(req);
        return sendJson(res, 201, await st.chat(slug, user, body.text));
      }
    }
    if (parts.length === 3 && parts[2] === 'queue' && method === 'POST') {
      const body = await readBody(req);
      if (body.set) return sendJson(res, 201, await st.enqueueSet(slug, String(body.set), user));
      if (body.track) return sendJson(res, 201, await st.enqueueTrack(slug, String(body.track), user));
      return sendJson(res, 201, await st.enqueue(slug, String(body.song || ''), user));
    }
    if (parts.length === 5 && parts[2] === 'queue' && parts[4] === 'votes' && method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, await st.vote(slug, parts[3], viewer, Number(body.vote)));
    }
    if (parts.length === 4 && parts[2] === 'queue' && method === 'DELETE') {
      if (!user) return sendJson(res, 401, { error: 'Sign in first.' });
      await st.remove(slug, parts[3], viewer);
      return sendJson(res, 200, { removed: parts[3] });
    }
    if (parts.length === 3 && parts[2] === 'skip' && method === 'POST') {
      if (!user) return sendJson(res, 401, { error: 'Sign in first.' });
      const room = await st.room(slug, viewer);
      if (!room.current) return sendJson(res, 409, { error: 'Nothing is playing.' });
      if (!room.you.canSkip) {
        return sendJson(res, 403, { error: room.permissions.skip === 'moderators' ? 'Only this room\'s moderators can skip.' : 'Only whoever added this song can skip it here.' });
      }
      return sendJson(res, 200, { next: await st.skip(slug, user) });
    }
    return sendJson(res, 404, { error: 'Not found.' });
  }

  async _sets (req, res, parts, user) {
    const st = this.soundtrack;
    const method = req.method;
    const viewer = user ? user.id : null;
    if (method !== 'GET' && !user) return sendJson(res, 401, { error: 'Sign in first.' });
    if (parts.length === 1 && method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 201, await st.createSet(user, { name: body.name, description: body.description }));
    }
    const id = parts[1];
    if (parts.length === 2) {
      if (method === 'GET') return sendJson(res, 200, await st.set(id, viewer));
      if (method === 'PATCH') {
        const body = await readBody(req);
        const changes = {};
        for (const key of ['name', 'description']) if (body[key] !== undefined) changes[key] = body[key];
        return sendJson(res, 200, await st.updateSet(id, changes, viewer));
      }
      if (method === 'DELETE') {
        await st.deleteSet(id, viewer);
        return sendJson(res, 200, { deleted: id });
      }
    }
    if (parts[2] === 'tracks') {
      if (parts.length === 3 && method === 'POST') {
        const body = await readBody(req);
        const what = body.track ? { track: String(body.track) } : { song: String(body.song || '') };
        return sendJson(res, 200, await st.addToSet(id, what, viewer));
      }
      if (parts.length === 4 && method === 'DELETE') return sendJson(res, 200, await st.removeFromSet(id, parts[3], viewer));
    }
    return sendJson(res, 404, { error: 'Not found.' });
  }
}

module.exports = SoundtrackWeb;
module.exports.parseCookies = parseCookies;
