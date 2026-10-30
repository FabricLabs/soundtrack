'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const HTMLCompiler = require('../types/HTMLCompiler');
const assetCache = require('../functions/assetCache');
const settings = require('../settings/default');

describe('Compiled site', function () {
  let compiler;
  let outputs;
  let html;

  before(function () {
    compiler = new HTMLCompiler(settings.site);
    outputs = compiler.outputs();
    html = outputs.find((output) => output.file === 'index.html').content;
  });

  it('matches the committed build (run `npm run build`)', function () {
    for (const output of outputs) {
      const file = path.join(ROOT, 'assets', output.file);
      assert.ok(fs.existsSync(file), `${output.file} is built`);
      assert.strictEqual(fs.readFileSync(file, 'utf8'), output.content, `${output.file} is current`);
    }
    const scripts = fs.readdirSync(path.join(ROOT, 'assets', 'scripts'));
    const built = outputs.map((output) => output.file);
    for (const name of scripts) assert.ok(built.includes(`scripts/${name}`), `assets/scripts/${name} comes from a component`);
  });

  it('loads the client script at its versioned URL', function () {
    for (const client of compiler.spa.clientScripts()) {
      assert.match(client.url, /\?v=[0-9a-f]{12}$/);
      assert.ok(html.includes(`<script src="${client.url}" defer></script>`));
      assert.doesNotThrow(() => new vm.Script(client.compile(), { filename: client.src }));
    }
  });

  it('has every element the client looks up, once', function () {
    const ids = new Set();
    for (const client of compiler.spa.clientScripts()) {
      for (const match of client.compile().matchAll(/\$\('([a-z0-9-]+)'\)/g)) ids.add(match[1]);
    }
    assert.ok(ids.size > 20);
    for (const id of ids) {
      const count = html.split(`id="${id}"`).length - 1;
      assert.strictEqual(count, 1, `#${id} appears ${count} times`);
    }
  });

  it('caches only the current client script for good', function () {
    const client = compiler.spa.clientScripts()[0];
    const cache = assetCache([client]);
    const header = (url) => {
      const res = { headers: {}, setHeader (name, value) { this.headers[name] = value; } };
      let passed = false;
      cache({ method: 'GET', url }, res, () => { passed = true; });
      assert.ok(passed);
      return res.headers['Cache-Control'];
    };
    assert.strictEqual(header(client.url), 'public, max-age=31536000, immutable');
    assert.strictEqual(header(`${client.src}?v=000000000000`), 'no-cache');
    assert.strictEqual(header('/rooms/lobby'), 'no-cache');
    assert.strictEqual(header('/services/soundtrack'), undefined);
  });

  it('keeps the original look', function () {
    for (const href of ['/css/bootstrap.min.css', '/css/darkstrap-v0.9.0.css', '/css/bootstrap-responsive.min.css']) {
      assert.ok(html.includes(`href="${href}"`));
      assert.ok(fs.existsSync(path.join(ROOT, 'assets', href)), `${href} is shipped`);
    }
    for (const image of ['/img/binding_dark.png', '/img/txture.png', '/img/soundtrack.gif']) {
      assert.ok(html.includes(image));
      assert.ok(fs.existsSync(path.join(ROOT, 'assets', image)), `${image} is shipped`);
    }
    assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'img', 'glyphicons-halflings-white.png')));
    assert.match(html, /class="span3 padded-left"[\s\S]*class="span6 unpadded"[\s\S]*class="span3 padded-right"/);
  });
});
