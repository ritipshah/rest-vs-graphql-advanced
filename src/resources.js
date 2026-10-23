// The six SWAPI resources, described once. REST routes, the OpenAPI spec and field
// validation are all generated from this list, so they can never drift apart.
const snapshot = require('../data/swapi-snapshot.json');

const DEFINITIONS = {
  people:    { type: 'Person',   label: 'name',  relations: { homeworld: 'planets', films: 'films', species: 'species', vehicles: 'vehicles', starships: 'starships' } },
  planets:   { type: 'Planet',   label: 'name',  relations: { residents: 'people', films: 'films' } },
  films:     { type: 'Film',     label: 'title', relations: { characters: 'people', planets: 'planets', starships: 'starships', vehicles: 'vehicles', species: 'species' } },
  species:   { type: 'Species',  label: 'name',  relations: { homeworld: 'planets', people: 'people', films: 'films' } },
  starships: { type: 'Starship', label: 'name',  relations: { pilots: 'people', films: 'films' } },
  vehicles:  { type: 'Vehicle',  label: 'name',  relations: { pilots: 'people', films: 'films' } },
};

// Field names come straight from the data, exactly as swapi.dev returns them.
for (const [name, def] of Object.entries(DEFINITIONS)) {
  const sample = Object.values(snapshot[name])[0];
  def.name = name;
  def.fields = Object.keys(sample);
}

const RESOURCES = Object.keys(DEFINITIONS);
const PATTERN = new RegExp(`/(${RESOURCES.join('|')})/(\\d+)/?$`);

/** 'https://swapi.dev/api/planets/1/' -> { resource: 'planets', id: '1' } */
function parseUrl(url) {
  const m = PATTERN.exec(url || '');
  return m ? { resource: m[1], id: m[2] } : null;
}

module.exports = { DEFINITIONS, RESOURCES, parseUrl, snapshot };
