// Query lab: the schema as a tree of checkboxes that writes the query, an editor, and
// meters for the safety limits (depth, cost) and the N+1 problem (data calls).
import { $, el, fmtBytes, fmtMs, bytesOf, renderJson, highlightGraphQL, reportSource } from './ui.mjs';

const INTROSPECTION = `query Schema {
  __schema {
    types {
      kind name description
      fields { name description args { name defaultValue type { ...T } } type { ...T } }
      possibleTypes { name }
    }
  }
}
fragment T on __Type { kind name ofType { kind name ofType { kind name ofType { kind name } } } }`;

const PRESETS = [
  { label: 'Character card', query: `query CharacterCard {
  person(id: "1") {
    name
    height
    homeworld { name population climates }
    films { title releaseDate }
  }
}` },
  { label: 'Film credits', query: `query FilmCredits {
  film(id: "1") {
    title
    director
    characters {
      name
      homeworld { name }
    }
  }
}` },
  { label: 'Cursor pagination', query: `# Run it, then paste pageInfo.endCursor into "after" to get page 2.
query PlanetPage {
  allPlanets(first: 5, after: null) {
    totalCount
    pageInfo { hasNextPage endCursor }
    items { name population terrains }
  }
}` },
  { label: 'Search across types', query: `# One field, six possible types: a union.
query Search {
  search(text: "sky") {
    __typename
    ... on Person { name birthYear }
    ... on Vehicle { name model }
    ... on Starship { name model }
  }
}` },
  { label: 'Partial error', query: `# GraphQL can succeed and fail in the same response.
query PartialError {
  good: person(id: "1") { name }
  bad: person(id: "abc") { name }
  missing: person(id: "999") { name }
}` },
  { label: 'N+1 test', query: `# Switch "Batch with DataLoader" off and run again.
query NPlusOne {
  allFilms {
    items {
      title
      characters {
        name
        homeworld { name }
      }
    }
  }
}` },
  { label: 'Too deep', danger: true, query: `# Blocked before it runs: 8 levels deep, limit is 6.
query TooDeep {
  allFilms {
    items {
      characters {
        films {
          characters {
            films {
              characters { name }
            }
          }
        }
      }
    }
  }
}` },
  { label: 'Too expensive', danger: true, query: `# Only 6 levels, but about 111,000 fields. Blocked.
query TooExpensive {
  allPeople(first: 100) {
    items {
      films {
        characters {
          films { title }
        }
      }
    }
  }
}` },
];

const ARG_DEFAULTS = { id: '1', text: 'sky', first: '5' };

let types = {};
const selected = new Set(); // paths like "person/homeworld/name" or "search/...Person/name"
const args = {};            // root field -> { arg: value }
let lastRun = null;

export async function init() {
  renderPresets();
  setupEditor();
  $('#lab-run').addEventListener('click', run);
  $('#loader-switch').addEventListener('change', () => { if (lastRun) run(); });
  renderMeters(null);
  try {
    const res = await fetch('/graphql', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: INTROSPECTION }),
    });
    const json = await res.json();
    types = Object.fromEntries(json.data.__schema.types.map((t) => [t.name, t]));
    renderTree();
    $('#schema-hint').textContent = `${Object.values(types).filter((t) => !t.name.startsWith('__') && t.kind === 'OBJECT').length} types, via introspection`;
  } catch (err) {
    $('#tree').textContent = `Could not read the schema: ${err.message}`;
  }
  loadPreset(PRESETS[0], false);
}

// ---------- presets ----------
function renderPresets() {
  const box = $('#presets');
  for (const p of PRESETS) {
    box.append(el('button', {
      class: `pill${p.danger ? ' is-danger' : ''}`, type: 'button', 'aria-pressed': 'false',
      onclick: () => loadPreset(p, true),
    }, p.label));
  }
}
function loadPreset(preset, andRun) {
  for (const b of document.querySelectorAll('#presets .pill')) b.setAttribute('aria-pressed', String(b.textContent === preset.label));
  selected.clear();
  document.querySelectorAll('#tree input[type="checkbox"]').forEach((c) => { c.checked = false; });
  setEditor(preset.query);
  $('#query-hint').textContent = 'example query';
  if (andRun) run();
}

