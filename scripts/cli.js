#!/usr/bin/env node
'use strict';

// Constants
const FABRIC_PORT = 7777;
const FABRIC_SEED = process.env.FABRIC_SEED || '';
const SETTINGS = require('../settings/local');

// Fabric Types
const CLI = require('@fabric/core/types/cli');
const Soundtrack = require('../types/soundtrack');

// Fabric Services
const Matrix = require('@fabric/core/services/matrix');

// Main Process
async function main () {
  // Command Line Interface
  const cli = new CLI({
    listen: true,
    port: FABRIC_PORT,
    seed: FABRIC_SEED,
    services: [
      'matrix'
    ]
  });

  // Service Registration
  cli._registerService('matrix', Matrix);

  // Engine Core
  const soundtrack = new Soundtrack(SETTINGS);

  // Engine Events
  soundtrack.on('ready', (msg) => {
    console.log('[SOUNDTRACK:CLI]', 'Soundtrack emitted ready!');
  });

  // Start Components
  await cli.start();
  await soundtrack.start();
}

// Exception Handling
main().catch((exception) => {
  console.error('[SOUNDTRACK:CLI]', 'Main Process Exception:', exception);
});
