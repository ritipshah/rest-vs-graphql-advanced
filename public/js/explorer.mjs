// REST explorer: endpoints from the OpenAPI spec, a request builder, clickable links in
// every response (under-fetching, felt by hand), and a conditional request to show 304.
import { $, el, fmtBytes, fmtMs, bytesOf, renderJson, reportSource } from './ui.mjs';

let spec = null;
const state = { template: '/api/people/{id}/', id: '1', query: {}, url: '', lastEtag: null, lastUrl: null };
const trail = [];

export async function init() {
  spec = await fetch('/openapi.json').then((r) => r.json());
  renderCatalogue();
  choose('/api/people/{id}/', { id: '1' });
  renderTrail();
}

// ---------- catalogue ----------
function renderCatalogue() {
  const box = $('#catalogue');
  const groups = {};
  for (const [path, item] of Object.entries(spec.paths)) (groups[item.get.tags[0]] ??= []).push([path, item.get]);
  for (const [tag, endpoints] of Object.entries(groups)) {
    box.append(el('h4', {}, tag));
    for (const [path, op] of endpoints) {
      box.append(el('button', {
        class: 'endpoint', type: 'button', 'data-path': path, 'aria-pressed': 'false', title: op.summary,
        onclick: () => choose(path, path.includes('{id}') ? { id: '1' } : {}),
      }, el('span', { class: 'verb' }, 'GET'), path.replace('/api', '')));
    }
  }
}

function schemaFor(template) {
  const resource = template.split('/')[2];
  const op = spec.paths[`/api/${resource}/`].get;
  const ref = op.responses[200].content['application/json'].schema.properties.results.items.$ref;
  return spec.components.schemas[ref.split('/').pop()];
}

function choose(template, { id } = {}) {
  state.template = template;
  state.id = id ?? state.id;
  state.query = template.includes('{id}') ? {} : { limit: '10' };
  for (const b of document.querySelectorAll('.endpoint')) b.setAttribute('aria-pressed', String(b.dataset.path === template));
  renderRequest();
}

// ---------- request builder ----------
function buildUrl() {
  const path = state.template.replace('{id}', encodeURIComponent(state.id || ''));
  const q = new URLSearchParams(Object.entries(state.query).filter(([, v]) => v !== '' && v !== undefined));
  return `${path}${q.toString() ? `?${q.toString().replace(/%2C/g, ',')}` : ''}`;
}

function renderRequest() {
  const box = $('#request');
  const schema = schemaFor(state.template);
  const fields = Object.keys(schema.properties);
  const relations = fields.filter((f) => schema.properties[f].format === 'uri' || schema.properties[f].items?.format === 'uri');
  relations.splice(relations.indexOf('url'), relations.includes('url') ? 1 : 0);
  const isItem = state.template.includes('{id}');

  const urlInput = el('input', { class: 'input', id: 'rest-url', value: buildUrl(), 'aria-label': 'Request URL', spellcheck: 'false' });
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(urlInput.value); });

  const update = () => { urlInput.value = buildUrl(); };
  const numberParam = (name, label, attrs = {}) => {
    const input = el('input', { class: 'input', type: 'number', id: `p-${name}`, value: state.query[name] ?? '', ...attrs });
    input.addEventListener('input', () => { state.query[name] = input.value; update(); });
    return el('div', {}, el('label', { class: 'field-label', for: `p-${name}` }, label), input);
  };
  const textParam = (name, label, getter, setter) => {
    const input = el('input', { class: 'input', id: `p-${name}`, value: getter() });
    input.addEventListener('input', () => { setter(input.value); update(); });
    return el('div', {}, el('label', { class: 'field-label', for: `p-${name}` }, label), input);
  };
  const picker = (name, label, options) => {
    const chosen = new Set(String(state.query[name] || '').split(',').filter(Boolean));
    const group = el('div', { class: 'picker', role: 'group', 'aria-label': label });
    for (const opt of options) {
      group.append(el('button', {
        type: 'button', 'aria-pressed': String(chosen.has(opt)),
        onclick: (e) => {
          if (chosen.has(opt)) chosen.delete(opt); else chosen.add(opt);
          e.currentTarget.setAttribute('aria-pressed', String(chosen.has(opt)));
          state.query[name] = [...chosen].join(',');
          update();
        },
      }, opt));
    }
    return el('div', { class: 'picker-group' }, el('span', { class: 'field-label' }, label), group);
  };

  box.replaceChildren(
    el('div', { class: 'urlbar' }, el('span', { class: 'verb' }, 'GET'), urlInput),
    el('div', { class: 'params' },
      isItem ? textParam('id', 'id', () => state.id, (v) => { state.id = v; }) : null,
      !isItem ? numberParam('page', 'page', { min: 1, placeholder: '1' }) : null,
      !isItem ? numberParam('limit', 'limit', { min: 1, max: 100, placeholder: '10' }) : null,
      !isItem ? textParam('search', 'search', () => state.query.search || '', (v) => { state.query.search = v; }) : null,
      picker('fields', 'fields: return only these (fixes over-fetching)', fields),
      relations.length ? picker('expand', 'expand: embed these instead of links (fixes one level of under-fetching)', relations) : null),
    el('div', { class: 'send-row' },
      el('button', { class: 'button', type: 'button', onclick: () => send(urlInput.value) }, 'Send request'),
      el('button', {
        class: 'button is-quiet', type: 'button', id: 'send-etag', disabled: !state.lastEtag,
        title: 'Send If-None-Match with the ETag from the last response',
        onclick: () => send(state.lastUrl, { conditional: true }),
      }, 'Send again with If-None-Match')),
  );
}