// ---------- editor with syntax highlighting ----------
function setupEditor() {
  const ta = $('#editor');
  ta.addEventListener('input', () => {
    paint();
    $('#query-hint').textContent = 'edited by hand';
    for (const b of document.querySelectorAll('#presets .pill')) b.setAttribute('aria-pressed', 'false');
  });
  ta.addEventListener('scroll', () => {
    const pre = $('#editor-highlight');
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && !e.shiftKey) {
      e.preventDefault();
      ta.setRangeText('  ', ta.selectionStart, ta.selectionEnd, 'end');
      paint();
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); run(); }
  });
}
function setEditor(text) {
  $('#editor').value = text;
  paint();
}
function paint() {
  // trailing newline keeps the overlay the same height as the textarea
  $('#editor-highlight').innerHTML = `${highlightGraphQL($('#editor').value)}\n`;
}

// ---------- schema tree ----------
const unwrap = (t) => { let x = t; while (x.ofType) x = x.ofType; return x; };
function typeLabel(t) {
  if (t.kind === 'NON_NULL') return `${typeLabel(t.ofType)}!`;
  if (t.kind === 'LIST') return `[${typeLabel(t.ofType)}]`;
  return t.name;
}
const isComposite = (t) => ['OBJECT', 'UNION'].includes(unwrap(t).kind);
const leafNames = (typeName) => (types[typeName]?.fields || []).filter((f) => !isComposite(f.type)).map((f) => f.name);

function renderTree() {
  const root = el('ul');
  for (const field of types.Query.fields) root.append(fieldNode(field, field.name, true));
  $('#tree').replaceChildren(root);
}

function fieldNode(field, path, isRoot) {
  const named = unwrap(field.type);
  const composite = isComposite(field.type);
  const id = `f-${path.replace(/[^\w]/g, '_')}`;
  const box = el('input', { type: 'checkbox', id, checked: selected.has(path) });
  const children = el('ul', { hidden: true });
  const argRow = isRoot && field.args.length
    ? el('div', { class: 'args' }, ...field.args.map((a) => argInput(field.name, a)))
    : null;
  const li = el('li', {}, el('div', { class: `node${isRoot ? ' is-root' : ''}` },
    box,
    el('label', { class: 'fname', for: id, title: field.description || '' }, field.name),
    el('span', { class: 'ftype' }, typeLabel(field.type)),
    argRow),
  children);

  const expand = () => {
    if (!children.childElementCount && composite) {
      if (named.kind === 'UNION') {
        for (const member of types[named.name].possibleTypes) {
          children.append(fieldNode({ name: `... on ${member.name}`, type: { kind: 'OBJECT', name: member.name }, args: [] }, `${path}/...${member.name}`, false));
        }
      } else {
        for (const f of types[named.name].fields) children.append(fieldNode(f, `${path}/${f.name}`, false));
      }
    }
    children.hidden = false;
  };

  box.addEventListener('change', () => {
    if (box.checked) {
      selectPath(path);
      if (composite) {
        expand();
        const kids = [...selected].filter((p) => p.startsWith(`${path}/`));
        if (!kids.length) {
          // pick a sensible first field so the query is valid straight away
          const typeName = named.kind === 'UNION' ? null : named.name;
          const labelOf = (t) => ['name', 'title'].find((n) => leafNames(t).includes(n)) || leafNames(t)[0];
          const itemsField = typeName && types[typeName].fields.find((f) => f.name === 'items');
          if (itemsField) {
            // a page type: start with items { name } rather than totalCount
            const itemType = unwrap(itemsField.type).name;
            selectPath(`${path}/items/${labelOf(itemType)}`);
            selectPath(`${path}/totalCount`);
          } else if (typeName) selectPath(`${path}/${labelOf(typeName) || types[typeName].fields[0].name}`);
          else { // union: start with the first member's name (__typename is always added)
            const first = types[named.name].possibleTypes[0].name;
            selectPath(`${path}/...${first}/name`);
          }
        }
      }
    } else {
      for (const p of [...selected]) if (p === path || p.startsWith(`${path}/`)) selected.delete(p);
    }
    syncChecks();
    writeQuery();
  });
  return li;
}

