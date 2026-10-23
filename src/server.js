const path = require('path');
const express = require('express');
const config = require('./config');
const rest = require('./rest');
const gql = require('./graphql');
const openapi = require('./openapi');
const data = require('./dataService');
const requestContext = require('./requestContext');
const { simulatedLatency, rateLimit } = require('./middleware');

function createApp({ rateLimitPerMinute = config.rateLimitPerMinute } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestContext.middleware); // per-request counters (see requestContext.js)
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Both APIs get exactly the same protection and the same simulated network.
  const limiter = rateLimit({ perMinute: rateLimitPerMinute });
  app.use(['/api', '/graphql'], limiter, simulatedLatency);

  app.use('/api', rest);                                        // REST: one URL per resource
  app.use('/graphql', express.json({ limit: '16kb' }));         // a query bigger than 16 KB is refused
  app.all('/graphql', gql.handler);                             // GraphQL: one endpoint for everything

  app.get('/openapi.json', (_req, res) => res.json(openapi.build()));
  app.get('/meta', (_req, res) => res.json({
    dataSource: config.dataSource,
    swapiBase: config.swapiBase,
    limits: { maxDepth: config.maxDepth, maxCost: config.maxCost, rateLimitPerMinute },
    simulatedLatencyMaxMs: config.maxSimulatedLatencyMs,
  }));
  app.get('/health', (_req, res) => res.json({ ok: true, dataSource: config.dataSource, upstream: data.stats }));

  // Errors outside the two routers (e.g. a GraphQL body over 16 KB).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    const message = status === 413 ? 'Request body is too large' : status >= 500 ? 'Server error' : err.message;
    if (req.path.startsWith('/graphql')) return res.status(status).json({ errors: [{ message }] });
    res.status(status).json({ error: message });
  });
  return app;
}

if (require.main === module) {
  createApp().listen(config.port, () => {
    const base = `http://localhost:${config.port}`;
    console.log([
      '',
      `  REST vs GraphQL  (data: ${config.dataSource === 'live' ? `live SWAPI, cached, snapshot fallback` : 'offline snapshot'})`,
      '',
      `  App       ${base}`,
      `  REST      ${base}/api/people/1/`,
      `  GraphQL   ${base}/graphql`,
      `  OpenAPI   ${base}/openapi.json`,
      '',
    ].join('\n'));
  });
}

module.exports = { createApp };