// ---------- sending ----------
async function send(url, { conditional = false } = {}) {
  const path = url.replace(location.origin, '');
  const headers = { Accept: 'application/json' };
  if (conditional && state.lastEtag) headers['If-None-Match'] = state.lastEtag;
  const started = performance.now();
  let res;
  try {
    res = await fetch(path, { headers, cache: 'no-store' });
  } catch (err) {
    $('#rest-callout').replaceChildren(el('div', { class: 'callout is-error' }, `Request failed: ${err.message}`));
    return;
  }
  const text = await res.text();
  const ms = performance.now() - started;
  const bytes = bytesOf(text);
  reportSource(res.headers.get('x-data-source'));
  trail.push({ path, status: res.status, bytes });
  renderTrail();

  if (res.headers.get('etag') && res.status === 200) { state.lastEtag = res.headers.get('etag'); state.lastUrl = path; }
  const etagButton = $('#send-etag');
  if (etagButton) etagButton.disabled = !state.lastEtag;
  $('#rest-url').value = path;

  $('#rest-response-head').replaceChildren(
    el('span', { class: `status s${String(res.status)[0]}` }, `${res.status} ${res.statusText || ''}`.trim()),
    el('span', { class: 'mono' }, `GET ${path}`),
    el('span', {}, `${fmtBytes(bytes)} body`),
    el('span', {}, fmtMs(ms)),
  );

  const callout = $('#rest-callout');
  callout.replaceChildren();
  if (res.status === 304) {
    callout.append(el('div', { class: 'callout is-cache' },
      el('strong', {}, '304 Not Modified, 0 bytes of body. '),
      'The client already has this exact response (same ETag), so the server only confirms it. Browsers and CDNs do this automatically because every REST URL is its own cache key. A GraphQL POST to the single /graphql URL cannot be cached this way.'));
  } else if (res.status >= 400) {
    const err = text ? JSON.parse(text) : {};
    callout.append(el('div', { class: 'callout is-error' },
      el('strong', {}, `${res.status}: ${err.error || 'error'}. `),
      'REST reports problems with the HTTP status code. Compare the Query lab, where GraphQL returns 200 with an errors array next to partial data.'));
  } else if (trail.length >= 3) {
    const total = trail.reduce((s, t) => s + t.bytes, 0);
    callout.append(el('div', { class: 'callout' },
      el('strong', {}, `${trail.length} requests and ${fmtBytes(total)} so far. `),
      'Each link was another round trip to the server. In GraphQL, one query could have asked for all of it at once. ',
      el('a', { href: '#lab' }, 'Try it in the Query lab')));
  }

  const shown = ['etag', 'cache-control', 'x-data-source', 'x-data-calls', 'x-upstream-calls', 'server-timing', 'ratelimit-remaining', 'content-type'];
  $('#rest-headers').replaceChildren(...shown.filter((h) => res.headers.get(h)).map((h) =>
    el('tr', {}, el('td', {}, h), el('td', {}, res.headers.get(h)))));

  const body = $('#rest-body');
  if (!text) { body.replaceChildren(document.createTextNode('(empty body)')); return; }
  renderJson(body, JSON.parse(text), { onLink: (link) => send(link) });
}

function renderTrail() {
  const box = $('#trail');
  const total = trail.reduce((s, t) => s + t.bytes, 0);
  box.replaceChildren(
    el('span', {}, el('strong', {}, `${trail.length} request${trail.length === 1 ? '' : 's'}`), `, ${fmtBytes(total)} received`),
    el('ol', {}, ...trail.slice(-8).map((t) => el('li', {}, `${t.status} ${t.path.replace(/\?.*/, '')}`))),
    trail.length ? el('button', { class: 'pill', type: 'button', onclick: () => { trail.length = 0; renderTrail(); $('#rest-callout').replaceChildren(); } }, 'Reset count') : null,
  );
}
