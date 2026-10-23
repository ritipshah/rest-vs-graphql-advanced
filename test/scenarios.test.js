// Every scenario the UI races (public/js/scenarios.mjs) must give the SAME answer through
// every strategy. This keeps the comparison honest: we only compare cost, never correctness.
process.env.DATA_SOURCE = 'snapshot';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { createApp } = require('../src/server');
const { startApp } = require('./helpers/fakeSwapi');

let app;
let lib;
before(async () => {
  app = await startApp(createApp, { rateLimitPerMinute: 100000 }); // this test sends hundreds of requests
  lib = await import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'scenarios.mjs')).href);
});
after(() => app.close());

test('every strategy of every scenario returns the same answer as GraphQL', async () => {
  for (const scenario of lib.scenarios) {
    const options = scenario.param ? scenario.param.options.map(([v]) => ({ [scenario.param.name]: v })) : [{}];
    for (const params of options) {
      const reference = await lib.runStrategy(app.base, scenario, 'graphql', params, {});
      assert.equal(reference.requests, 1);
      for (const key of Object.keys(scenario.strategies)) {
        const run = await lib.runStrategy(app.base, scenario, key, params, {});
        assert.ok(lib.sameResult(run.result, reference.result), `${scenario.id} ${JSON.stringify(params)} ${key}`);
      }
    }
  }
});

test('the busiest REST route needs many more requests and round trips than GraphQL', async () => {
  const credits = lib.scenarios.find((s) => s.id === 'credits');
  const rest = await lib.runStrategy(app.base, credits, 'rest', { id: '1' }, {});
  assert.equal(rest.roundTrips, 3);
  assert.ok(rest.requests > 20, `${rest.requests} requests`);
});

test('the UI is served, with JavaScript modules and fonts', async () => {
  const page = await fetch(`${app.base}/`);
  assert.match(await page.text(), /REST vs GraphQL/);
  const js = await fetch(`${app.base}/js/scenarios.mjs`);
  assert.match(js.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(`${app.base}/fonts/archivo-var.woff`)).status, 200);
});
