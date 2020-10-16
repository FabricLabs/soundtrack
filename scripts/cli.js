#!/usr/bin/env node
'use strict';

// Constants
const FABRIC_PORT = process.env.FABRIC_PORT || 7777;
const FABRIC_SEED = process.env.FABRIC_SEED || '';

// Settings
const SETTINGS = require('../settings/local');

// Dependencies
const { Command } = require('commander');

// Fabric Types
const CLI = require('@fabric/core/types/cli');
const Soundtrack = require('../types/soundtrack');

// Fabric Services
const Matrix = require('@fabric/core/services/matrix');
const HTTP = require('@fabric/http/types/server');

// Main Process
async function main () {
  // Argument Parsing
  const program = new Command();

  program.name('soundtrack');
  program.option('--earn', 'Enable earning.');
  program.option('--seed', 'Load from mnemonic seed.');
  program.option('--xpub', 'Load from xpub.');
  program.parse(process.argv);

  // Enable Earning for --earn
  if (program.earn) {
    SETTINGS.earn = true;
  }

  // Command Line Interface
  const cli = new CLI({
    earn: SETTINGS.earn,
    listen: true, // whether to open Fabric P2P port or not
    port: FABRIC_PORT,
    seed: FABRIC_SEED,
    services: SETTINGS.services
  });

  // Service Registration
  cli._registerService('matrix', Matrix);

  // HTTP Interface
  const web = new HTTP({
    authority: 'soundtrack.io',
    resources: {
      'Track': {},
      'Play': {},
      'Room': {},
      'Source': {},
      'Vote': {}
    }
  });

  // Engine Core
  const soundtrack = new Soundtrack(SETTINGS);

  soundtrack.on('message', (msg) => {
    cli._appendMessage(JSON.stringify(msg));
    cli._sendToAllServices(msg);
  });

  // Engine Events
  soundtrack.on('ready', (msg) => {
    console.log('[SOUNDTRACK:CLI]', 'Soundtrack emitted ready!');
  });

  // HTTP Events
  web.on('ready', (msg) => {
    console.log('[SOUNDTRACK:CLI]', 'HTTP server emitted ready!');
  });

  // Start Components
  await cli.start();
  await soundtrack.start();
  await web.start();
}

// Exception Handling
main().catch((exception) => {
  console.error('[SOUNDTRACK:CLI]', 'Main Process Exception:', exception);
});
