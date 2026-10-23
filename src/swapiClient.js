// The ONLY file that talks to swapi.dev. Everything else goes through dataService.js.
// Protects the public API: memory cache, disk cache, de-duplicated in-flight calls,
// a queue that spaces real calls out, and a timeout.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const ctx = require('./requestContext');

const CACHE_DIR = config.cacheDir;
const memory = new Map();   // key -> { at, value }
const inflight = new Map(); // key -> Promise (two requests for the same thing share one call)
const stats = { networkCalls: 0, memoryHits: 0, diskHits: 0, failures: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fresh = (entry) => entry && Date.now() - entry.at < config.cacheTtlMs;
const diskFile = (key) => path.join(CACHE_DIR, key.replace(/[^a-z0-9-]/gi, '_') + '.json');

// Throttle: calls wait in a single queue so they START at least MIN_INTERVAL_MS apart,
// even when many arrive at once (e.g. Promise.all over 18 film characters).
let queue = Promise.resolve();
let lastCallAt = 0;
function throttled(fn) {
  const turn = queue.then(async () => {
    const wait = config.minIntervalMs - (Date.now() - lastCallAt);
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
  });
  queue = turn.catch(() => {});
  return turn.then(fn);
}

async function fetchJson(url) {
  return throttled(async () => {
    stats.networkCalls++;
    ctx.count('upstreamCalls');
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.upstreamTimeoutMs),
    });
    if (res.status === 404) return null;
    if (res.status === 429) throw new Error('SWAPI rate limit hit (429)');
    if (!res.ok) throw new Error(`SWAPI responded ${res.status}`);
    return res.json();
  });
}

function remember(key, value) {
  const entry = { at: Date.now(), value };
  memory.set(key, entry);
  fs.promises.mkdir(CACHE_DIR, { recursive: true })
    .then(() => fs.promises.writeFile(diskFile(key), JSON.stringify(entry)))
    .catch(() => {}); // the disk cache is a bonus; never fail a request because of it
}

/** Cache-first lookup. Returns { value, source: 'cache' | 'live' }. */
async function cached(key, load, onEntry = () => {}) {
  const m = memory.get(key);
  if (fresh(m)) { stats.memoryHits++; return { value: m.value, source: 'cache' }; }

  try {
    const saved = JSON.parse(fs.readFileSync(diskFile(key), 'utf8'));
    if (fresh(saved)) {
      stats.diskHits++;
      memory.set(key, saved);
      onEntry(saved);
      return { value: saved.value, source: 'cache' };
    }
  } catch { /* no disk entry yet */ }

  if (!inflight.has(key)) {
    const job = load()
      .then((value) => { remember(key, value); onEntry({ at: Date.now(), value }); return { value, source: 'live' }; })
      .finally(() => inflight.delete(key));
    inflight.set(key, job);
  }
  return inflight.get(key);
}

const idOf = (url) => /\/(\d+)\/?$/.exec(url || '')?.[1];

/** Put every item of a full list into the single-object cache, so getOne() costs nothing. */
function prime(resource, { at, value }) {
  for (const item of value || []) {
    const id = idOf(item.url);
    if (id && !fresh(memory.get(`${resource}-${id}`))) memory.set(`${resource}-${id}`, { at, value: item });
  }
}

/** After a restart, a full list saved on disk can answer single lookups without the network. */
const checkedDisk = new Set();
function primeFromDisk(resource) {
  if (checkedDisk.has(resource)) return;
  checkedDisk.add(resource);
  try {
    const saved = JSON.parse(fs.readFileSync(diskFile(`${resource}-all`), 'utf8'));
    if (fresh(saved)) prime(resource, saved);
  } catch { /* no saved list */ }
}

/** One object, e.g. getOne('people', '1'). value is null when SWAPI says 404. */
function getOne(resource, id) {
  primeFromDisk(resource);
  return cached(`${resource}-${id}`, () => fetchJson(`${config.swapiBase}/${resource}/${id}/`));
}

/** Every object of a resource. SWAPI pages by 10, so this follows `next` until the end. */
function getAll(resource) {
  return cached(`${resource}-all`, async () => {
    const items = [];
    let url = `${config.swapiBase}/${resource}/`;
    while (url) {
      const page = await fetchJson(url);
      items.push(...(page?.results || []));
      // only follow links back to SWAPI itself
      url = page?.next && page.next.startsWith(config.swapiBase) ? page.next : null;
    }
    return items;
  }, (entry) => prime(resource, entry));
}

/**
 * Several objects of one resource. If more than a few are missing from the cache, fetching
 * the whole list (at most 9 pages) is faster AND politer than one request per object.
 */
async function getMany(resource, ids) {
  primeFromDisk(resource);
  const missing = ids.filter((id) => !fresh(memory.get(`${resource}-${id}`)));
  let source = 'cache';
  if (missing.length > 4) {
    const all = await getAll(resource);
    if (all.source === 'live') source = 'live';
  }
  const results = await Promise.all(ids.map((id) => getOne(resource, String(id))));
  if (results.some((r) => r.source === 'live')) source = 'live';
  return { value: results.map((r) => r.value), source };
}

module.exports = { getOne, getAll, getMany, stats };
