// GraphQL API tests. Offline snapshot mode: never touches swapi.dev.
process.env.DATA_SOURCE = 'snapshot';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { createApp } = require('../src/server');
const { startApp, gql } = require('./helpers/fakeSwapi');

let app;
before(async () => { app = await startApp(createApp); });
after(() => app.close());
const q = (query, variables, headers) => gql(app.base, query, variables, headers);

test('nested data in one request, with typed numbers', async () => {
  const r = await q('query($id: ID!){ person(id: $id){ name height homeworld { name population } films { title } } }', { id: '1' });
  assert.equal(r.data.person.homeworld.name, 'Tatooine');
  assert.equal(r.data.person.height, 172);          // REST gives the string "172"
  assert.equal(r.data.person.homeworld.population, 200000);
  assert.equal(r.data.person.films.length, 4);
});

test('read-only: mutations are rejected', async () => {
  const r = await q('mutation { deletePerson(id: 1) }');
  assert.ok(r.errors?.length);
});

test('unknown fields are rejected by the schema', async () => {
  const r = await q('{ person(id: "1") { shoeSize } }');
  assert.match(r.errors[0].message, /shoeSize/);
});

test('partial success: good fields return data, bad ones go to `errors` with a path', async () => {
  const r = await q('{ good: person(id: "1") { name } bad: person(id: "abc") { name } }');
  assert.equal(r.data.good.name, 'Luke Skywalker');
  assert.equal(r.data.bad, null);
  assert.deepEqual(r.errors[0].path, ['bad']);
  assert.equal(r.errors[0].extensions.code, 'BAD_USER_INPUT');
});

test('cursor pagination walks through every page', async () => {
  const names = [];
  let after = null;
  for (;;) {
    const r = await q('query($after: String){ allFilms(first: 4, after: $after){ totalCount pageInfo { hasNextPage endCursor } items { title } } }', { after });
    names.push(...r.data.allFilms.items.map((f) => f.title));
    if (!r.data.allFilms.pageInfo.hasNextPage) break;
    after = r.data.allFilms.pageInfo.endCursor;
  }
  assert.equal(names.length, 6);
  const bad = await q('{ allFilms(after: "nonsense") { totalCount } }');
  assert.equal(bad.errors[0].extensions.code, 'BAD_USER_INPUT');
});

test('union search returns different types in one request', async () => {
  const r = await q('{ search(text: "falcon") { __typename ... on Starship { name model } } }');
  assert.deepEqual(r.data.search, [{ __typename: 'Starship', name: 'Millennium Falcon', model: 'YT-1300 light freighter' }]);
});

test('depth limit: a query nested too deeply is refused before it runs', async () => {
  const r = await q('{ allFilms { items { characters { films { characters { films { characters { name } } } } } } } }');
  assert.equal(r.data, undefined);
  assert.ok(r.errors.some((e) => e.extensions.code === 'QUERY_TOO_DEEP'));
});

test('cost limit: a shallow but huge query is refused before it runs', async () => {
  const r = await q('{ allPeople(first: 100) { items { films { characters { films { title } } } } } }');
  assert.ok(r.errors.some((e) => e.extensions.code === 'QUERY_TOO_EXPENSIVE'));
});

test('fragments are counted too, so they cannot sneak past the limits', async () => {
  const r = await q(`{ allFilms { items { ...F } } }
    fragment F on Film { characters { films { characters { films { title } } } } }`);
  assert.ok(r.errors.some((e) => e.extensions.code === 'QUERY_TOO_DEEP'));
});

test('DataLoader turns N+1 data calls into a few batched ones', async () => {
  const query = '{ allFilms { items { characters { name homeworld { name } } } } }';
  const withLoader = await q(query);
  const without = await q(query, undefined, { 'X-DataLoader': 'off' });
  assert.deepEqual(withLoader.data, without.data);           // same answer...
  const on = withLoader.extensions.data.dataCalls;
  const off = without.extensions.data.dataCalls;
  assert.ok(on <= 3, `with loader: ${on}`);                  // ...from 3 calls
  assert.ok(off > 100, `without loader: ${off}`);            // instead of 300+
});

test('every response reports its depth, cost and data source', async () => {
  const r = await q('{ person(id: "1") { name } }');
  assert.deepEqual(r.extensions.cost, { depth: 2, cost: 2, maxDepth: 6, maxCost: 5000 });
  assert.equal(r.extensions.data.dataSource, 'snapshot');
});

test('GET works for queries (so they can be cached by URL)', async () => {
  const res = await fetch(`${app.base}/graphql?query=${encodeURIComponent('{ film(id: "1") { title } }')}`);
  assert.equal((await res.json()).data.film.title, 'A New Hope');
});
