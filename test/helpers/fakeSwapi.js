// A fake swapi.dev for tests: serves the snapshot with SWAPI's real URL and paging format,
// so the live code path (caching, paging, throttling) is tested without touching the internet.
const http = require('http');
const snapshot = require('../../data/swapi-snapshot.json');

function startFakeSwapi() {
  const log = [];
  let down = false;
  const server = http.createServer((req, res) => {
    log.push(req.url);
    if (down) { res.writeHead(503); return res.end(); }
    const base = `http://localhost:${server.address().port}/api`;
    const relink = (obj) => JSON.parse(JSON.stringify(obj).replaceAll('https://swapi.dev/api', base));
    const url = new URL(req.url, base);
    const m = /^\/api\/(\w+)\/(?:(\d+)\/)?$/.exec(url.pathname);
    const table = m && snapshot[m[1]];
    if (!table) { res.writeHead(404); return res.end('{}'); }
    res.setHeader('Content-Type', 'application/json');
    if (m[2]) {
      const item = table[m[2]];
      res.writeHead(item ? 200 : 404);
      return res.end(JSON.stringify(item ? relink(item) : { detail: 'Not found' }));
    }
    const all = Object.values(table);
    const page = Number(url.searchParams.get('page') || 1);
    const results = all.slice((page - 1) * 10, page * 10);
    const next = page * 10 < all.length ? `${base}/${m[1]}/?page=${page + 1}` : null;
    res.end(JSON.stringify({ count: all.length, next, previous: null, results: results.map(relink) }));
  });
  return new Promise((resolve) => server.listen(0, () => resolve({
    base: `http://localhost:${server.address().port}/api`,
    log,
    setDown: (v) => { down = v; },
    close: () => new Promise((r) => server.close(r)),
  })));
}

/** Start our app on a random port. */
function startApp(createApp, options) {
  return new Promise((resolve) => {
    const server = createApp(options).listen(0, () => resolve({
      base: `http://localhost:${server.address().port}`,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

const gql = (base, query, variables, headers = {}) => fetch(`${base}/graphql`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ query, variables }),
}).then((r) => r.json());

module.exports = { startFakeSwapi, startApp, gql };
