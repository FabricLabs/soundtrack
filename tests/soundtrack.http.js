'use strict';

const assert = require('assert');
const Soundtrack = require('../types/soundtrack');

describe('@fabric/soundtrack', function () {
  describe('@services/http', function () {
    it('should start and stop smoothly', async function () {
      const soundtrack = new Soundtrack();

      await soundtrack.start();
      await soundtrack.stop();

      assert.ok(soundtrack);
      assert('ok');
    });
  });
});
