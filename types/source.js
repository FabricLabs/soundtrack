'use strict';

const Interface = require('@fabric/core/types/interface');
const Remote = require('@fabric/core/types/remote');

class Source extends Interface {
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      authority: 'codingsoundtrack.org'
    }, this.settings, settings);

    this.remote = new Remote({
      authority: this.settings.authority
    });

    return this;
  }

  async _startImport () {
    let result = null;

    try {
      result = await this.remote._GET('/tracks');
    } catch (exception) {
      this.emit('error', exception);
    }

    console.log('got remote:', result);
  }

  async start () {
    this._startImport();
    this.emit('ready');
  }
}

module.exports = Source;