function argInput(rootName, arg) {
  args[rootName] ??= {};
  const initial = ARG_DEFAULTS[arg.name] ?? '';
  if (initial !== '' && ['id', 'text'].includes(arg.name)) args[rootName][arg.name] = initial;
  const input = el('input', { value: args[rootName][arg.name] ?? '', placeholder: arg.defaultValue ?? '', 'aria-label': `${rootName} ${arg.name}` });
  input.addEventListener('input', () => { args[rootName][arg.name] = input.value; if (selected.has(rootName)) writeQuery(); });
  return el('span', { class: 'arg' }, `${arg.name}:`, input);
}

function selectPath(path) {
  const parts = path.split('/');
  for (let i = 1; i <= parts.length; i++) selected.add(parts.slice(0, i).join('/'));
}
function syncChecks() {
  document.querySelectorAll('#tree input[type="checkbox"]').forEach((c) => {
    const path = c.closest('li') && pathOf(c);
    if (path) c.checked = selected.has(path);
  });
}
function pathOf(checkbox) {
  // rebuild the path from the labels up the tree
  const names = [];
  let li = checkbox.closest('li');
  while (li) {
    const label = li.querySelector(':scope > .node > .fname').textContent;
    names.unshift(label.startsWith('... on ') ? `...${label.slice(7)}` : label);
    li = li.parentElement.closest('li');
  }
  return names.join('/');
}

// ---------- query generation ----------
function argString(rootName) {
  const field = types.Query.fields.find((f) => f.name === rootName);
  const parts = [];
  for (const a of field.args) {
    const v = args[rootName]?.[a.name];
    if (v === undefined || v === '') continue;
    const base = unwrap(a.type).name;
    parts.push(`${a.name}: ${base === 'Int' ? Number(v) : JSON.stringify(String(v))}`);
  }
  return parts.length ? `(${parts.join(', ')})` : '';
}

function selectionFor(typeName, prefix, indent) {
  const type = types[typeName];
  const pad = '  '.repeat(indent);
  const lines = [];
  if (type.kind === 'UNION') {
    lines.push(`${pad}__typename`);
    for (const m of type.possibleTypes) {
      const path = `${prefix}/...${m.name}`;
      if (!selected.has(path)) continue;
      lines.push(`${pad}... on ${m.name} {`, ...selectionFor(m.name, path, indent + 1), `${pad}}`);
    }
    return lines;
  }
  for (const f of type.fields) {
    const path = prefix ? `${prefix}/${f.name}` : f.name;
    if (!selected.has(path)) continue;
    const a = prefix ? '' : argString(f.name);
    if (isComposite(f.type)) {
      const inner = selectionFor(unwrap(f.type).name, path, indent + 1);
      if (inner.length) lines.push(`${pad}${f.name}${a} {`, ...inner, `${pad}}`);
    } else {
      lines.push(`${pad}${f.name}${a}`);
    }
  }
  return lines;
}

function writeQuery() {
  for (const b of document.querySelectorAll('#presets .pill')) b.setAttribute('aria-pressed', 'false');
  const body = selectionFor('Query', '', 1);
  setEditor(body.length ? `query FromTree {\n${body.join('\n')}\n}` : '# Tick fields in the schema tree to build a query.');
  $('#query-hint').textContent = 'built from the tree';
}

