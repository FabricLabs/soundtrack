'use strict';

const package = require('../package');
const Fabric = require('@fabric/core');

class Soundtrack extends Fabric.Service {
  constructor (settings = {}) {
    this.settings = Object.assign({
      name: 'soundtrack',
      version: package.version
    }, settings);

    this.documents = new Fabric.Collection();
    this.rooms = new Fabric.Collection();

    this.swarm = new Fabric.Swarm();
    this.worker = new Fabric.Worker();

    this.state = {};
  }

  async _getState () {
    return {
      documents: await this.documents.list(),
      rooms: await this.documents.list()
    }
  }

  async stop () {
    this.status = 'stopping';
    await this.swarm.stop();
    await this.worker.stop();
    this.status = 'stopped';
  }

  async start () {
    this.status = 'starting';
    await this.worker.start();
    await this.swarm.start();
    this.status = 'started';
  }
}

module.exports = Soundtrack;