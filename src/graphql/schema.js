// 1. SCHEMA: the typed contract. It says which types and fields exist and how they connect.
// Clients can only ask for what is written here, and they can read it (introspection).
// Naming follows the official SWAPI GraphQL demo: person(id) + allPeople(...), etc.
module.exports = /* GraphQL */ `
  "A character from the films."
  type Person {
    id: ID!
    name: String!
    "Height in centimetres. null when SWAPI says 'unknown'."
    height: Int
    "Mass in kilograms. null when SWAPI says 'unknown'."
    mass: Float
    hairColor: String
    skinColor: String
    eyeColor: String
    birthYear: String
    gender: String
    homeworld: Planet
    films: [Film!]!
    species: [Species!]!
    starships: [Starship!]!
    vehicles: [Vehicle!]!
  }

  type Planet {
    id: ID!
    name: String!
    diameter: Int
    rotationPeriod: Int
    orbitalPeriod: Int
    gravity: String
    population: Float
    climates: [String!]!
    terrains: [String!]!
    "Percentage of the surface covered by water."
    surfaceWater: Float
    residents: [Person!]!
    films: [Film!]!
  }

  type Film {
    id: ID!
    title: String!
    episodeId: Int
    openingCrawl: String
    director: String
    producers: [String!]!
    releaseDate: String
    characters: [Person!]!
    planets: [Planet!]!
    starships: [Starship!]!
    vehicles: [Vehicle!]!
    species: [Species!]!
  }

  type Species {
    id: ID!
    name: String!
    classification: String
    designation: String
    averageHeight: Float
    averageLifespan: Int
    eyeColors: [String!]!
    hairColors: [String!]!
    skinColors: [String!]!
    language: String
    homeworld: Planet
    people: [Person!]!
    films: [Film!]!
  }

  type Starship {
    id: ID!
    name: String!
    model: String
    starshipClass: String
    manufacturers: [String!]!
    costInCredits: Float
    length: Float
    crew: String
    passengers: String
    maxAtmospheringSpeed: Int
    hyperdriveRating: Float
    MGLT: Int
    cargoCapacity: Float
    consumables: String
    pilots: [Person!]!
    films: [Film!]!
  }

  type Vehicle {
    id: ID!
    name: String!
    model: String
    vehicleClass: String
    manufacturers: [String!]!
    costInCredits: Float
    length: Float
    crew: String
    passengers: String
    maxAtmospheringSpeed: Int
    cargoCapacity: Float
    consumables: String
    pilots: [Person!]!
    films: [Film!]!
  }

  "Cursor pagination: pass pageInfo.endCursor as \`after\` to get the next page."
  type PageInfo {
    hasNextPage: Boolean!
    endCursor: String
  }
  type PersonPage   { totalCount: Int!  pageInfo: PageInfo!  items: [Person!]! }
  type PlanetPage   { totalCount: Int!  pageInfo: PageInfo!  items: [Planet!]! }
  type FilmPage     { totalCount: Int!  pageInfo: PageInfo!  items: [Film!]! }
  type SpeciesPage  { totalCount: Int!  pageInfo: PageInfo!  items: [Species!]! }
  type StarshipPage { totalCount: Int!  pageInfo: PageInfo!  items: [Starship!]! }
  type VehiclePage  { totalCount: Int!  pageInfo: PageInfo!  items: [Vehicle!]! }

  "A search hit can be any type. Use inline fragments: ... on Person { name }"
  union SearchResult = Person | Planet | Film | Species | Starship | Vehicle

  # Only Query exists. There is no Mutation type, so the API is read-only by design.
  type Query {
    person(id: ID!): Person
    allPeople(first: Int = 10, after: String, search: String): PersonPage!
    planet(id: ID!): Planet
    allPlanets(first: Int = 10, after: String, search: String): PlanetPage!
    film(id: ID!): Film
    allFilms(first: Int = 10, after: String, search: String): FilmPage!
    species(id: ID!): Species
    allSpecies(first: Int = 10, after: String, search: String): SpeciesPage!
    starship(id: ID!): Starship
    allStarships(first: Int = 10, after: String, search: String): StarshipPage!
    vehicle(id: ID!): Vehicle
    allVehicles(first: Int = 10, after: String, search: String): VehiclePage!

    "Search names and titles across all six resources in one request."
    search(text: String!, limit: Int = 10): [SearchResult!]!
  }
`;
