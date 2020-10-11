'use strict';

const Soundtrack = require('../types/soundtrack');
const settings = require('../settings/local');

async function main () {
  const soundtrack = new Soundtrack(settings);
  await soundtrack.start();
}

main().catch((exception) => {
  console.error('[SOUNDTRACK:NODE]', 'Main Process Exception:', exception);
});