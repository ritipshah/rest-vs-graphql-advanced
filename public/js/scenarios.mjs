// The comparison scenarios: one question, answered by several API strategies.
// Shared by the browser UI (race view) and by `npm run compare` (Node), so both always
// measure exactly the same thing.
//
// Each strategy gets a `client` that records every HTTP call it makes:
//   client.get(url, { stage, uses })     stage = which round trip this call belongs to
//   client.graphql(query, variables)      uses  = which fields of the response were needed
// `uses` drives the payload x-ray: true = used, nested object = used fields inside it.

const PEOPLE = [
  ['1', 'Luke Skywalker'], ['4', 'Darth Vader'], ['5', 'Leia Organa'], ['10', 'Obi-Wan Kenobi'],
  ['13', 'Chewbacca'], ['14', 'Han Solo'], ['20', 'Yoda'], ['22', 'Boba Fett'],
];
const FILMS = [
  ['1', 'A New Hope'], ['2', 'The Empire Strikes Back'], ['3', 'Return of the Jedi'],
  ['4', 'The Phantom Menace'], ['5', 'Attack of the Clones'], ['6', 'Revenge of the Sith'],
];
const RESOURCES = ['people', 'planets', 'films', 'species', 'starships', 'vehicles'];
const label = (item) => item.name ?? item.title;
const uniq = (list) => [...new Set(list)];

