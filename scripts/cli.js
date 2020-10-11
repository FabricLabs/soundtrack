#!/usr/bin/env node
'use strict';

const FABRIC_SEED = process.env.FABRIC_SEED || '';
const SETTINGS = require('../settings/local');

const CLI = require('@fabric/core/types/cli');
const Soundtrack = require('../types/soundtrack');

const Matrix = require('@fabric/core/services/matrix');

async function main () {
  const cli = new CLI({
    listen: true,
    seed: FABRIC_SEED
  });

  cli._registerService('matrix', Matrix);

  const soundtrack = new Soundtrack(SETTINGS);

  soundtrack.on('ready', (msg) => {
    console.log('[SOUNDTRACK:CLI]', 'Soundtrack emitted ready!');
  });

  await cli.start();
  await soundtrack.start();
}

main().catch((exception) => {
  console.error('[SOUNDTRACK:CLI]', 'Main Process Exception:', exception);
});
