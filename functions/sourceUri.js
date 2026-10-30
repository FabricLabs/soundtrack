'use strict';

const net = require('net');

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
const SOUNDCLOUD_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com']);
const AUDIO_EXTENSION = /\.(mp3|ogg|oga|opus|m4a|aac|wav|flac|webm)$/i;

/**
 * Is this hostname this machine or a private network? The server fetches
 * whatever a listener names, so those are refused.
 * @param {string} hostname
 * @returns {boolean}
 */
function isPrivateHost (hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true;
  const family = net.isIP(host);
  if (family === 4) {
    const [a, b] = host.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (family === 6) {
    if (host === '::' || host === '::1') return true;
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateHost(mapped[1]);
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(host);
  }
  return false;
}

/**
 * Read a listener's input as a source, or `null` when it is a search.
 *
 * Sources are `{ type, id, uri }`: `youtube` (video id), `soundcloud`
 * (`user/track`), `direct` (an audio file URL), or `link` (any other web page
 * yt-dlp may know). `uri` is the canonical URL.
 * @param {string} input
 * @returns {{ type: string, id: string, uri: string }|null}
 * @throws {Error} for a URL that isn't http(s) or points at a private host.
 */
function parseSource (input) {
  const text = String(input || '').trim();
  if (!text) throw new Error('Nothing to play.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return null;

  let url;
  try {
    url = new URL(text);
  } catch (_) {
    throw new Error('That link is not a valid URL.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only http and https links can be played.');
  if (url.username || url.password) throw new Error('Links with a username or password are refused.');
  if (isPrivateHost(url.hostname)) throw new Error('Links to private hosts are refused.');

  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(host)) {
    let id = url.searchParams.get('v');
    const parts = url.pathname.split('/').filter(Boolean);
    if (!id && ['shorts', 'embed', 'live', 'v'].includes(parts[0])) id = parts[1];
    if (id && YOUTUBE_ID.test(id)) return youtube(id);
  }
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    if (id && YOUTUBE_ID.test(id)) return youtube(id);
  }
  if (SOUNDCLOUD_HOSTS.has(host)) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 2 && parts[1] !== 'sets' && parts[0] !== 'discover') {
      const id = `${parts[0]}/${parts[1]}`.toLowerCase();
      return { type: 'soundcloud', id, uri: `https://soundcloud.com/${id}` };
    }
    throw new Error('Link a single SoundCloud track, not a profile or playlist.');
  }

  url.hash = '';
  const uri = url.toString();
  if (AUDIO_EXTENSION.test(url.pathname)) return { type: 'direct', id: uri, uri };
  return { type: 'link', id: uri, uri };
}

function youtube (id) {
  return { type: 'youtube', id, uri: `https://www.youtube.com/watch?v=${id}` };
}

/**
 * Stable key for a source: `<type>:<id>`.
 * @param {{ type: string, id: string }} source
 * @returns {string}
 */
function sourceKey (source) {
  return `${source.type}:${source.id}`;
}

module.exports = { parseSource, sourceKey, isPrivateHost, YOUTUBE_ID };
