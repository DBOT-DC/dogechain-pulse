/**
 * base-href.js
 * ------------
 * Detects where the site is being served from and inserts a <base> tag so
 * all relative URLs (./app.js, ./styles.css, ./icon.svg, fetch('./data/projects.json'))
 * resolve correctly in both deployment modes:
 *
 *   1. Standalone:  https://dogechain-pulse.vercel.app/         → base = "./"
 *   2. Path prefix: https://www.dbot.dog/dogechain-pulse/       → base = "/dogechain-pulse/"
 *
 * Runs synchronously in <head> before any other resource is loaded, so by
 * the time the parser hits <link rel="stylesheet" href="./styles.css"> the
 * <base> is already in place.
 *
 * This is the only piece that needs to be deployment-aware; the rest of the
 * site uses relative URLs as usual.
 */
(function () {
  var path = location.pathname || '/';

  // Heuristic: if the URL path is anything other than the apex ("/"), treat
  // the first path segment as a deployment subpath and set the base to it
  // (with a trailing slash). Otherwise default to relative "./" for the apex.
  //
  // Examples:
  //   "/"                  → "./"                       (standalone apex)
  //   "/dogechain-pulse"   → "/dogechain-pulse/"        (path prefix)
  //   "/dogechain-pulse/"  → "/dogechain-pulse/"        (path prefix w/ slash)
  //   "/foo/bar"           → "/foo/"                    (deep path — first segment is the deploy root)
  var segments = path.replace(/^\/+/, '').split('/').filter(Boolean);
  var baseHref;
  if (segments.length === 0) {
    baseHref = './';
  } else {
    baseHref = '/' + segments[0] + '/';
  }

  var b = document.createElement('base');
  b.href = baseHref;
  document.head.appendChild(b);
})();
