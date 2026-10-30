'use strict';

const { parseTrack, signature, scrobbles } = require('../functions/scrobble');

const API = 'https://ws.audioscrobbler.com/2.0/';
const AUTH = 'https://www.last.fm/api/auth/';
const TIMEOUT_MS = 10000;

/**
 * Last.fm scrobbling: a signed-in listener links their Last.fm account once,
 * and every song played while they have the room open shows as now playing
 * there and, once it has played long enough, is scrobbled. Links are kept in
 * the Soundtrack Store (`lastfm` records by listener id) and never served;
 * only the Last.fm user name is shown back to its owner.
 */
class LastFM {
  /**
   * @param {Object} settings
   * @param {Object} settings.soundtrack Soundtrack service.
   * @param {string} [settings.apiKey] Last.fm API key; scrobbling is off without it and the secret.
   * @param {string} [settings.apiSecret] Last.fm shared secret.
   * @param {function(string): string[]} [settings.present] Account keys with a room open (set by the web service).
   * @param {Function} [settings.fetch] `fetch` (tests).
   * @param {Function} [settings.now] Clock (tests).
   */
  constructor (settings = {}) {
    this.settings = Object.assign({
      soundtrack: null,
      apiKey: null,
      apiSecret: null,
      present: () => [],
      fetch: (...args) => fetch(...args),
      now: () => Date.now()
    }, Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)));
    this.soundtrack = this.settings.soundtrack;
    this._playing = new Map();
    this._forward = {
      play: (event) => this._onPlay(event).catch((error) => this.soundtrack.emit('error', error)),
      ended: (event) => this._onEnded(event).catch((error) => this.soundtrack.emit('error', error))
    };
  }

  get enabled () {
    return !!(this.settings.apiKey && this.settings.apiSecret);
  }

  start () {
    if (!this.enabled) return this;
    for (const [event, fn] of Object.entries(this._forward)) this.soundtrack.on(event, fn);
    return this;
  }

  stop () {
    for (const [event, fn] of Object.entries(this._forward)) this.soundtrack.removeListener(event, fn);
    return this;
  }

  /**
   * Where to send someone to allow scrobbling; Last.fm sends them back to
   * `callback` with `token`.
   * @param {string} callback
   * @returns {string}
   */
  authorizeUrl (callback) {
    const url = new URL(AUTH);
    url.searchParams.set('api_key', this.settings.apiKey);
    url.searchParams.set('cb', callback);
    return url.toString();
  }

  /**
   * Trade the token Last.fm sent back for a session, and keep it for this listener.
   * @param {string} account Account key.
   * @param {string} token
   * @returns {Promise<{ name: string }>}
   */
  async link (account, token) {
    if (!this.enabled) throw Object.assign(new Error('Last.fm is not set up.'), { status: 503 });
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(String(token || ''))) throw Object.assign(new Error('Last.fm sent no token.'), { status: 400 });
    let result;
    try {
      result = await this._call('auth.getSession', { token });
    } catch (error) {
      throw Object.assign(new Error(`Last.fm refused the link: ${error.message}`), { status: 502 });
    }
    const session = result && result.session;
    if (!session || !session.key || !session.name) throw Object.assign(new Error('Last.fm refused the link.'), { status: 502 });
    const name = String(session.name).slice(0, 64);
    await this.soundtrack.saveRecord('lastfm', `link-${this.soundtrack.personId(account)}`, { name, key: String(session.key), linkedAt: this.settings.now() });
    return { name };
  }

  /**
   * Stop scrobbling for this listener.
   * @param {string} account
   * @returns {Promise<void>}
   */
  async unlink (account) {
    await this.soundtrack.saveRecord('lastfm', `link-${this.soundtrack.personId(account)}`, { unlinkedAt: this.settings.now() });
  }

  /**
   * The Last.fm account linked to this listener, by name, or null.
   * @param {string} account
   * @returns {Promise<{ name: string }|null>}
   */
  async linked (account) {
    const link = await this._link(account);
    return link ? { name: link.name } : null;
  }

  async _link (account) {
    if (!account) return null;
    const record = await this.soundtrack.record('lastfm', `link-${this.soundtrack.personId(account)}`);
    return record && record.key ? record : null;
  }

  async _linkedPresent (room) {
    const links = [];
    for (const account of new Set(this.settings.present(room) || [])) {
      const link = await this._link(account);
      if (link) links.push({ account, link });
    }
    return links;
  }

  async _onPlay (event) {
    const parsed = parseTrack(event.track);
    const listening = new Set();
    this._playing.set(event.room, { entry: event.entry.id, listening });
    if (!parsed) return;
    for (const { account, link } of await this._linkedPresent(event.room)) {
      listening.add(account);
      await this._call('track.updateNowPlaying', {
        artist: parsed.artist,
        track: parsed.track,
        duration: Math.round(event.track.duration) || undefined,
        sk: link.key
      }, { post: true }).catch(() => {});
    }
  }

  // Scrobble for whoever had the room open at the start and still does now.
  async _onEnded (event) {
    const playing = this._playing.get(event.room);
    if (playing && playing.entry === event.entry) this._playing.delete(event.room);
    if (event.down) return;
    const parsed = parseTrack(event.track);
    const heard = (event.endedAt - event.startedAt) / 1000;
    if (!parsed || !scrobbles(event.track.duration, heard)) return;
    const from = playing && playing.entry === event.entry ? playing.listening : null;
    for (const { account, link } of await this._linkedPresent(event.room)) {
      if (from && !from.has(account)) continue;
      await this._call('track.scrobble', {
        artist: parsed.artist,
        track: parsed.track,
        timestamp: Math.floor(event.startedAt / 1000),
        duration: Math.round(event.track.duration) || undefined,
        chosenByUser: 0,
        sk: link.key
      }, { post: true }).catch(() => {});
    }
  }

  async _call (method, params, options = {}) {
    const query = { method, api_key: this.settings.apiKey };
    for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) query[key] = String(value);
    query.api_sig = signature(query, this.settings.apiSecret);
    query.format = 'json';
    const body = new URLSearchParams(query);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = options.post
        ? await this.settings.fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), signal: controller.signal })
        : await this.settings.fetch(`${API}?${body}`, { signal: controller.signal });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json || json.error) throw new Error((json && json.message) || `Last.fm answered ${response.status}.`);
      return json;
    } finally {
      clearTimeout(timer);
    }
  }
}

module.exports = LastFM;
