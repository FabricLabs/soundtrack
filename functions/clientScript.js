'use strict';

const crypto = require('crypto');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * Browser code that lives in a component module as one function.
 * `npm run build` compiles it to `assets/<src>`, where the page loads it with
 * a deferred `<script>` at `url`: `src` plus `?v=` and a hash of the compiled
 * file, so a new build is a new URL. Only the function's source text reaches
 * the browser, called with `window`: it must not use anything from the module
 * around it.
 * @param {string} src Site path of the compiled file (`/scripts/<name>.js`).
 * @param {Function} fn
 * @param {string} file The component's own `__filename`.
 * @returns {{ src: string, file: string, version: string, url: string, compile: function(): string, tag: function(): string }}
 */
function clientScript (src, fn, file) {
  const from = path.relative(ROOT, file).split(path.sep).join('/');
  const compile = () => `// Compiled from ${from} by \`npm run build\`. Edit the component, not this file.\n'use strict';\n\n(${fn.toString()})(window);\n`;
  let version = null;
  return {
    src,
    file: from,
    compile,
    get version () {
      if (!version) version = crypto.createHash('sha256').update(compile()).digest('hex').slice(0, 12);
      return version;
    },
    get url () {
      return `${src}?v=${this.version}`;
    },
    tag () {
      return `<script src="${this.url}" defer></script>`;
    }
  };
}

module.exports = clientScript;
