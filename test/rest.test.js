// REST API tests. Offline snapshot mode: never touches swapi.dev.
process.env.DATA_SOURCE = 'snapshot';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/server');
const { startApp } = require('./helpers/fakeSwapi');

let app;
before(async () => { app = await startApp(createApp); });
after(() => app.close());
const get = (path, headers) => fetch(app.base + path, { headers });

test('a person comes back with relations as links to OUR server', async () => {
  const res = await get('/api/people/1/');
  const p = await res.json();
  assert.equal(p.name, 'Luke Skywalker');
  assert.equal(p.homeworld, `${app.base}/api/planets/1/`);
  assert.equal(p.films.length, 4);
});

test('?fields trims the response (fights over-fetching)', async () => {
  const p = await get('/api/people/1/?fields=name,height').then((r) => r.json());
  assert.deepEqual(p, { name: 'Luke Skywalker', height: '172' });
});

test('?fields with a typo is a 400 that lists the valid fields', async () => {
  const res = await get('/api/people/1/?fields=nmae');
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /nmae/);
  assert.ok(body.validFields.includes('name'));
});

test('?expand embeds related objects in one request (fights under-fetching)', async () => {
  const p = await get('/api/people/1/?fields=name,homeworld&expand=homeworld').then((r) => r.json());
  assert.equal(p.homeworld.name, 'Tatooine');
  assert.equal((await get('/api/people/1/?expand=nope')).status, 400);
});

test('lists are paginated, searchable and link to the next page', async () => {
  const page = await get('/api/planets/?limit=5&page=2&fields=name').then((r) => r.json());
  assert.equal(page.count, 60);
  assert.equal(page.results.length, 5);
  assert.match(page.next, /page=3/);
  assert.match(page.previous, /page=1/);
  const found = await get('/api/people/?search=skywalker&fields=name').then((r) => r.json());
  assert.deepEqual(found.results.map((p) => p.name), ['Luke Skywalker', 'Anakin Skywalker', 'Shmi Skywalker']);
});

test('HTTP caching: ETag + If-None-Match gives 304 Not Modified with an empty body', async () => {
  const first = await get('/api/films/1/');
  const etag = first.headers.get('etag');
  assert.ok(etag);
  assert.match(first.headers.get('cache-control'), /max-age=60/);
  const second = await get('/api/films/1/', { 'If-None-Match': etag });
  assert.equal(second.status, 304);
  assert.equal((await second.text()).length, 0);
});

test('responses say where the data came from and what it cost', async () => {
  const res = await get('/api/people/1/');
  assert.equal(res.headers.get('x-data-source'), 'snapshot');
  assert.equal(res.headers.get('x-data-calls'), '1');
  assert.match(res.headers.get('server-timing'), /app;dur=/);
});

test('status codes: 400 bad id / bad paging, 404 missing item / resource', async () => {
  assert.equal((await get('/api/people/abc/')).status, 400);
  assert.equal((await get('/api/people/?limit=500')).status, 400);
  assert.equal((await get('/api/people/999/')).status, 404);
  assert.equal((await get('/api/dragons/')).status, 404);
});

test('OpenAPI spec describes every resource', async () => {
  const spec = await get('/openapi.json').then((r) => r.json());
  assert.equal(spec.openapi, '3.0.3');
  for (const r of ['people', 'planets', 'films', 'species', 'starships', 'vehicles']) {
    assert.ok(spec.paths[`/api/${r}/`], r);
    assert.ok(spec.paths[`/api/${r}/{id}/`], r);
  }
});

test('simulated latency header slows a response down (for demos)', async () => {
  const t = performance.now();
  await get('/api/people/1/', { 'X-Simulated-Latency': '120' });
  assert.ok(performance.now() - t >= 110);
});
