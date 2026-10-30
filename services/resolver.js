'use strict';

const { execFile } = require('child_process');
const path = require('path');
const { parseSource } = require('../functions/sourceUri');

/**
 * Run a command and resolve with its stdout.
 * @private
 */
function run (command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: options.timeoutMs || 30000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if (error.code === 'ENOENT') return reject(new Error(`${command} not found; install it or set its path in settings`));
        const detail = String(stderr || '').trim().split('\n').filter(Boolean).pop();
        return reject(new Error(detail || error.message));
      }
      resolve(String(stdout));
    });
  });
}

/**
 * Finds what a listener asked for (a link or a search) with yt-dlp, and
 * the playable audio URL when it's time to play.
 */
class Resolver {
  /**
   * @param {Object} [settings]
   * @param {string} [settings.ytdlp] yt-dlp binary.
   * @param {string} [settings.ffprobe] ffprobe binary (for audio file links).
   * @param {number} [settings.timeoutMs]
   * @param {Function} [settings.run] `(command, args, { timeoutMs }) => Promise<stdout>`, for tests.
   */
  constructor (settings = {}) {
    this.settings = Object.assign({ ytdlp: 'yt-dlp', ffprobe: 'ffprobe', timeoutMs: 30000 }, settings);
    this._run = this.settings.run || run;
  }

  async _json (command, args) {
    const stdout = await this._run(command, args, { timeoutMs: this.settings.timeoutMs });
    try {
      return JSON.parse(stdout);
    } catch (_) {
      throw new Error(`${command} returned something other than JSON`);
    }
  }

  /**
   * Look up a link or search text.
   * @param {string} input
   * @returns {Promise<{ source: Object, title: string, artist: string|null, duration: number|null, thumbnail: string|null, live: boolean }>}
   */
  async lookup (input) {
    const source = parseSource(input);
    if (source && source.type === 'direct') {
      try {
        return await this._probe(source);
      } catch (_) { /* yt-dlp's generic extractor may still know it */ }
    }
    const target = source ? source.uri : `ytsearch1:${String(input).trim()}`;
    let info = await this._json(this.settings.ytdlp, ['-J', '--no-playlist', '--no-warnings', '--', target]);
    if (!source) {
      info = Array.isArray(info.entries) ? info.entries.find(Boolean) : null;
      if (!info) throw new Error('Nothing found for that search.');
    }
    const found = source && source.type !== 'link'
      ? source
      : (parseSource(info.webpage_url || info.original_url || (info.id ? `https://www.youtube.com/watch?v=${info.id}` : '')) || source);
    return {
      source: found,
      title: String(info.track || info.title || found.uri),
      artist: info.artist || info.uploader || info.channel || null,
      duration: Number.isFinite(info.duration) ? info.duration : null,
      thumbnail: info.thumbnail || null,
      live: !!info.is_live
    };
  }

  async _probe (source) {
    const info = await this._json(this.settings.ffprobe, ['-v', 'error', '-show_entries', 'format=duration:format_tags=title,artist', '-of', 'json', '--', source.uri]);
    const format = info.format || {};
    const tags = format.tags || {};
    const duration = Number(format.duration);
    return {
      source,
      title: tags.title || decodeURIComponent(path.basename(new URL(source.uri).pathname)),
      artist: tags.artist || null,
      duration: Number.isFinite(duration) ? duration : null,
      thumbnail: null,
      live: false
    };
  }

  /**
   * The audio to hand ffmpeg right now (stream URLs expire, so ask at play time).
   * @param {{ source: Object }} track
   * @returns {Promise<{ url: string, headers: Object }>}
   */
  async stream (track) {
    const source = track.source;
    if (source.type === 'direct') return { url: source.uri, headers: {} };
    const info = await this._json(this.settings.ytdlp, ['-j', '--no-playlist', '--no-warnings', '-f', 'bestaudio/best', '--', source.uri]);
    if (!info.url) throw new Error('No playable audio for that track.');
    return { url: info.url, headers: info.http_headers || {} };
  }
}

module.exports = Resolver;
