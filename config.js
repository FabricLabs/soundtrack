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
      key: process.env.SOUNDTRACK_LASTFM_KEY       || 'key here'
    , secret: process.env.SOUNDTRACK_LASTFM_SECRET || 'secret here'
  },
  soundcloud: {
      id: process.env.SOUNDTRACK_SOUNDCLOUD_ID         || 'id here'
    , secret: process.env.SOUNDTRACK_SOUNDCLOUD_SECRET || 'secret here'
  }
}