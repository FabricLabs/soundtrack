'use strict';

const crypto = require('crypto');

// Video decorations that are not part of a song's title.
const NOISE = /\s*[([{](?:[^)\]}]*\b(?:official|lyrics?|lyric video|music video|audio|video|visuali[sz]er|hd|hq|4k|remaster(?:ed)?(?: \d{4})?|explicit|clean|live session)\b[^)\]}]*)[)\]}]/gi;
const DASH = /\s+[-–—]\s+/;

/**
 * Artist and title for Last.fm from what a track is called: "Artist - Title"
 * (minus "(Official Video)" and the like), else the uploader as the artist.
 * @param {{ title: string, artist?: string }} track
 * @returns {{ artist: string, track: string }|null} null when there is no artist to credit
 */
function parseTrack (track = {}) {
  const title = String(track.title || '').replace(NOISE, '').replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const parts = title.split(DASH);
  if (parts.length >= 2 && parts[0].trim() && parts.slice(1).join(' - ').trim()) {
    return { artist: parts[0].trim(), track: parts.slice(1).join(' - ').replace(/^["“]|["”]$/g, '').trim() };
  }
  const artist = String(track.artist || '').replace(/\s*-\s*Topic$/i, '').replace(/VEVO$/i, '').trim();
  return artist ? { artist, track: title } : null;
}

/**
 * Last.fm's `api_sig`: md5 of every parameter (but `format` and `callback`)
 * as name + value, sorted by name, then the shared secret.
 * @param {Object} params
 * @param {string} secret
 * @returns {string}
 */
function signature (params, secret) {
  const base = Object.keys(params)
    .filter((key) => key !== 'format' && key !== 'callback' && params[key] !== undefined && params[key] !== null)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join('');
  return crypto.createHash('md5').update(base + secret, 'utf8').digest('hex');
}

/**
 * Last.fm's rule: a track longer than 30 s counts once half of it, or
 * 4 minutes, was heard.
 * @param {number} duration Seconds.
 * @param {number} heard Seconds.
 * @returns {boolean}
 */
function scrobbles (duration, heard) {
  if (!(duration > 30)) return false;
  return heard >= Math.min(duration / 2, 240);
}

module.exports = { parseTrack, signature, scrobbles };
