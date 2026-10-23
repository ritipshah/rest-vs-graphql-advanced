// Read-only GraphQL API in three pieces:
//   1. SCHEMA    (schema.js)    - the typed contract: what can be asked
//   2. QUERY     (from client)  - what the client wants, field by field
//   3. RESOLVERS (resolvers.js) - server functions that fetch each field
// Plus the protection a public GraphQL API needs: depth/cost limits (limits.js)
// and batching so nested lists do not cause N+1 data calls (loader.js).
const { buildSchema } = require('graphql');
const { createHandler } = require('graphql-http/lib/use/express');
const config = require('../config');
const data = require('../dataService');
const { RESOURCES, parseUrl } = require('../resources');
const requestContext = require('../requestContext');
const typeDefs = require('./schema');
const resolvers = require('./resolvers');
const { Loader } = require('./loader');
const { queryLimitsRule, analyze } = require('./limits');

const schema = buildSchema(typeDefs);

// Plug every resolver into the schema: resolvers.Person.homeworld -> Person.homeworld.resolve
for (const [typeName, fields] of Object.entries(resolvers)) {
  const type = schema.getType(typeName);
  for (const [field, fn] of Object.entries(fields)) {
    if (field === '__resolveType') type.resolveType = fn;
    else type.getFields()[field].resolve = fn;
  }
}

/**
 * Built fresh for every request. The demo can switch the DataLoader off with the header
 * `X-DataLoader: off` to show the N+1 problem it solves.
 */
function createContext(useLoader) {
  const loaders = Object.fromEntries(RESOURCES.map((r) => [r, new Loader((ids) => data.many(r, ids))]));
  const get = (resource, id) => (useLoader ? loaders[resource].load(id) : data.one(resource, id));
  const ref = (url) => {
    const p = parseUrl(url);
    return p ? get(p.resource, p.id) : null;
  };
  const refs = async (urls = []) => (await Promise.all(urls.map(ref))).filter(Boolean);
  return { useLoader, get, ref, refs, loaders };
}

const handler = createHandler({
  schema,
  context: (req) => createContext(String(req.headers['x-dataloader'] || '').toLowerCase() !== 'off'),
  validationRules: (_req, _args, specifiedRules) => [
    ...specifiedRules,
    queryLimitsRule({ maxDepth: config.maxDepth, maxCost: config.maxCost }),
  ],
  // After running: report what the query cost, in the standard `extensions` field.
  // `X-Extensions: off` leaves them out (the race view does this, so byte counts compare
  // fairly with REST, whose diagnostics travel only in headers).
  onOperation: (req, args, result) => {
    const usage = requestContext.summary();
    const { depth, cost } = analyze(args.schema, args.document, args.operationName);
    requestContext.setHeaders(req.context.res);
    if (String(req.headers['x-extensions'] || '').toLowerCase() === 'off') return result;
    return {
      ...result,
      extensions: {
        ...result.extensions,
        cost: { depth, cost, maxDepth: config.maxDepth, maxCost: config.maxCost },
        data: { ...usage, dataloader: args.contextValue.useLoader },
      },
    };
  },
});

module.exports = { handler, schema, typeDefs };
