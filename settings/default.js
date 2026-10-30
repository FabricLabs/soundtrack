'use strict';

// Defaults; `settings/local.js` (gitignored) may override any of these.
// Secrets come from the environment only.
const env = process.env;

module.exports = {
  name: 'soundtrack',
  // Public origin: links, and the origin Passport sign-in is pinned to.
  siteUrl: env.SOUNDTRACK_URL || `http://localhost:${env.SOUNDTRACK_PORT || 15005}`,
  // The published page, compiled by `npm run build` into `assets/`.
  site: {
    name: 'soundtrack.io',
    siteUrl: 'https://soundtrack.io',
    sourceUrl: 'https://github.com/FabricLabs/soundtrack',
    description: 'Listen to music with your friends: rooms with a voted queue, on the web and in Discord voice channels.'
  },
  http: {
    interface: env.SOUNDTRACK_INTERFACE || '127.0.0.1',
    port: Number(env.SOUNDTRACK_PORT || 15005)
  },
  store: {
    path: env.SOUNDTRACK_STORE || 'stores/soundtrack'
  },
  // The room Discord servers play until someone picks another with /join.
  room: {
    slug: env.SOUNDTRACK_ROOM || 'lobby',
    name: env.SOUNDTRACK_ROOM_NAME || 'Lobby'
  },
  queue: {
    maxEntries: 200, // per room
    maxDuration: 20 * 60, // seconds per track
    maxPerCurator: 10 // upcoming entries one person may hold
  },
  // Account keys (`fabric:<x-only pubkey>`, `discord:<id>`) that moderate every room.
  admins: (env.SOUNDTRACK_ADMINS || '').split(',').map((account) => account.trim()).filter(Boolean),
  // When a queue runs out and someone is listening, play a song people chose
  // in that room before, not one played there in the last `recentMs`.
  autoplay: {
    enabled: env.SOUNDTRACK_AUTOPLAY !== '0',
    recentMs: 3 * 60 * 60 * 1000
  },
  ffmpeg: env.SOUNDTRACK_FFMPEG || 'ffmpeg',
  // Each room as an MP3 stream at /services/soundtrack/rooms/<slug>/stream.
  stream: {
    enabled: env.SOUNDTRACK_STREAM !== '0',
    bitrate: 128, // kbit/s
    maxListeners: Number(env.SOUNDTRACK_STREAM_MAX || 200) // across every room
  },
  // Scrobbling: an API account from https://www.last.fm/api/account/create
  // (callback `<siteUrl>/services/soundtrack/lastfm/callback`).
  lastfm: {
    apiKey: env.LASTFM_API_KEY || null,
    apiSecret: env.LASTFM_API_SECRET || null
  },
  resolver: {
    ytdlp: env.SOUNDTRACK_YTDLP || 'yt-dlp',
    ffprobe: env.SOUNDTRACK_FFPROBE || 'ffprobe',
    timeoutMs: 30000
  },
  // Fabric Passport sign-in on the site. Challenges are issued only for these
  // origins; empty means `siteUrl`, or any loopback origin while it is one.
  passport: {
    origins: (env.SOUNDTRACK_PASSPORT_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean)
  },
  discord: {
    token: env.DISCORD_BOT_TOKEN || null,
    voiceIdleMs: 5 * 60 * 1000
  }
};
