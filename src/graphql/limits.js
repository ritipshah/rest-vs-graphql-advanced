// Query depth and cost limits: GraphQL's main safety feature.
//
// Because the client writes the query, one request can be enormous:
//   allFilms { items { characters { films { characters { films { characters { name } } } } } } }
// Before these limits, a query like that made ~2,350 data lookups in a single request.
// We measure every query BEFORE running it and reject it if it is too deep or too expensive.
//
//   depth = how many levels of fields are nested          person { homeworld { name } }  -> 3
//   cost  = estimated number of fields the server would resolve. A list multiplies the cost
//           of everything inside it by its size: `first` when given, otherwise an estimate of 10.
const { GraphQLError, Kind, getNamedType, getNullableType, isListType } = require('graphql');

const DEFAULT_LIST_SIZE = 10;
const MAX_PAGE_SIZE = 100;

/** Reads `first: 25` / `limit: 25`. A $variable could be anything, so assume the maximum. */
function sizeArgument(field) {
  const arg = (field.arguments || []).find((a) => a.name.value === 'first' || a.name.value === 'limit');
  if (!arg) return null;
  if (arg.value.kind === Kind.INT) return Math.min(Number(arg.value.value), MAX_PAGE_SIZE);
  return MAX_PAGE_SIZE;
}

/** Walk the query tree and return { depth, cost }. */
function measure(schema, operation, fragments) {
  const result = { depth: 0, cost: 0 };

  function walk(selectionSet, parentType, depth, multiplier, pendingSize, seen) {
    for (const sel of selectionSet.selections) {
      if (sel.kind === Kind.FIELD) {
        const name = sel.name.value;
        if (name.startsWith('__')) continue; // __typename / introspection are free
        const def = parentType?.getFields?.()[name];
        if (!def) continue; // unknown fields are reported by GraphQL's own validation
        result.cost += multiplier;
        result.depth = Math.max(result.depth, depth);
        if (!sel.selectionSet) continue;

        const nullable = getNullableType(def.type);
        const listSize = isListType(nullable) ? (pendingSize ?? sizeArgument(sel) ?? DEFAULT_LIST_SIZE) : 1;
        // `allPeople(first: 25)` returns a page; the list inside it (items) has 25 entries.
        const passDown = isListType(nullable) ? null : sizeArgument(sel);
        walk(sel.selectionSet, getNamedType(def.type), depth + 1, multiplier * listSize, passDown, seen);
      } else if (sel.kind === Kind.INLINE_FRAGMENT) {
        const type = sel.typeCondition ? schema.getType(sel.typeCondition.name.value) : parentType;
        walk(sel.selectionSet, type, depth, multiplier, pendingSize, seen);
      } else if (sel.kind === Kind.FRAGMENT_SPREAD) {
        const name = sel.name.value;
        const fragment = fragments[name];
        if (!fragment || seen.has(name)) continue; // cycles are reported by GraphQL's own validation
        walk(fragment.selectionSet, schema.getType(fragment.typeCondition.name.value), depth, multiplier,
          pendingSize, new Set([...seen, name]));
      }
    }
  }

  walk(operation.selectionSet, schema.getQueryType(), 1, 1, null, new Set());
  return result;
}

function fragmentsOf(document) {
  return Object.fromEntries(
    document.definitions.filter((d) => d.kind === Kind.FRAGMENT_DEFINITION).map((d) => [d.name.value, d]),
  );
}

/** Measure the operation that will actually run (used for the response `extensions`). */
function analyze(schema, document, operationName) {
  const ops = document.definitions.filter((d) => d.kind === Kind.OPERATION_DEFINITION);
  const op = operationName ? ops.find((o) => o.name?.value === operationName) : ops[0];
  return op && op.operation === 'query' ? measure(schema, op, fragmentsOf(document)) : { depth: 0, cost: 0 };
}

/** A GraphQL validation rule: it runs on every query before execution. */
function queryLimitsRule({ maxDepth, maxCost }) {
  return function QueryLimits(context) {
    return {
      OperationDefinition(node) {
        if (node.operation !== 'query') return;
        const { depth, cost } = measure(context.getSchema(), node, fragmentsOf(context.getDocument()));
        if (depth > maxDepth) {
          context.reportError(new GraphQLError(
            `Query is ${depth} levels deep; the limit is ${maxDepth}.`,
            { nodes: [node], extensions: { code: 'QUERY_TOO_DEEP', depth, maxDepth } },
          ));
        }
        if (cost > maxCost) {
          context.reportError(new GraphQLError(
            `Query would resolve about ${cost.toLocaleString('en-US')} fields; the limit is ${maxCost.toLocaleString('en-US')}.`,
            { nodes: [node], extensions: { code: 'QUERY_TOO_EXPENSIVE', cost, maxCost } },
          ));
        }
      },
    };
  };
}

module.exports = { queryLimitsRule, analyze, measure };
