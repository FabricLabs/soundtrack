module.exports = {
  app: {
      safe: process.env.SOUNDTRACK_APP_SAFE || false
    , host: process.env.SOUNDTRACK_APP_HOST || 'soundtrack.io'
    , port: process.env.SOUNDTRACK_APP_PORT || 13000
  },
  database: {
      name: process.env.SOUNDTRACK_DB_NAME || 'soundtrack'
    , host: 'localhost'
  },
  sessions: {
      key: 'put yourself a fancy little key here'
  },
  connection: {
      clientTimeout: 2 * 60 * 1000
    , checkInterval: 30 * 1000
  },
  lastfm: {
      key: process.env.SOUNDTRACK_LASTFM_KEY       || '89a54d8c58f533944fee0196aa227341'
    , secret: process.env.SOUNDTRACK_LASTFM_SECRET || 'bd39b0b60cd7cfe82d5dff3747b08dd6'
  },
  soundcloud: {
      id: process.env.SOUNDTRACK_SOUNDCLOUD_ID         || '7fbc3f4099d3390415d4c95f16f639ae'
    , secret: process.env.SOUNDTRACK_SOUNDCLOUD_SECRET || '28f12a65a5e84e853732e3bc49aefe2e'
  }
}