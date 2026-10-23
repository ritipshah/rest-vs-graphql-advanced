// Builds data/swapi-snapshot.json: the FULL SWAPI dataset in the exact JSON shape swapi.dev returns.
// Source: the original open-source SWAPI repo (BSD licence), which ships its data as Django fixtures.
//
//   git clone --depth 1 https://github.com/phalt/swapi.git /tmp/swapi
//   node scripts/build-snapshot.js /tmp/swapi/resources/fixtures
//
// Why: offline demos and tests get all 82 people / 60 planets / 6 films / 37 species /
// 36 starships / 39 vehicles instead of a hand-made sample, and never touch the public API.
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node scripts/build-snapshot.js <path-to-swapi/resources/fixtures>');
  process.exit(1);
}
const BASE = 'https://swapi.dev/api';
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, `${name}.json`), 'utf8'));
const url = (resource, id) => `${BASE}/${resource}/${id}/`;
const urls = (resource, ids = []) => [...ids].sort((a, b) => a - b).map((id) => url(resource, id));

const films = read('films');
const people = read('people');
const planets = read('planets');
const species = read('species');
const starships = read('starships');
const vehicles = read('vehicles');
const transport = Object.fromEntries(read('transport').map((t) => [t.pk, t.fields]));

// SWAPI's API shows relations in both directions; the fixtures store one side only.
const reverse = {}; // reverse[resource][id][field] = Set(ids)
const link = (resource, id, field, otherId) => {
  reverse[resource] ??= {};
  reverse[resource][id] ??= {};
  (reverse[resource][id][field] ??= new Set()).add(otherId);
};
const rev = (resource, id, field) => [...(reverse[resource]?.[id]?.[field] ?? [])];

for (const f of films) {
  for (const p of f.fields.characters) link('people', p, 'films', f.pk);
  for (const p of f.fields.planets) link('planets', p, 'films', f.pk);
  for (const s of f.fields.species) link('species', s, 'films', f.pk);
  for (const s of f.fields.starships) link('starships', s, 'films', f.pk);
  for (const v of f.fields.vehicles) link('vehicles', v, 'films', f.pk);
}
for (const p of people) if (p.fields.homeworld) link('planets', p.fields.homeworld, 'residents', p.pk);
for (const s of species) for (const p of s.fields.people) link('people', p, 'species', s.pk);
for (const s of starships) for (const p of s.fields.pilots) link('people', p, 'starships', s.pk);
for (const v of vehicles) for (const p of v.fields.pilots) link('people', p, 'vehicles', v.pk);

const meta = (resource, pk, f) => ({ created: f.created, edited: f.edited, url: url(resource, pk) });
const out = { people: {}, planets: {}, films: {}, species: {}, starships: {}, vehicles: {} };

for (const { pk, fields: f } of people) {
  out.people[pk] = {
    name: f.name, height: f.height, mass: f.mass, hair_color: f.hair_color, skin_color: f.skin_color,
    eye_color: f.eye_color, birth_year: f.birth_year, gender: f.gender,
    homeworld: url('planets', f.homeworld),
    films: urls('films', rev('people', pk, 'films')),
    species: urls('species', rev('people', pk, 'species')),
    vehicles: urls('vehicles', rev('people', pk, 'vehicles')),
    starships: urls('starships', rev('people', pk, 'starships')),
    ...meta('people', pk, f),
  };
}
for (const { pk, fields: f } of planets) {
  out.planets[pk] = {
    name: f.name, rotation_period: f.rotation_period, orbital_period: f.orbital_period, diameter: f.diameter,
    climate: f.climate, gravity: f.gravity, terrain: f.terrain, surface_water: f.surface_water,
    population: f.population,
    residents: urls('people', rev('planets', pk, 'residents')),
    films: urls('films', rev('planets', pk, 'films')),
    ...meta('planets', pk, f),
  };
}
for (const { pk, fields: f } of films) {
  out.films[pk] = {
    title: f.title, episode_id: f.episode_id, opening_crawl: f.opening_crawl, director: f.director,
    producer: f.producer, release_date: f.release_date,
    characters: urls('people', f.characters), planets: urls('planets', f.planets),
    starships: urls('starships', f.starships), vehicles: urls('vehicles', f.vehicles),
    species: urls('species', f.species),
    ...meta('films', pk, f),
  };
}
for (const { pk, fields: f } of species) {
  out.species[pk] = {
    name: f.name, classification: f.classification, designation: f.designation,
    average_height: f.average_height, skin_colors: f.skin_colors, hair_colors: f.hair_colors,
    eye_colors: f.eye_colors, average_lifespan: f.average_lifespan,
    homeworld: f.homeworld ? url('planets', f.homeworld) : null, language: f.language,
    people: urls('people', f.people), films: urls('films', rev('species', pk, 'films')),
    ...meta('species', pk, f),
  };
}
const craft = (t) => ({
  name: t.name, model: t.model, manufacturer: t.manufacturer, cost_in_credits: t.cost_in_credits,
  length: t.length, max_atmosphering_speed: t.max_atmosphering_speed, crew: t.crew,
  passengers: t.passengers, cargo_capacity: t.cargo_capacity, consumables: t.consumables,
});
for (const { pk, fields: f } of starships) {
  const t = transport[pk];
  out.starships[pk] = {
    ...craft(t), hyperdrive_rating: f.hyperdrive_rating, MGLT: f.MGLT, starship_class: f.starship_class,
    pilots: urls('people', f.pilots), films: urls('films', rev('starships', pk, 'films')),
    ...meta('starships', pk, t),
  };
}
for (const { pk, fields: f } of vehicles) {
  const t = transport[pk];
  out.vehicles[pk] = {
    ...craft(t), vehicle_class: f.vehicle_class,
    pilots: urls('people', f.pilots), films: urls('films', rev('vehicles', pk, 'films')),
    ...meta('vehicles', pk, t),
  };
}

const target = path.join(__dirname, '..', 'data', 'swapi-snapshot.json');
fs.writeFileSync(target, JSON.stringify(out));
const counts = Object.fromEntries(Object.entries(out).map(([k, v]) => [k, Object.keys(v).length]));
console.log('Wrote', path.relative(process.cwd(), target), counts);
