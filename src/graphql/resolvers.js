// 3. RESOLVERS: one small function per field that needs work. Signature: (parent, args, context)
//    parent  = the raw SWAPI object we are inside (snake_case, relations as URLs)
//    args    = the field's arguments, e.g. { id: "1" }
//    context = per-request helpers (the DataLoader lives here)
// A resolver only runs if the query asks for that field. Fields with no resolver
// (like `name`) are read straight from the parent object.
const { GraphQLError } = require('graphql');
const data = require('../dataService');
const { DEFINITIONS, parseUrl } = require('../resources');

// ---------- small converters: SWAPI sends every value as a string ----------
const clean = (v) => (v === undefined || v === null ? '' : String(v).replace(/,/g, '').trim());
const float = (v) => { const n = Number(clean(v)); return clean(v) !== '' && Number.isFinite(n) ? n : null; };
const int = (v) => { const n = float(v); return Number.isInteger(n) && Math.abs(n) < 2 ** 31 ? n : null; };
function split(v) {
  if (!v || ['unknown', 'n/a'].includes(v)) return [];
  const out = [];
  for (const part of String(v).split(',').map((s) => s.trim()).filter(Boolean)) {
    // keep "Gallofree Yards, Inc." as one manufacturer
    if (/^inc\.?$/i.test(part) && out.length) out[out.length - 1] += `, ${part}`;
    else out.push(part);
  }
  return out;
}
const id = (parent) => parseUrl(parent.url)?.id;

// ---------- input checks: GraphQL reports these in `errors`, next to any data that worked ----------
function badInput(message) {
  return new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });
}
function checkId(value) {
  if (!/^\d+$/.test(String(value))) throw badInput(`id must be a number, got "${value}"`);
  return String(value);
}
const encodeCursor = (offset) => Buffer.from(`offset:${offset}`).toString('base64url');
function decodeCursor(cursor) {
  const m = /^offset:(\d+)$/.exec(Buffer.from(String(cursor), 'base64url').toString());
  if (!m) throw badInput('after is not a valid cursor. Use pageInfo.endCursor from the previous page.');
  return Number(m[1]);
}

async function page(resource, { first, after, search }) {
  if (!Number.isInteger(first) || first < 1 || first > 100) throw badInput('first must be between 1 and 100');
  const offset = after ? decodeCursor(after) : 0;
  const all = data.search(await data.list(resource), search);
  const items = all.slice(offset, offset + first);
  const end = offset + items.length;
  return {
    totalCount: all.length,
    items,
    pageInfo: { hasNextPage: end < all.length, endCursor: items.length ? encodeCursor(end) : null },
  };
}

const one = (resource) => (_parent, args, ctx) => ctx.get(resource, checkId(args.id));
const all = (resource) => (_parent, args) => page(resource, args);
const ref = (field) => (parent, _args, ctx) => ctx.ref(parent[field]);
const refs = (field) => (parent, _args, ctx) => ctx.refs(parent[field]);

module.exports = {
  Query: {
    person: one('people'), allPeople: all('people'),
    planet: one('planets'), allPlanets: all('planets'),
    film: one('films'), allFilms: all('films'),
    species: one('species'), allSpecies: all('species'),
    starship: one('starships'), allStarships: all('starships'),
    vehicle: one('vehicles'), allVehicles: all('vehicles'),
    async search(_parent, { text, limit }) {
      if (!text.trim()) throw badInput('text must not be empty');
      if (limit < 1 || limit > 50) throw badInput('limit must be between 1 and 50');
      const lists = await Promise.all(Object.keys(DEFINITIONS).map((r) => data.list(r)));
      return lists.flatMap((items) => data.search(items, text.trim())).slice(0, limit);
    },
  },

  // A union needs to be told which concrete type each object is.
  SearchResult: {
    __resolveType: (obj) => DEFINITIONS[parseUrl(obj.url).resource].type,
  },

  Person: {
    id, height: (p) => int(p.height), mass: (p) => float(p.mass),
    hairColor: (p) => p.hair_color, skinColor: (p) => p.skin_color, eyeColor: (p) => p.eye_color,
    birthYear: (p) => p.birth_year,
    homeworld: ref('homeworld'),
    films: refs('films'), species: refs('species'), starships: refs('starships'), vehicles: refs('vehicles'),
  },
  Planet: {
    id, diameter: (p) => int(p.diameter), rotationPeriod: (p) => int(p.rotation_period),
    orbitalPeriod: (p) => int(p.orbital_period), population: (p) => float(p.population),
    climates: (p) => split(p.climate), terrains: (p) => split(p.terrain),
    surfaceWater: (p) => float(p.surface_water),
    residents: refs('residents'), films: refs('films'),
  },
  Film: {
    id, episodeId: (f) => f.episode_id, openingCrawl: (f) => f.opening_crawl,
    producers: (f) => split(f.producer), releaseDate: (f) => f.release_date,
    characters: refs('characters'), planets: refs('planets'), starships: refs('starships'),
    vehicles: refs('vehicles'), species: refs('species'),
  },
  Species: {
    id, averageHeight: (s) => float(s.average_height), averageLifespan: (s) => int(s.average_lifespan),
    eyeColors: (s) => split(s.eye_colors), hairColors: (s) => split(s.hair_colors), skinColors: (s) => split(s.skin_colors),
    homeworld: ref('homeworld'), people: refs('people'), films: refs('films'),
  },
  Starship: {
    id, starshipClass: (s) => s.starship_class, manufacturers: (s) => split(s.manufacturer),
    costInCredits: (s) => float(s.cost_in_credits), length: (s) => float(s.length),
    maxAtmospheringSpeed: (s) => int(s.max_atmosphering_speed), hyperdriveRating: (s) => float(s.hyperdrive_rating),
    MGLT: (s) => int(s.MGLT), cargoCapacity: (s) => float(s.cargo_capacity),
    pilots: refs('pilots'), films: refs('films'),
  },
  Vehicle: {
    id, vehicleClass: (v) => v.vehicle_class, manufacturers: (v) => split(v.manufacturer),
    costInCredits: (v) => float(v.cost_in_credits), length: (v) => float(v.length),
    maxAtmospheringSpeed: (v) => int(v.max_atmosphering_speed), cargoCapacity: (v) => float(v.cargo_capacity),
    pilots: refs('pilots'), films: refs('films'),
  },
};
