// OpenAPI 3 description of the REST API, generated from resources.js.
// REST has no built-in schema, so teams write one of these by hand (or generate it) to get
// what GraphQL gives for free through introspection. Served at GET /openapi.json.
const { DEFINITIONS, snapshot } = require('./resources');

const param = (name, description, schema) => ({ name, in: 'query', required: false, description, schema });
const errorResponse = (description) => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
});

function build() {
  const paths = {};
  const schemas = {
    Error: { type: 'object', properties: { error: { type: 'string' } }, required: ['error'] },
  };

  for (const def of Object.values(DEFINITIONS)) {
    const properties = {};
    const sample = Object.values(snapshot[def.name])[0];
    for (const f of def.fields) {
      const target = def.relations[f];
      const isList = Array.isArray(sample[f]);
      if (target && isList) properties[f] = { type: 'array', items: { type: 'string', format: 'uri' }, description: `Links to ${target}` };
      else if (target) properties[f] = { type: 'string', format: 'uri', nullable: true, description: `Link to ${target}` };
      else if (f === 'episode_id') properties[f] = { type: 'integer' };
      else properties[f] = { type: 'string' };
    }
    schemas[def.type] = { type: 'object', properties };

    const relationList = Object.keys(def.relations).join(', ');
    const shared = [
      param('fields', `Comma-separated fields to return (sparse fieldset). One of: ${def.fields.join(', ')}`, { type: 'string' }),
      param('expand', `Comma-separated relations to embed instead of links. One of: ${relationList}`, { type: 'string' }),
    ];

    paths[`/api/${def.name}/`] = {
      get: {
        tags: [def.name],
        summary: `List ${def.name}`,
        parameters: [
          param('page', 'Page number, starting at 1', { type: 'integer', minimum: 1, default: 1 }),
          param('limit', 'Items per page', { type: 'integer', minimum: 1, maximum: 100, default: 10 }),
          param('search', `Case-insensitive match on ${def.label}`, { type: 'string' }),
          ...shared,
        ],
        responses: {
          200: {
            description: `A page of ${def.name}`,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    count: { type: 'integer' },
                    next: { type: 'string', nullable: true },
                    previous: { type: 'string', nullable: true },
                    results: { type: 'array', items: { $ref: `#/components/schemas/${def.type}` } },
                  },
                },
              },
            },
          },
          400: errorResponse('Invalid page, limit, fields or expand'),
        },
      },
    };

    paths[`/api/${def.name}/{id}/`] = {
      get: {
        tags: [def.name],
        summary: `Get one ${def.type.toLowerCase()} by id`,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }, ...shared],
        responses: {
          200: { description: `One ${def.type}`, content: { 'application/json': { schema: { $ref: `#/components/schemas/${def.type}` } } } },
          304: { description: 'Not Modified (your cached copy is still valid; send If-None-Match with the ETag)' },
          400: errorResponse('id is not a number, or bad fields/expand'),
          404: errorResponse('No item with that id'),
        },
      },
    };
  }

  return {
    openapi: '3.0.3',
    info: {
      title: 'REST vs GraphQL: REST side',
      version: '2.0.0',
      description: 'The same SWAPI data as /graphql, exposed as resource URLs. Responses carry ETag and Cache-Control headers.',
    },
    paths,
    components: { schemas },
  };
}

module.exports = { build };
