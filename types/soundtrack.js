'use strict';

const Interface = require('@fabric/core/types/interface');

class Soundtrack extends Interface {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: '@fabric/soundtrack'
    }, this.settings, settings);

    return this;
  }
}

module.exports = Soundtrack;