export const scenarios = [
  {
    id: 'card',
    title: 'Character card',
    param: { name: 'id', label: 'Character', options: PEOPLE, default: '1' },
    question: (p) => `Who is ${PEOPLE.find(([id]) => id === p.id)?.[1] ?? `person ${p.id}`}, where are they from, and which films are they in?`,
    teaches: 'Under-fetching: the person only links to the planet and films, so REST needs a second round of requests.',
    strategies: {
      rest: {
        label: 'REST, follow links',
        how: 'GET the person, then GET every link it contains.',
        async run(c, { id }) {
          const p = await c.get(`/api/people/${id}/`, { stage: 1, uses: { name: true, homeworld: true, films: true } });
          const [world, ...films] = await Promise.all([
            c.get(p.homeworld, { stage: 2, uses: { name: true } }),
            ...p.films.map((f) => c.get(f, { stage: 2, uses: { title: true } })),
          ]);
          return { name: p.name, homeworld: world.name, films: films.map((f) => f.title) };
        },
      },
      restFields: {
        label: 'REST + ?fields',
        how: 'Same requests, but ask for only the fields we need.',
        async run(c, { id }) {
          const p = await c.get(`/api/people/${id}/?fields=name,homeworld,films`, { stage: 1, uses: { name: true, homeworld: true, films: true } });
          const [world, ...films] = await Promise.all([
            c.get(`${p.homeworld}?fields=name`, { stage: 2, uses: { name: true } }),
            ...p.films.map((f) => c.get(`${f}?fields=title`, { stage: 2, uses: { title: true } })),
          ]);
          return { name: p.name, homeworld: world.name, films: films.map((f) => f.title) };
        },
      },
      restExpand: {
        label: 'REST + ?expand',
        how: 'One request that embeds the planet and films, in full.',
        async run(c, { id }) {
          const p = await c.get(`/api/people/${id}/?fields=name,homeworld,films&expand=homeworld,films`, {
            stage: 1, uses: { name: true, homeworld: { name: true }, films: { title: true } },
          });
          return { name: p.name, homeworld: p.homeworld.name, films: p.films.map((f) => f.title) };
        },
      },
      graphql: {
        label: 'GraphQL',
        how: 'One query that names exactly the fields we need.',
        query: `query CharacterCard($id: ID!) {
  person(id: $id) {
    name
    homeworld { name }
    films { title }
  }
}`,
        async run(c, { id }) {
          const { person } = await c.graphql(this.query, { id });
          return { name: person.name, homeworld: person.homeworld.name, films: person.films.map((f) => f.title) };
        },
      },
    },
  },

  {
    id: 'credits',
    title: 'Film credits',
    param: { name: 'id', label: 'Film', options: FILMS, default: '1' },
    question: (p) => `Who appears in ${FILMS.find(([id]) => id === p.id)?.[1] ?? `film ${p.id}`}, and where is each of them from?`,
    teaches: 'Two levels of links: REST needs three dependent rounds; ?expand only saves one of them.',
    strategies: {
      rest: {
        label: 'REST, follow links',
        how: 'GET the film, then every character, then every homeworld.',
        async run(c, { id }) {
          const film = await c.get(`/api/films/${id}/`, { stage: 1, uses: { title: true, characters: true } });
          const people = await Promise.all(film.characters.map((u) => c.get(u, { stage: 2, uses: { name: true, homeworld: true } })));
          const worlds = await Promise.all(uniq(people.map((p) => p.homeworld)).map((u) => c.get(u, { stage: 3, uses: { name: true, url: true } })));
          const worldName = Object.fromEntries(worlds.map((w) => [w.url, w.name]));
          return { title: film.title, cast: people.map((p) => ({ name: p.name, homeworld: worldName[p.homeworld] })) };
        },
      },
      restFields: {
        label: 'REST + ?fields',
        how: 'Same three rounds, smaller responses.',
        async run(c, { id }) {
          const film = await c.get(`/api/films/${id}/?fields=title,characters`, { stage: 1, uses: { title: true, characters: true } });
          const people = await Promise.all(film.characters.map((u) => c.get(`${u}?fields=name,homeworld`, { stage: 2, uses: { name: true, homeworld: true } })));
          const urls = uniq(people.map((p) => p.homeworld));
          const worlds = await Promise.all(urls.map((u) => c.get(`${u}?fields=name`, { stage: 3, uses: { name: true } })));
          const worldName = Object.fromEntries(urls.map((u, i) => [u, worlds[i].name]));
          return { title: film.title, cast: people.map((p) => ({ name: p.name, homeworld: worldName[p.homeworld] })) };
        },
      },
      restExpand: {
        label: 'REST + ?expand',
        how: 'Expand characters (full objects), then still fetch each homeworld.',
        async run(c, { id }) {
          const film = await c.get(`/api/films/${id}/?fields=title,characters&expand=characters`, {
            stage: 1, uses: { title: true, characters: { name: true, homeworld: true } },
          });
          const urls = uniq(film.characters.map((p) => p.homeworld));
          const worlds = await Promise.all(urls.map((u) => c.get(`${u}?fields=name`, { stage: 2, uses: { name: true } })));
          const worldName = Object.fromEntries(urls.map((u, i) => [u, worlds[i].name]));
          return { title: film.title, cast: film.characters.map((p) => ({ name: p.name, homeworld: worldName[p.homeworld] })) };
        },
      },
      graphql: {
        label: 'GraphQL',
        how: 'One query, two levels deep.',
        query: `query FilmCredits($id: ID!) {
  film(id: $id) {
    title
    characters {
      name
      homeworld { name }
    }
  }
}`,
        async run(c, { id }) {
          const { film } = await c.graphql(this.query, { id });
          return { title: film.title, cast: film.characters.map((p) => ({ name: p.name, homeworld: p.homeworld?.name })) };
        },
      },
    },
  },

  {
    id: 'directory',
    title: 'Planet directory',
    param: null,
    question: () => 'What is the name and population of every planet?',
    teaches: 'Over-fetching and paging: default REST pages are 10 items of every field, fetched one after another.',
    strategies: {
      rest: {
        label: 'REST, follow pages',
        how: 'GET page 1, then follow `next` until it is null.',
        async run(c) {
          const planets = [];
          let url = '/api/planets/';
          for (let stage = 1; url; stage++) {
            const page = await c.get(url, { stage, uses: { next: true, results: { name: true, population: true } } });
            planets.push(...page.results);
            url = page.next;
          }
          return planets.map((p) => ({ name: p.name, population: p.population }));
        },
      },
      restFields: {
        label: 'REST + ?fields&limit',
        how: 'One big page with only two fields.',
        async run(c) {
          const page = await c.get('/api/planets/?limit=100&fields=name,population', { stage: 1, uses: { results: { name: true, population: true } } });
          return page.results.map((p) => ({ name: p.name, population: p.population }));
        },
      },
      graphql: {
        label: 'GraphQL',
        how: 'One query with first: 100.',
        query: `query PlanetDirectory {
  allPlanets(first: 100) {
    items { name population }
  }
}`,
        async run(c) {
          const { allPlanets } = await c.graphql(this.query);
          // GraphQL returns typed numbers (null for unknown); REST returns SWAPI's strings.
          return allPlanets.items.map((p) => ({ name: p.name, population: p.population === null ? 'unknown' : String(p.population) }));
        },
      },
    },
  },

  {
    id: 'search',
    title: 'Search everything',
    param: { name: 'text', label: 'Search for', options: [['sky', 'sky'], ['star', 'star'], ['wing', 'wing'], ['fett', 'fett']], default: 'sky' },
    question: (p) => `What in the whole dataset has "${p.text}" in its name?`,
    teaches: 'One endpoint per resource means six requests; a GraphQL union answers in one.',
    strategies: {
      rest: {
        label: 'REST, six searches',
        how: 'GET /api/{resource}/?search= for all six resources.',
        async run(c, { text }) {
          const pages = await Promise.all(RESOURCES.map((r) => c.get(`/api/${r}/?search=${encodeURIComponent(text)}&limit=100`, {
            stage: 1, uses: { results: { name: true, title: true } },
          })));
          return pages.flatMap((p) => p.results.map(label));
        },
      },
      restFields: {
        label: 'REST + ?fields',
        how: 'Six searches, names only.',
        async run(c, { text }) {
          const pages = await Promise.all(RESOURCES.map((r) => c.get(`/api/${r}/?search=${encodeURIComponent(text)}&limit=100&fields=${r === 'films' ? 'title' : 'name'}`, {
            stage: 1, uses: { results: { name: true, title: true } },
          })));
          return pages.flatMap((p) => p.results.map(label));
        },
      },
      graphql: {
        label: 'GraphQL',
        how: 'One `search` field that returns a union of types.',
        query: `query SearchEverything($text: String!) {
  search(text: $text, limit: 50) {
    __typename
    ... on Person { name }
    ... on Planet { name }
    ... on Film { title }
    ... on Species { name }
    ... on Starship { name }
    ... on Vehicle { name }
  }
}`,
        async run(c, { text }) {
          const { search } = await c.graphql(this.query, { text });
          return search.map(label);
        },
      },
    },
  },
];

