#!/usr/bin/env node
'use strict';

const path = require('path');

const { loadSettings } = require('./node');
const HTMLCompiler = require('../types/HTMLCompiler');

async function main (settings = loadSettings()) {
  const compiler = new HTMLCompiler(settings.site || {});
  const target = path.resolve(__dirname, '..', 'assets', 'index.html');
  const written = await compiler.compileTo(target);
  return { written: written.map((file) => path.relative(path.resolve(__dirname, '..'), file)) };
}

module.exports = main;

if (require.main === module) {
  main().then((output) => {
    console.log('[BUILD]', output);
  }).catch((exception) => {
    console.error('[BUILD]', '[EXCEPTION]', exception);
    process.exitCode = 1;
  });
}
