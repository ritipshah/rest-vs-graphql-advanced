// Per-request counters, so every response can say what it cost:
//   dataCalls     - how many times the API code asked the data layer for something
//   upstreamCalls - how many real HTTP calls went to swapi.dev
//   sources       - where the data came from: live | cache | snapshot | fallback
//
// AsyncLocalStorage (built into Node) keeps one "store" per incoming request, even across
// awaits, so dataService.js can count calls without passing a counter through every function.
const { AsyncLocalStorage } = require('node:async_hooks');

const storage = new AsyncLocalStorage();

function middleware(req, _res, next) {
  storage.run({ dataCalls: 0, upstreamCalls: 0, sources: new Set(), startedAt: performance.now() }, next);
}

const current = () => storage.getStore();

function count(field, by = 1) {
  const store = current();
  if (store) store[field] += by;
}

function addSource(source) {
  current()?.sources.add(source);
}

/** Summary used for response headers (REST) and `extensions` (GraphQL). */
function summary() {
  const s = current();
  if (!s) return null;
  return {
    dataCalls: s.dataCalls,
    upstreamCalls: s.upstreamCalls,
    dataSource: [...s.sources].sort().join(',') || 'none',
    serverMs: Math.round((performance.now() - s.startedAt) * 10) / 10,
  };
}

/** Same numbers as HTTP headers. Server-Timing also shows up in the browser's DevTools. */
function setHeaders(res) {
  const s = summary();
  if (!s || res.headersSent) return;
  res.set('X-Data-Source', s.dataSource);
  res.set('X-Data-Calls', String(s.dataCalls));
  res.set('X-Upstream-Calls', String(s.upstreamCalls));
  res.set('Server-Timing', `app;dur=${s.serverMs};desc="${s.dataCalls} data calls"`);
}

module.exports = { middleware, count, addSource, summary, setHeaders };
