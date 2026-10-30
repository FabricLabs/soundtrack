'use strict';

const crypto = require('crypto');
const { sourceKey } = require('./sourceUri');

/**
 * A track's id: the sha256 of its source key, so the same song linked twice
 * is one track.
 * @param {{ type: string, id: string }} source
 * @returns {string} 64 hex characters.
 */
function trackId (source) {
  return crypto.createHash('sha256').update(sourceKey(source)).digest('hex');
}

/**
 * A fresh queue entry id (12 hex characters).
 * @returns {string}
 */
function entryId () {
  return crypto.randomBytes(6).toString('hex');
}

module.exports = { trackId, entryId };
