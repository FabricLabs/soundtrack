'use strict';

// A room's queue, as plain data: `{ current, entries }`.
// `current` is `{ entry, startedAt }` (ms) or null; `entries` are upcoming,
// kept in play order. An entry is
// `{ id, track, curator: { id, name }, requestedAt, votes: { <voter>: 1 | -1 } }`.
// Every function returns a new queue and leaves its input alone.

/**
 * An empty queue.
 * @returns {{ current: null, entries: Array }}
 */
function emptyQueue () {
  return { current: null, entries: [] };
}

/**
 * The sum of an entry's votes.
 * @param {Object} entry
 * @returns {number}
 */
function score (entry) {
  return Object.values((entry && entry.votes) || {}).reduce((sum, value) => sum + value, 0);
}

/**
 * Play order: highest score first, then the oldest request (the sort is
 * stable, so requests in the same millisecond keep the order they came in).
 * @param {Array} entries
 * @returns {Array}
 */
function sortEntries (entries) {
  return [...entries].sort((a, b) => (score(b) - score(a)) || (a.requestedAt - b.requestedAt));
}

/**
 * Add an entry to the upcoming list.
 * @param {Object} queue
 * @param {Object} entry
 * @returns {Object}
 */
function enqueue (queue, entry) {
  return { ...queue, entries: sortEntries([...queue.entries, { votes: {}, ...entry }]) };
}

/**
 * Set one voter's vote on an upcoming entry. `value` is 1, -1, or 0 (clear);
 * the voter's latest vote replaces any earlier one.
 * @param {Object} queue
 * @param {string} entryId
 * @param {string} voter
 * @param {number} value
 * @returns {Object}
 * @throws {Error} when the entry isn't upcoming or the value is not 1, -1, 0.
 */
function vote (queue, entryId, voter, value) {
  if (![1, -1, 0].includes(value)) throw new Error('A vote is 1, -1, or 0.');
  const index = queue.entries.findIndex((entry) => entry.id === entryId);
  if (index === -1) throw new Error('That song is not in the queue.');
  const entry = queue.entries[index];
  const votes = { ...entry.votes };
  if (value === 0) delete votes[voter];
  else votes[voter] = value;
  const entries = [...queue.entries];
  entries[index] = { ...entry, votes };
  return { ...queue, entries: sortEntries(entries) };
}

/**
 * Remove an upcoming entry.
 * @param {Object} queue
 * @param {string} entryId
 * @returns {Object}
 */
function remove (queue, entryId) {
  return { ...queue, entries: queue.entries.filter((entry) => entry.id !== entryId) };
}

/**
 * Start the next entry (or nothing, when the list is empty).
 * @param {Object} queue
 * @param {number} now
 * @returns {Object}
 */
function advance (queue, now) {
  const [next, ...rest] = sortEntries(queue.entries);
  return { current: next ? { entry: next, startedAt: now } : null, entries: rest };
}

/**
 * Seconds into the current track, or null when nothing plays.
 * @param {Object} queue
 * @param {number} now
 * @returns {number|null}
 */
function position (queue, now) {
  if (!queue.current) return null;
  return Math.max(0, (now - queue.current.startedAt) / 1000);
}

/**
 * When the current track ends (ms), or null when nothing plays.
 * @param {Object} queue
 * @returns {number|null}
 */
function endsAt (queue) {
  if (!queue.current) return null;
  const duration = queue.current.entry.track && queue.current.entry.track.duration;
  return queue.current.startedAt + Math.round(Number(duration || 0) * 1000);
}

module.exports = { emptyQueue, score, sortEntries, enqueue, vote, remove, advance, position, endsAt };
