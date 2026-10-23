// Rate limiting on our own API (both REST and GraphQL share one budget per client).
process.env.DATA_SOURCE = 'snapshot';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/server');
const { startApp, gql } = require('./helpers/fakeSwapi');

let app;
before(async () => { app = await startApp(createApp, { rateLimitPerMinute: 3 }); });
after(() => app.close());

test('after the limit, both APIs answer 429 in their own error style', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await fetch(`${app.base}/api/films/1/`)).status, 200);

  const rest = await fetch(`${app.base}/api/films/1/`);
  assert.equal(rest.status, 429);
  assert.ok(rest.headers.get('retry-after'));
  assert.match((await rest.json()).error, /Too many requests/);

  const g = await gql(app.base, '{ film(id: "1") { title } }');
  assert.equal(g.errors[0].extensions.code, 'RATE_LIMITED');
});
