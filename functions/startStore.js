'use strict';

/**
 * Start a `@fabric/core` Store and throw unless its database opened. The
 * Store opens LevelDB without awaiting it and only logs failures, so a locked
 * store would otherwise "start" and drop every write.
 * @param {Object} store `@fabric/core` Store.
 * @returns {Promise<Object>} the store
 */
async function startStore (store) {
  await store.start();
  const where = (store.settings && store.settings.path) || 'store';
  if (!store.db) throw new Error(`Could not open database at ${where}`);
  try {
    await store.db.open();
  } catch (error) {
    const cause = (error && error.cause) || error;
    const reason = cause && cause.code === 'LEVEL_LOCKED'
      ? 'it is locked by another process (is another soundtrack running from this directory?)'
      : (cause && cause.message) || String(cause);
    throw new Error(`Could not open database at ${where}: ${reason}`, { cause: error });
  }
  return store;
}

module.exports = startStore;
