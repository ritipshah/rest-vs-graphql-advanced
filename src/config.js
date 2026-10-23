// Every setting in one place. Values come from .env (see .env.example) with safe defaults.
const path = require('path');
require('dotenv').config({ quiet: true });

const int = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

// `node src/server.js --offline` (works on Windows too), or the old USE_FIXTURES=true.
const forceSnapshot = process.argv.includes('--offline') || process.env.USE_FIXTURES === 'true';

module.exports = {
  port: int(process.env.PORT, 3000),

  // live     = call swapi.dev (cached, throttled); falls back to the snapshot if SWAPI fails
  // snapshot = never touch the network; use data/swapi-snapshot.json (tests, offline demos)
  dataSource: forceSnapshot ? 'snapshot' : (process.env.DATA_SOURCE || 'live'),
  swapiBase: (process.env.SWAPI_BASE || 'https://swapi.dev/api').replace(/\/$/, ''),
  cacheTtlMs: int(process.env.CACHE_TTL_SECONDS, 86400) * 1000, // SWAPI's data never changes
  minIntervalMs: int(process.env.MIN_INTERVAL_MS, 300),
  upstreamTimeoutMs: int(process.env.UPSTREAM_TIMEOUT_MS, 8000),
  cacheDir: process.env.CACHE_DIR || path.join(__dirname, '..', '.cache'),

  // GraphQL protection (see src/graphql/limits.js)
  maxDepth: int(process.env.MAX_QUERY_DEPTH, 6),
  maxCost: int(process.env.MAX_QUERY_COST, 5000),

  // Our own API's protection (see src/middleware.js)
  rateLimitPerMinute: int(process.env.RATE_LIMIT_PER_MINUTE, 1500), // one Film credits race is ~140 requests
  maxSimulatedLatencyMs: 2000,
};
