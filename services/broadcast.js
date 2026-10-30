'use strict';

const { spawn } = require('child_process');

const PROTOCOLS = 'http,https,tcp,tls,crypto,hls,httpproxy';

/**
 * ffmpeg arguments that encode one room's audio as MP3 on stdout, paced in
 * real time: what is playing from `seek` seconds in, or silence.
 * @param {Object} source `{ url, headers, seek }`, or null for silence.
 * @param {Object} [options]
 * @param {number} [options.bitrate] kbit/s (default 128).
 * @returns {string[]}
 */
function encoderArgs (source, options = {}) {
  const bitrate = Math.max(32, Math.min(320, Number(options.bitrate) || 128));
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin', '-re'];
  if (source && source.url) {
    args.push('-protocol_whitelist', PROTOCOLS, '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5');
    const headers = Object.entries(source.headers || {})
      .map(([key, value]) => [String(key).replace(/[\r\n:]/g, ''), String(value).replace(/[\r\n]/g, '')])
      .filter(([key]) => key)
      .map(([key, value]) => `${key}: ${value}\r\n`).join('');
    if (headers) args.push('-headers', headers);
    if (source.seek > 0) args.push('-ss', Number(source.seek).toFixed(3));
    args.push('-i', source.url);
  } else {
    args.push('-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo');
  }
  args.push('-vn', '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', `${bitrate}k`, '-f', 'mp3', 'pipe:1');
  return args;
}

/**
 * Each room as an endless MP3 stream (`GET …/rooms/<slug>/stream`), for any
 * player, radio app, or speaker that takes a URL. One ffmpeg per room, run
 * only while someone is connected; it follows the room's clock (a late
 * joiner hears the song where everyone else is) and plays silence while the
 * room is idle. A listener who can't keep up is dropped rather than buffered.
 * Listeners count as the room's audience, so the auto-DJ plays for them.
 */
class Broadcast {
  /**
   * @param {Object} settings
   * @param {Object} settings.soundtrack Soundtrack service.
   * @param {string} [settings.ffmpeg] ffmpeg binary.
   * @param {number} [settings.bitrate] kbit/s.
   * @param {number} [settings.maxListeners] Across every room.
   * @param {number} [settings.maxBuffered] Bytes a listener may fall behind before being dropped.
   * @param {Function} [settings.spawn] `child_process.spawn` (tests).
   * @param {Function} [settings.now] Clock (tests).
   */
  constructor (settings = {}) {
    this.settings = Object.assign({
      soundtrack: null,
      ffmpeg: 'ffmpeg',
      bitrate: 128,
      maxListeners: 200,
      maxBuffered: 512 * 1024,
      spawn,
      now: () => Date.now()
    }, Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== undefined)));
    this.soundtrack = this.settings.soundtrack;
    this.rooms = new Map();
    this._count = 0;
    this._removeAudience = null;
    this._forward = {
      play: (event) => this._restart(event.room),
      idle: (event) => this._restart(event.room)
    };
  }

  start () {
    for (const [event, fn] of Object.entries(this._forward)) this.soundtrack.on(event, fn);
    this._removeAudience = this.soundtrack.addAudience((slug) => this.listeners(slug));
    return this;
  }

  stop () {
    for (const [event, fn] of Object.entries(this._forward)) this.soundtrack.removeListener(event, fn);
    if (this._removeAudience) this._removeAudience();
    for (const [slug, room] of this.rooms) {
      for (const res of room.clients) res.end();
      this._kill(room);
      this.rooms.delete(slug);
    }
    this._count = 0;
    return this;
  }

  /**
   * How many are listening to a room's stream.
   * @param {string} slug
   * @returns {number}
   */
  listeners (slug) {
    const room = this.rooms.get(slug);
    return room ? room.clients.size : 0;
  }

  /**
   * Serve a room's stream on this response until the listener goes.
   * The room must exist (the caller checks).
   * @param {Object} req
   * @param {Object} res
   * @param {string} slug
   */
  attach (req, res, slug) {
    if (this._count >= this.settings.maxListeners) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ error: 'Too many listeners right now.' }));
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('icy-name', 'soundtrack.io');
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    let room = this.rooms.get(slug);
    if (!room) {
      room = { clients: new Set(), child: null, generation: 0 };
      this.rooms.set(slug, room);
    }
    room.clients.add(res);
    this._count++;
    const leave = () => this._leave(slug, res);
    req.on('close', leave);
    res.on('error', leave);
    if (!room.child && room.clients.size === 1) {
      this._run(slug, room);
      this.soundtrack.wake(slug).catch(() => {});
    }
  }

  _leave (slug, res) {
    const room = this.rooms.get(slug);
    if (!room || !room.clients.delete(res)) return;
    this._count--;
    if (room.clients.size) return;
    room.generation++;
    this._kill(room);
    this.rooms.delete(slug);
  }

  _kill (room) {
    if (!room.child) return;
    const child = room.child;
    room.child = null;
    child.stdout.removeAllListeners('data');
    try {
      child.kill('SIGKILL');
    } catch (_) { /* already gone */ }
  }

  _restart (slug) {
    const room = this.rooms.get(slug);
    if (room) this._run(slug, room);
  }

  // Start (or restart) a room's encoder on what it is playing now. A newer
  // run supersedes one still asking for its source.
  async _run (slug, room) {
    const generation = ++room.generation;
    let source = null;
    try {
      const view = await this.soundtrack.room(slug);
      if (view.current) {
        try {
          const stream = await this.soundtrack.stream(view.current.track);
          const seek = Math.max(0, (this.settings.now() - view.current.startedAt) / 1000);
          source = { url: stream.url, headers: stream.headers, seek };
        } catch (error) {
          if (generation !== room.generation) return;
          await this.soundtrack.reportDown(slug, view.current.id, error.message).catch(() => {});
          return;
        }
      }
    } catch (_) {
      source = null;
    }
    if (generation !== room.generation || !room.clients.size) return;
    this._kill(room);
    this._spawn(slug, room, source, generation);
  }

  _spawn (slug, room, source, generation) {
    let child;
    try {
      child = this.settings.spawn(this.settings.ffmpeg, encoderArgs(source, { bitrate: this.settings.bitrate }), { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (_) {
      return this._close(room);
    }
    room.child = child;
    child.on('error', () => {
      if (room.child === child) this._close(room);
    });
    child.stdout.on('data', (chunk) => {
      for (const res of [...room.clients]) {
        if (res.writableLength > this.settings.maxBuffered) {
          res.destroy();
          this._leave(slug, res);
          continue;
        }
        res.write(chunk);
      }
    });
    child.on('exit', () => {
      if (room.child !== child || generation !== room.generation) return;
      room.child = null;
      // The source ended or broke before the clock moved on: silence until it does.
      if (source && room.clients.size) this._spawn(slug, room, null, generation);
    });
  }

  // ffmpeg can't run here: end every stream of the room.
  _close (room) {
    room.child = null;
    for (const res of [...room.clients]) res.end();
  }
}

module.exports = Broadcast;
module.exports.encoderArgs = encoderArgs;
