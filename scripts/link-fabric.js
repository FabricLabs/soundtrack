'use strict';

// Point `node_modules/@fabric/{core,http,discord,doorman}` at sibling checkouts
// for local development. Override with FABRIC_CORE / FABRIC_HTTP /
// FABRIC_DISCORD / FABRIC_DOORMAN. Name packages to link only those:
// `npm run link:fabric -- doorman`.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
// Absolute paths: a relative symlink target would resolve from node_modules/@fabric, not the cwd.
const targets = {
  core: path.resolve(process.env.FABRIC_CORE || path.join(root, '../fabric-clean')),
  http: path.resolve(process.env.FABRIC_HTTP || path.join(root, '../fabric-http')),
  discord: path.resolve(process.env.FABRIC_DISCORD || path.join(root, '../fabric-discord')),
  doorman: path.resolve(process.env.FABRIC_DOORMAN || path.join(root, '../doorman'))
};

const only = process.argv.slice(2);
for (const name of only) {
  if (!targets[name]) {
    console.error(`unknown package: ${name} (one of ${Object.keys(targets).join(', ')})`);
    process.exit(1);
  }
}

for (const [name, target] of Object.entries(targets)) {
  if (only.length && !only.includes(name)) continue;
  if (!fs.existsSync(target)) {
    console.warn(`skip @fabric/${name}: ${target} does not exist`);
    continue;
  }
  const dest = path.join(root, 'node_modules', '@fabric', name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { recursive: true, force: true });
  fs.symlinkSync(target, dest, 'dir');
  console.log(`linked @fabric/${name} -> ${target}`);
}
