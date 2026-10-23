// Shared data layer: REST and GraphQL both call ONLY these functions, so any difference
// we measure comes from the API style, not from the data source.
//
// Every call is counted (requestContext) and tagged with where the data came from:
//   live = fetched from swapi.dev just now   cache = SWAPI data we already had
//   snapshot = offline mode                  fallback = SWAPI failed, so we used the snapshot
// The source is sent back to the client (X-Data-Source header / GraphQL extensions),
// so a demo can never silently switch to offline data.
const config = require('./config');
const swapi = require('./swapiClient');
const ctx = require('./requestContext');
const { RESOURCES, parseUrl, snapshot } = require('./resources');

const sortById = (items) => [...items].sort((a, b) => idOf(a) - idOf(b));
const idOf = (item) => Number(parseUrl(item?.url)?.id);

// Circuit breaker: after SWAPI fails once, stop asking it for 30 s and answer from the
// snapshot straight away. Otherwise a hanging SWAPI would make every request wait for its
// timeout, one after another.
const BREAK_MS = 30_000;
let swapiDownUntil = 0;
let lastWarning = 0;
function markDown(err) {
  swapi.stats.failures++;
  swapiDownUntil = Date.now() + BREAK_MS;
  if (Date.now() - lastWarning > 60_000) {
    lastWarning = Date.now();
    console.warn(`[data] SWAPI failed (${err.message}). Serving the local snapshot, flagged as "fallback", and retrying SWAPI in ${BREAK_MS / 1000}s.`);
  }
}

/** Try SWAPI; if it fails, answer from the snapshot and say so. */
async function fromSource(liveFn, snapshotFn) {
  if (config.dataSource === 'snapshot') {
    ctx.addSource('snapshot');
    return snapshotFn();
  }
  if (Date.now() < swapiDownUntil) {
    ctx.addSource('fallback');
    return snapshotFn();
  }
  try {
    const { value, source } = await liveFn();
    ctx.addSource(source);
    return value;
  } catch (err) {
    markDown(err);
    ctx.addSource('fallback');
    return snapshotFn();
  }
}

function assertResource(resource) {
  if (!RESOURCES.includes(resource)) throw new Error(`Unknown resource "${resource}"`);
}

/** All items of a resource, sorted by id. */
async function list(resource) {
  assertResource(resource);
  ctx.count('dataCalls');
  const items = await fromSource(
    () => swapi.getAll(resource),
    () => Object.values(snapshot[resource]),
  );
  return sortById(items);
}

/** One item or null. */
async function one(resource, id) {
  assertResource(resource);
  ctx.count('dataCalls');
  return fromSource(
    () => swapi.getOne(resource, String(id)),
    () => snapshot[resource][id] ?? null,
  );
}

/**
 * Many items of one resource in ONE data-layer call (used by the DataLoader).
 * With a database this would be a single `WHERE id IN (...)` query. SWAPI has no batch
 * endpoint, so in live mode swapiClient answers from cache, or fetches the whole list once.
 */
async function many(resource, ids) {
  assertResource(resource);
  ctx.count('dataCalls');
  return fromSource(
    () => swapi.getMany(resource, ids),
    () => ids.map((id) => snapshot[resource][id] ?? null),
  );
}

/** Follow a SWAPI URL such as 'https://swapi.dev/api/planets/1/'. */
function byUrl(url) {
  const p = parseUrl(url);
  return p ? one(p.resource, p.id) : Promise.resolve(null);
}

/** Case-insensitive match on name (or title for films). */
function search(items, text) {
  if (!text) return items;
  const needle = text.toLowerCase();
  return items.filter((i) => (i.name || i.title || '').toLowerCase().includes(needle));
}

module.exports = { RESOURCES, parseUrl, idOf, list, one, many, byUrl, search, stats: swapi.stats };
