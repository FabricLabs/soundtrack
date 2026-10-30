'use strict';

const fs = require('fs');
const path = require('path');

const SoundtrackSPA = require('./SoundtrackSPA');

/**
 * Compile the Soundtrack HTML document and the browser code of its components
 * (`SoundtrackSPA#clientScripts`, written under `scripts/` beside it).
 */
class HTMLCompiler {
  /**
   * @param {Object} [settings] Site settings (`name`, `siteUrl`, `sourceUrl`, `description`).
   */
  constructor (settings = {}) {
    this.settings = settings;
    this.spa = new SoundtrackSPA(settings);
  }

  /**
   * @returns {Array<{ file: string, content: string }>} Every file a build writes, relative to `assets/`.
   */
  outputs () {
    return [{ file: 'index.html', content: this.spa._renderWith('') }].concat(
      this.spa.clientScripts().map((client) => ({ file: client.src.replace(/^\/+/, ''), content: client.compile() }))
    );
  }

  /**
   * @param {string} [target] Path of `index.html`; client scripts go beside it.
   * @returns {Promise<string[]>} Files written.
   */
  async compileTo (target = 'assets/index.html') {
    const dir = path.dirname(target);
    const written = [];
    for (const output of this.outputs()) {
      const file = output.file === 'index.html' ? target : path.join(dir, output.file);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, output.content);
      written.push(file);
    }
    return written;
  }
}

module.exports = HTMLCompiler;
