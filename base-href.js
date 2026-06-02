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
  // Heuristic: if the URL path contains "/dogechain-pulse/" anywhere after
  // the host, use it as the base prefix. Otherwise use "./" (apex).
  var path = location.pathname || '/';
  var m = path.match(/^(\/[^\/?#]+\/)/); // first segment, e.g. "/dogechain-pulse/"
  var baseHref = m ? m[1] : './';
  var b = document.createElement('base');
  b.href = baseHref;
  document.head.appendChild(b);
})();