// ---------- run + meters ----------
async function run() {
  const query = $('#editor').value;
  let variables = {};
  try { variables = JSON.parse($('#variables').value || '{}'); } catch {
    showErrors([{ message: 'Variables are not valid JSON.' }]);
    return;
  }
  const useLoader = $('#loader-switch').checked;
  const button = $('#lab-run');
  button.disabled = true;
  const started = performance.now();
  try {
    const res = await fetch('/graphql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-DataLoader': useLoader ? 'on' : 'off' },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    const ms = performance.now() - started;
    const json = JSON.parse(text);
    reportSource(res.headers.get('x-data-source'));
    lastRun = { json, ms, bytes: bytesOf(text), status: res.status, useLoader, dataCalls: Number(res.headers.get('x-data-calls') || 0) };
    showResult(lastRun);
  } catch (err) {
    showErrors([{ message: `Request failed: ${err.message}` }]);
  } finally {
    button.disabled = false;
  }
}

function showResult(r) {
  const errors = r.json.errors || [];
  const blocked = !('data' in r.json);
  showErrors(errors);
  const ext = r.json.extensions || {};
  const limitErr = (code) => errors.find((e) => e.extensions?.code === code)?.extensions;
  const meta = window.APP_META?.limits || { maxDepth: 6, maxCost: 5000 };
  const cost = ext.cost || {
    depth: limitErr('QUERY_TOO_DEEP')?.depth, cost: limitErr('QUERY_TOO_EXPENSIVE')?.cost,
    maxDepth: meta.maxDepth, maxCost: meta.maxCost,
  };
  renderMeters({ ...r, cost, blocked });
  $('#resp-hint').textContent = blocked
    ? `HTTP ${r.status}: refused before running`
    : `HTTP ${r.status}, ${fmtBytes(r.bytes)}, ${fmtMs(r.ms)}${errors.length ? ', partial errors' : ''}`;
  renderJson($('#lab-json'), r.json, { maxItems: 60 });
}

function showErrors(errors) {
  const box = $('#lab-errors');
  box.hidden = !errors.length;
  box.replaceChildren(...errors.map((e) => el('div', { class: 'error-item' },
    e.extensions?.code ? el('code', {}, e.extensions.code) : null,
    e.message,
    e.path ? el('span', { class: 'ftype' }, `  at ${e.path.join('.')}`) : null)));
}

function renderMeters(r) {
  const box = $('#meters');
  const maxDepth = r?.cost?.maxDepth ?? 6;
  const maxCost = r?.cost?.maxCost ?? 5000;
  const depth = r?.cost?.depth;
  const cost = r?.cost?.cost;

  const dots = el('div', { class: 'dots', 'aria-hidden': 'true' });
  const shown = Math.max(maxDepth, depth || 0);
  for (let i = 1; i <= shown; i++) dots.append(el('i', { class: i <= (depth || 0) ? (i > maxDepth ? 'over' : 'on') : '' }));

  const fill = cost ? Math.min(100, (Math.log10(cost + 1) / Math.log10(maxCost + 1)) * 100) : 0;
  const costOver = cost > maxCost;

  box.replaceChildren(
    el('div', { class: 'meter' },
      el('span', { class: 'meter-label' }, 'Depth'),
      el('span', { class: `meter-value${depth > maxDepth ? ' is-over' : ''}` }, depth ?? '–', el('small', {}, ` of ${maxDepth}`)),
      dots),
    el('div', { class: 'meter' },
      el('span', { class: 'meter-label' }, 'Cost (fields)'),
      el('span', { class: `meter-value${costOver ? ' is-over' : ''}` }, cost === undefined ? '–' : cost.toLocaleString('en-US'), el('small', {}, ` of ${maxCost.toLocaleString('en-US')}`)),
      el('div', { class: `costbar${costOver ? ' is-over' : ''}`, 'aria-hidden': 'true' }, el('span', { style: { width: `${fill}%` } }))),
    el('div', { class: 'meter' },
      el('span', { class: 'meter-label' }, r ? (r.useLoader ? 'Data calls, batched' : 'Data calls, not batched') : 'Data calls'),
      el('span', { class: 'meter-value' }, r && !r.blocked ? r.dataCalls : '–')),
    el('div', { class: 'meter' },
      el('span', { class: 'meter-label' }, 'Size and time'),
      el('span', { class: 'meter-value' }, r ? fmtBytes(r.bytes) : '–', el('small', {}, r ? `  ${fmtMs(r.ms)}` : ''))),
  );
}
