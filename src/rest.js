// REST API: one URL per resource, the server decides the shape of every response.
// Related data comes back as URLs the client must follow (that is what causes under-fetching).
//
//   GET /api                              index of resources
//   GET /api/:resource?page=&limit=&search=&fields=&expand=
//   GET /api/:resource/:id?fields=&expand=
//
// Two common REST workarounds are included so the comparison is fair:
//   ?fields=name,height     sparse fieldsets: fights OVER-fetching
//   ?expand=homeworld,films embed related objects: fights UNDER-fetching (like Stripe's API)
const crypto = require('crypto');
const express = require('express');
const data = require('./dataService');
const { DEFINITIONS, parseUrl } = require('./resources');
const ctx = require('./requestContext');

const router = express.Router();
const MAX_LIMIT = 100;

class HttpError extends Error {
  constructor(status, message, details = {}) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// ---------- helpers ----------

const list = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
const origin = (req) => `${req.protocol}://${req.get('host')}`;

/** SWAPI URLs point at swapi.dev; rewrite them to OUR server so clients can follow them. */
function rewriteUrls(item, base) {
  const fix = (v) => {
    const p = typeof v === 'string' ? parseUrl(v) : null;
    return p ? `${base}/api/${p.resource}/${p.id}/` : v;
  };
  return Object.fromEntries(Object.entries(item).map(([k, v]) => [k, Array.isArray(v) ? v.map(fix) : fix(v)]));
}

function readOptions(req, def) {
  const fields = list(req.query.fields);
  const unknown = fields.filter((f) => !def.fields.includes(f));
  if (unknown.length) {
    throw new HttpError(400, `Unknown field(s): ${unknown.join(', ')}`, { validFields: def.fields });
  }
  const expand = list(req.query.expand);
  const badExpand = expand.filter((f) => !def.relations[f]);
  if (badExpand.length) {
    throw new HttpError(400, `Cannot expand: ${badExpand.join(', ')}`, { expandable: Object.keys(def.relations) });
  }
  return { fields, expand };
}

/** Apply ?expand, ?fields and URL rewriting to one raw SWAPI object. */
async function shape(raw, def, { fields, expand }, base) {
  const item = { ...raw };
  // Only expand relations that will actually be sent.
  const toExpand = fields.length ? expand.filter((f) => fields.includes(f)) : expand;
  await Promise.all(toExpand.map(async (field) => {
    const target = def.relations[field];
    const value = raw[field];
    if (Array.isArray(value)) {
      const ids = value.map((u) => parseUrl(u)?.id).filter(Boolean);
      const objects = ids.length ? await data.many(target, ids) : [];
      item[field] = objects.filter(Boolean).map((o) => rewriteUrls(o, base));
    } else if (value) {
      const p = parseUrl(value);
      const obj = p ? await data.one(target, p.id) : null;
      item[field] = obj ? rewriteUrls(obj, base) : null;
    }
  }));
  const out = rewriteUrls(item, base);
  return fields.length ? Object.fromEntries(fields.map((f) => [f, out[f]])) : out;
}

function positiveInt(value, name, { min = 1, max = Infinity, fallback }) {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new HttpError(400, `${name} must be a whole number from ${min} to ${max === Infinity ? 'up' : max}`);
  }
  return n;
}

/**
 * HTTP caching, REST's big advantage: every URL is a cache key.
 * The ETag is a fingerprint of the body. A client that already has the body sends it back in
 * If-None-Match; if nothing changed we answer 304 Not Modified with an EMPTY body.
 * (Done by hand because Express skips the 304 when the browser also sends Cache-Control: no-cache,
 * which browsers always do for requests with a manual If-None-Match.)
 */
function send(req, res, body) {
  const json = JSON.stringify(body);
  const etag = `"${crypto.createHash('sha1').update(json).digest('base64url')}"`;
  ctx.setHeaders(res);
  res.set('Cache-Control', 'public, max-age=60');
  res.set('ETag', etag);
  const sent = String(req.get('if-none-match') || '').split(',').map((t) => t.trim().replace(/^W\//, ''));
  if (sent.includes(etag) || sent.includes('*')) return res.status(304).end();
  res.type('application/json').send(json);
}

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);

// ---------- routes ----------

router.get('/', (req, res) => {
  const base = origin(req);
  send(req, res, {
    ...Object.fromEntries(Object.keys(DEFINITIONS).map((r) => [r, `${base}/api/${r}/`])),
    docs: `${base}/openapi.json`,
  });
});

router.param('resource', (req, _res, next, resource) => {
  if (!DEFINITIONS[resource]) {
    return next(new HttpError(404, `No resource called "${resource}"`, { resources: Object.keys(DEFINITIONS) }));
  }
  req.def = DEFINITIONS[resource];
  next();
});

router.get('/:resource', wrap(async (req, res) => {
  const def = req.def;
  const opts = readOptions(req, def);
  const page = positiveInt(req.query.page, 'page', { fallback: 1 });
  const limit = positiveInt(req.query.limit, 'limit', { max: MAX_LIMIT, fallback: 10 });
  const search = String(req.query.search || '');
  if (search.length > 100) throw new HttpError(400, 'search is too long (max 100 characters)');

  const all = data.search(await data.list(def.name), search);
  const start = (page - 1) * limit;
  const base = origin(req);
  const results = await Promise.all(all.slice(start, start + limit).map((i) => shape(i, def, opts, base)));

  const pageUrl = (p) => {
    const q = new URLSearchParams({ ...req.query, page: String(p) });
    return `${base}/api/${def.name}/?${q}`;
  };
  send(req, res, {
    count: all.length,
    next: start + limit < all.length ? pageUrl(page + 1) : null,
    previous: page > 1 ? pageUrl(page - 1) : null,
    results,
  });
}));

router.get('/:resource/:id', wrap(async (req, res) => {
  const def = req.def;
  if (!/^\d+$/.test(req.params.id)) throw new HttpError(400, 'id must be a number');
  const opts = readOptions(req, def);
  const item = await data.one(def.name, req.params.id);
  if (!item) throw new HttpError(404, `${def.name}/${req.params.id} not found`);
  send(req, res, await shape(item, def, opts, origin(req)));
}));

router.use((req, _res, next) => next(new HttpError(404, `No endpoint at ${req.originalUrl}`, { docs: '/openapi.json' })));

// REST reports problems with HTTP status codes (compare: GraphQL uses an `errors` array).
// eslint-disable-next-line no-unused-vars
router.use((err, _req, res, _next) => {
  const status = err.status || 502;
  if (status >= 500) console.error(err);
  ctx.setHeaders(res);
  res.status(status).json({ error: status >= 500 ? 'Upstream data source failed' : err.message, ...err.details });
});

module.exports = router;
