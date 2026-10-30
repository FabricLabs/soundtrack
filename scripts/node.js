#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Discord gateway intents: Guilds (1) and GuildVoiceStates (128). Slash
// commands need none; voice needs both. Nothing privileged.
const DISCORD_INTENTS = [1, 128];

function loadSettings () {
  const local = path.join(ROOT, 'settings', 'local.js');
  return require(fs.existsSync(local) ? local : path.join(ROOT, 'settings', 'default.js'));
}

/**
 * Start Soundtrack: the rooms service, the web player and JSON API, and (with
 * a bot token) Discord through Doorman.
 * @param {Object} [settings]
 * @returns {Promise<{ soundtrack: Object, http: Object, web: Object, doorman: Object|null, stop: Function }>}
 */
async function main (settings = loadSettings()) {
  const HTTPServer = require('@fabric/http/types/server');
  const Resolver = require('../services/resolver');
  const Soundtrack = require('../services/soundtrack');
  const SoundtrackWeb = require('../services/web');
  const Broadcast = require('../services/broadcast');
  const LastFM = require('../services/lastfm');
  const SoundtrackApp = require('../components/SoundtrackApp');
  const assetCache = require('../functions/assetCache');

  const log = (...parts) => console.log('[SOUNDTRACK]', ...parts);
  const warn = (...parts) => console.error('[SOUNDTRACK]', ...parts);

  const soundtrack = new Soundtrack({
    path: path.resolve(ROOT, settings.store.path),
    room: settings.room,
    queue: settings.queue,
    admins: settings.admins,
    autoplay: settings.autoplay,
    resolver: new Resolver(settings.resolver)
  });
  soundtrack.on('error', (error) => warn(error && error.message ? error.message : error));
  await soundtrack.start();

  const ffmpeg = settings.ffmpeg || 'ffmpeg';
  const stream = settings.stream || {};
  const broadcast = stream.enabled === false
    ? null
    : new Broadcast({ soundtrack, ffmpeg, bitrate: stream.bitrate, maxListeners: stream.maxListeners }).start();
  let web = null;
  const lastfm = new LastFM({ soundtrack, ...settings.lastfm, present: (room) => (web ? web.present(room) : []) }).start();
  if (lastfm.enabled) log('Last.fm scrobbling enabled');

  web = new SoundtrackWeb({ soundtrack, siteUrl: settings.siteUrl, passport: settings.passport, broadcast, lastfm });
  web.start();

  const http = new HTTPServer({
    name: settings.name,
    assets: path.join(ROOT, 'assets'),
    path: path.resolve(ROOT, settings.store.path, '..', 'http'),
    host: settings.http.interface,
    interface: settings.http.interface,
    hostname: new URL(settings.siteUrl).hostname,
    port: settings.http.port,
    spaFallback: true,
    spaFallbackExclude: /^\/services(\/|$)/,
    jsonRpc: { enabled: false },
    sitemap: { enabled: false },
    middlewares: { soundtrack: web.middleware() }
  });
  // Ahead of the `express.static` that HTTPServer mounts in start().
  http.express.use(assetCache([SoundtrackApp.client]));
  http.on('error', (error) => warn(error && error.message ? error.message : error));
  await http.start();
  log(`listening on http://${settings.http.interface}:${settings.http.port} (${settings.siteUrl})`);

  let doorman = null;
  if (settings.discord.token) {
    const Doorman = require('@fabric/doorman');
    const SoundtrackDiscord = require('../services/discord');
    doorman = new Doorman({
      name: settings.name,
      http: false,
      local: false,
      discord: {
        token: settings.discord.token,
        intents: DISCORD_INTENTS,
        ffmpeg,
        voiceIdleMs: settings.discord.voiceIdleMs
      }
    });
    doorman.on('error', (...parts) => warn(...parts));
    doorman.use(SoundtrackDiscord, { soundtrack, siteUrl: settings.siteUrl });
    doorman.enable('discord');
    await doorman.start();
    log('Discord enabled');
  } else {
    log('no DISCORD_BOT_TOKEN; Discord is off');
  }

  const stop = async () => {
    if (doorman) await doorman.stop().catch((error) => warn(error.message));
    web.stop();
    if (broadcast) broadcast.stop();
    lastfm.stop();
    await http.stop().catch((error) => warn(error.message));
    await soundtrack.stop();
  };

  return { soundtrack, http, web, doorman, stop };
}

module.exports = main;
module.exports.main = main;
module.exports.loadSettings = loadSettings;

if (require.main === module) {
  main().then(({ stop }) => {
    let stopping = false;
    const shutdown = (signal) => {
      if (stopping) return;
      stopping = true;
      console.log('[SOUNDTRACK]', `${signal}, stopping…`);
      stop().then(() => process.exit(0), () => process.exit(1));
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  }).catch((error) => {
    console.error('[SOUNDTRACK]', 'could not start:', error);
    process.exit(1);
  });
}
