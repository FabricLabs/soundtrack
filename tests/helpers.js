'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseSource } = require('../functions/sourceUri');

/** A resolver that knows a fixed catalog: input → `{ title, duration, … }`. */
function fakeResolver (catalog = {}) {
  const resolver = {
    lookups: [],
    streams: [],
    failStream: null,
    async lookup (input) {
      resolver.lookups.push(input);
      const known = catalog[input];
      if (!known) throw new Error('Nothing found for that search.');
      return Object.assign({ source: parseSource(known.uri), artist: null, thumbnail: null, live: false }, known);
    },
    async stream (track) {
      resolver.streams.push(track.id);
      if (resolver.failStream) {
        const message = resolver.failStream;
        resolver.failStream = null;
        throw new Error(message);
      }
      return { url: `https://media.example/${track.source.id}.webm`, headers: { Referer: 'x' } };
    }
  };
  return resolver;
}

/** A manual clock with timers that fire on `advance`. */
function fakeClock (start = 1000000) {
  const clock = {
    time: start,
    timers: new Map(),
    nextId: 1,
    now: () => clock.time,
    setTimeout (fn, ms) {
      const id = clock.nextId++;
      clock.timers.set(id, { fn, at: clock.time + ms });
      return id;
    },
    clearTimeout (id) {
      clock.timers.delete(id);
    },
    async advance (ms) {
      clock.time += ms;
      let due;
      while ((due = [...clock.timers].filter(([, timer]) => timer.at <= clock.time)).length) {
        for (const [id, timer] of due) {
          clock.timers.delete(id);
          await timer.fn();
        }
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
  return clock;
}

/** Wait until `test()` is truthy, or fail after `ms`. */
async function until (test, ms = 2000) {
  const end = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() > end) throw new Error('Timed out waiting.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function tempDir (name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `soundtrack-${name}-`));
}

const CATALOG = {
  'song a': { uri: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', title: 'Song A', artist: 'Artist A', duration: 60 },
  'song b': { uri: 'https://www.youtube.com/watch?v=bbbbbbbbbbb', title: 'Song B', duration: 90 },
  'song c': { uri: 'https://soundcloud.com/c/song-c', title: 'Song C', duration: 120 },
  'https://youtu.be/aaaaaaaaaaa': { uri: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', title: 'Song A', duration: 60 },
  live: { uri: 'https://www.youtube.com/watch?v=lllllllllll', title: 'Live', duration: null, live: true },
  long: { uri: 'https://www.youtube.com/watch?v=ooooooooooo', title: 'Long', duration: 3 * 60 * 60 }
};

module.exports = { fakeResolver, fakeClock, until, tempDir, CATALOG };
