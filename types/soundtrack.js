'use strict';

const Interface = require('@fabric/core/types/interface');
const Remote = require('@fabric/core/types/remote');

/**
 * Implements the Soundtrack type.
 */
class Soundtrack extends Interface {
  /**
   * Create an instance of {@link Soundtrack}.
   * @param {Object} [settings] List of options.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: '@fabric/soundtrack'
    }, this.settings, settings);

    return this;
  }

  _loadURI (uri) {
    const remote = new Remote(uri);
    const request = remote._GET();

    this.emit('message', `Request: ${JSON.stringify(request, null, '  ')}`);
  }
}

module.exports = Soundtrack;