/**
 * A recording HTTP client. `latency` adds X-Simulated-Latency to every request.
 * Works in the browser and in Node 18+.
 */
export function createClient(base, { latency = 0 } = {}) {
  const calls = [];
  const t0 = performance.now();
  const encoder = new TextEncoder();
  const inBrowser = typeof window !== 'undefined';

  async function request(method, url, { body, stage = 1, uses = null } = {}) {
    const full = new URL(url, base).toString();
    const headers = { Accept: 'application/json' };
    if (latency) headers['X-Simulated-Latency'] = String(latency);
    if (body) headers['Content-Type'] = 'application/json';
    if (method === 'POST') headers['X-Extensions'] = 'off'; // diagnostics only in headers, like REST
    const start = performance.now() - t0;
    const res = await fetch(full, {
      method, headers, body: body ? JSON.stringify(body) : undefined,
      ...(inBrowser ? { cache: 'no-store' } : {}),
    });
    const text = await res.text();
    const call = {
      method, url: full.replace(base, ''), status: res.status, stage, uses,
      start, end: performance.now() - t0,
      bytes: encoder.encode(text).length,
      dataCalls: Number(res.headers.get('x-data-calls') || 0),
      dataSource: res.headers.get('x-data-source'),
      body: body || null,
      json: text ? JSON.parse(text) : null,
    };
    calls.push(call);
    if (!res.ok) throw new Error(`${method} ${call.url} failed with ${res.status}: ${call.json?.error || call.json?.errors?.[0]?.message || ''}`);
    return call.json;
  }

  return {
    calls,
    get: (url, opts) => request('GET', url, opts),
    async graphql(query, variables) {
      const json = await request('POST', '/graphql', { body: { query, variables }, stage: 1, uses: { data: true } });
      if (json.errors?.length) throw new Error(json.errors[0].message);
      return json.data;
    },
  };
}

/** Run one strategy and summarise it. */
export async function runStrategy(base, scenario, key, params, options) {
  const client = createClient(base, options);
  const strategy = scenario.strategies[key];
  const started = performance.now();
  const result = await strategy.run(client, params);
  const wallMs = performance.now() - started;
  const calls = client.calls;
  return {
    key,
    label: strategy.label,
    how: strategy.how,
    result,
    calls,
    requests: calls.length,
    roundTrips: Math.max(...calls.map((c) => c.stage)),
    bytes: calls.reduce((s, c) => s + c.bytes, 0),
    usefulBytes: new TextEncoder().encode(JSON.stringify(result)).length,
    dataCalls: calls.reduce((s, c) => s + c.dataCalls, 0),
    wallMs,
  };
}

export const defaultParams = (scenario) => (scenario.param ? { [scenario.param.name]: scenario.param.default } : {});
export const sameResult = (a, b) => JSON.stringify(a) === JSON.stringify(b);
