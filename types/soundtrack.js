'use strict';

const Interface = require('@fabric/core/types/interface');
const Remote = require('@fabric/core/types/remote');

const Source = require('./source');

/**
 * Implements the Soundtrack type.
 * @module @services/soundtrack
 */
class Soundtrack extends Interface {
  /**
   * Create an instance of {@link Soundtrack}.
   * @augments Interface
   * @param {Object} [settings] List of options.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: '@fabric/soundtrack',
      authority: 'hub.fabric.pub',
      socket: 'services/soundtrack.sock'
    }, this.settings, settings);

    this.server = null;
    this._state = {
      rooms: {},
      sources: {},
      tracks: {},
      users: {}
    };

    return this;
  }

  async _loadTrack (track) {
    if (!track.sources) throw new Error('Track must have sources:', track);

    const map = {};

    for (let i = 0; i < track.sources.length; i++) {
      track.sources[i].map(async (x) => {
        map[x.id] = new Source(x)
        return map[x.id];
      });
    }

    this.emit('message', `Loaded sources: ${JSON.stringify(map, null, '  ')}`);
  }

  async _loadURI (path) {
    const remote = new Remote({
      authority: this.settings.authority
    });

    const request = await remote._GET(path);
    this.emit('message', `Request: ${JSON.stringify(request, null, '  ')}`);
  }

  async start () {
    this.emit('ready');
  }
}

module.exports = Soundtrack;
