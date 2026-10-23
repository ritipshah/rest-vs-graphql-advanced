// Run once before a LIVE demo (server must be running): fetches every SWAPI list once
// (about 28 polite, throttled requests) so the cache is warm and the demo is instant.
// The cache is kept on disk for 24 hours (CACHE_TTL_SECONDS).
const config = require('../src/config');

const BASE = `http://localhost:${config.port}`;
const RESOURCES = ['people', 'planets', 'films', 'species', 'starships', 'vehicles'];

(async () => {
  const sources = new Set();
  for (const r of RESOURCES) {
    const t = performance.now();
    const res = await fetch(`${BASE}/api/${r}/?limit=1&fields=url`);
    const body = await res.json();
    const source = res.headers.get('x-data-source');
    sources.add(source);
    console.log(`${r.padEnd(10)} ${String(body.count).padStart(3)} items  from ${source.padEnd(8)} ${Math.round(performance.now() - t)} ms`);
  }
  if (sources.has('fallback')) {
    console.log('\nSWAPI is unreachable right now, so the app is serving the offline snapshot (flagged as "fallback").');
    console.log('Check your internet connection, or present with `npm run dev:offline`.');
  } else if (sources.has('snapshot')) {
    console.log('\nThe server is in offline mode, so there is nothing to warm.');
  } else {
    console.log('\nCache is warm for the next 24 hours.');
  }
})().catch(() => {
  console.error('Is the server running? Start it with `npm start` in another terminal.');
  process.exit(1);
});
