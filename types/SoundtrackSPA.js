'use strict';

const FabricSPA = require('@fabric/http/types/spa');

const escapeHtml = require('../functions/escapeHtml');
const SiteLayout = require('../components/SiteLayout');
const RoomsPage = require('../components/RoomsPage');
const RoomPage = require('../components/RoomPage');
const HistoryPage = require('../components/HistoryPage');
const PersonPage = require('../components/PersonPage');
const SetPage = require('../components/SetPage');
const SoundtrackApp = require('../components/SoundtrackApp');

const DEFAULTS = {
  name: 'soundtrack.io',
  siteUrl: 'https://soundtrack.io',
  sourceUrl: 'https://github.com/FabricLabs/soundtrack',
  description: 'Listen to music with your friends: rooms with a voted queue, on the web and in Discord voice channels.'
};

// The views in the page, in order; every route shows one of them.
const VIEWS = [RoomsPage, RoomPage, HistoryPage, PersonPage, SetPage];
const PAGES = [SiteLayout, ...VIEWS];

// Bootstrap 2 and Darkstrap, as the original site loaded them.
const STYLESHEETS = [
  '/css/bootstrap.min.css',
  '/css/darkstrap-v0.9.0.css',
  '/css/bootstrap-responsive.min.css'
];

/**
 * The one HTML document every route serves (`assets/index.html`), compiled
 * from the components by `npm run build`; the client script picks the view.
 */
class SoundtrackSPA extends FabricSPA {
  _site (key) {
    return this.settings[key] !== undefined && this.settings[key] !== null ? this.settings[key] : DEFAULTS[key];
  }

  /**
   * Browser code compiled into `assets/scripts/`.
   * @returns {Array<{ src: string, file: string, compile: function(): string, tag: function(): string }>}
   */
  clientScripts () {
    return [SoundtrackApp.client];
  }

  /**
   * @returns {string} Every component's CSS.
   */
  styles () {
    return PAGES.map((component) => component.styles()).join('\n');
  }

  /**
   * @param {string} [html=''] Ignored; the document is static.
   * @returns {string}
   */
  _renderWith (html = '') {
    const name = this._site('name');
    const siteUrl = String(this._site('siteUrl')).replace(/\/+$/, '');
    const description = this._site('description');
    const title = `${name} | music for all.`;
    const props = { name, sourceUrl: this._site('sourceUrl') };
    const body = SiteLayout.render(Object.assign({}, props, {
      body: VIEWS.map((component) => component.render(props)).join('\n')
    }));
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${escapeHtml(name)}">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(siteUrl)}/">
  <meta property="og:image" content="${escapeHtml(siteUrl)}/img/soundtrack.png">
  <link rel="icon" href="/favicon.ico">
${STYLESHEETS.map((href) => `  <link rel="stylesheet" href="${href}">`).join('\n')}
  <style>${this.styles()}
  </style>
${this.clientScripts().map((client) => `  ${client.tag()}`).join('\n')}
</head>
<body>
  ${body}
</body>
</html>
`;
  }
}

module.exports = SoundtrackSPA;
