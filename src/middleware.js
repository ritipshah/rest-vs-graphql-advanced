// Small Express middlewares used by both APIs.
const config = require('./config');

/**
 * Simulated network latency, for demos only.
 * On localhost every request takes ~1 ms, which hides REST's real cost: each extra request
 * is another round trip over the network. A client can send `X-Simulated-Latency: 150`
 * and the server waits that many ms before answering, like a slow mobile connection.
 * Without the header nothing changes.
 */
function simulatedLatency(req, _res, next) {
  const ms = Number(req.get('x-simulated-latency'));
  if (!Number.isFinite(ms) || ms <= 0) return next();
  setTimeout(next, Math.min(ms, config.maxSimulatedLatencyMs));
}

/**
 * Rate limit for OUR API: N requests per client IP per minute (fixed window).
 * Depth/cost limits stop one huge GraphQL query; this stops a flood of small ones.
 */
function rateLimit({ perMinute = config.rateLimitPerMinute } = {}) {
  const windows = new Map(); // ip -> { start, count }
  setInterval(() => {
    const now = Date.now();
    for (const [ip, w] of windows) if (now - w.start >= 60_000) windows.delete(ip);
  }, 60_000).unref();

  return (req, res, next) => {
    const now = Date.now();
    let w = windows.get(req.ip);
    if (!w || now - w.start >= 60_000) {
      w = { start: now, count: 0 };
      windows.set(req.ip, w);
    }
    w.count++;
    const resetIn = Math.ceil((w.start + 60_000 - now) / 1000);
    res.set('RateLimit-Limit', String(perMinute));
    res.set('RateLimit-Remaining', String(Math.max(0, perMinute - w.count)));
    res.set('RateLimit-Reset', String(resetIn));
    if (w.count <= perMinute) return next();

    res.set('Retry-After', String(resetIn));
    const message = `Too many requests: limit is ${perMinute} per minute. Try again in ${resetIn}s.`;
    // Answer in the style of whichever API was called.
    if (req.path.startsWith('/graphql') || req.baseUrl === '/graphql') {
      return res.status(429).json({ errors: [{ message, extensions: { code: 'RATE_LIMITED' } }] });
    }
    return res.status(429).json({ error: message });
  };
}

module.exports = { simulatedLatency, rateLimit };
