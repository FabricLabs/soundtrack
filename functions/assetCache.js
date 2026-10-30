'use strict';

/**
 * Cache headers for the built site: a client script at its current
 * `?v=<version>` URL never changes, so it is immutable; everything else
 * outside `/services` (the page itself, images, styles) revalidates, so a
 * new build shows up on the next load.
 * @param {Array<{ src: string, version: string }>} clients Compiled client scripts.
 * @returns {function(Object, Object, Function): void} Middleware.
 */
function assetCache (clients) {
  const current = new Map(clients.map((client) => [client.src, client.version]));
  return function (req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/services' || url.pathname.startsWith('/services/')) return next();
    const immutable = current.has(url.pathname) && url.searchParams.get('v') === current.get(url.pathname);
    res.setHeader('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    next();
  };
}

module.exports = assetCache;
