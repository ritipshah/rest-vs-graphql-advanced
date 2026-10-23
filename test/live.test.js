// Live mode against a FAKE swapi.dev running locally: tests caching, paging and the
// visible fallback without ever calling the real public API.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startFakeSwapi, startApp, gql } = require('./helpers/fakeSwapi');

let fake, app;
before(async () => {
  fake = await startFakeSwapi();
  process.env.DATA_SOURCE = 'live';
  process.env.SWAPI_BASE = fake.base;
  process.env.MIN_INTERVAL_MS = '5';
  process.env.CACHE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swapi-cache-'));
  const { createApp } = require('../src/server'); // load AFTER setting env
  app = await startApp(createApp);
});
after(async () => { await app.close(); await fake.close(); });

test('first request goes to SWAPI, the second is served from cache', async () => {
  const before = fake.log.length;
  const a = await fetch(`${app.base}/api/people/1/`);
  assert.equal(a.headers.get('x-data-source'), 'live');
  assert.equal(fake.log.length, before + 1);

  const b = await fetch(`${app.base}/api/people/1/`);
  assert.equal(b.headers.get('x-data-source'), 'cache');
  assert.equal(fake.log.length, before + 1); // no new upstream call
  assert.equal((await b.json()).homeworld, `${app.base}/api/planets/1/`);
});

test('lists follow SWAPI paging to collect every item, then prime the cache', async () => {
  const page = await fetch(`${app.base}/api/planets/?limit=100&fields=name`).then((r) => r.json());
  assert.equal(page.count, 60);
  assert.ok(fake.log.filter((u) => u.startsWith('/api/planets/')).length >= 6); // 6 SWAPI pages
  const before = fake.log.length;
  await fetch(`${app.base}/api/planets/42/`);
  assert.equal(fake.log.length, before); // already cached from the list
});

test('GraphQL batches many missing people into one paged list fetch', async () => {
  const r = await gql(app.base, '{ planet(id: "1") { name residents { name } } }');
  assert.equal(r.data.planet.name, 'Tatooine');
  assert.equal(r.data.planet.residents.length, 10);
  assert.ok(fake.log.includes('/api/people/?page=9'), 'fetched the people list');
  assert.ok(!fake.log.includes('/api/people/43/'), 'no single fetch per resident');
});

test('if SWAPI goes down, data still arrives and is clearly flagged as fallback', async () => {
  fake.setDown(true);
  const res = await fetch(`${app.base}/api/vehicles/4/`); // not cached yet
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-data-source'), 'fallback');
  assert.equal((await res.json()).name, 'Sand Crawler');

  // circuit breaker: even after SWAPI recovers, we wait 30 s before asking again
  fake.setDown(false);
  const before = fake.log.length;
  const again = await fetch(`${app.base}/api/vehicles/6/`);
  assert.equal(again.headers.get('x-data-source'), 'fallback');
  assert.equal(fake.log.length, before);
});
