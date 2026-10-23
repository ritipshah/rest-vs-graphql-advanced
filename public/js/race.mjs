// Race view: one question, every strategy, measured in the browser and replayed side by side.
import { scenarios, runStrategy, defaultParams, sameResult } from './scenarios.mjs';
import { $, el, fmtBytes, fmtMs, bytesOf, renderJson, highlightGraphQL, setFlaps, reportSource, pruneToUsed, reducedMotion } from './ui.mjs';

const NETWORKS = [
  { ms: 0, label: 'Localhost' },
  { ms: 20, label: 'Wi-Fi' },
  { ms: 80, label: '4G' },
  { ms: 300, label: 'Slow 3G' },
];

const state = {
  scenario: scenarios[0],
  params: defaultParams(scenarios[0]),
  latency: 80,
  runs: null,
  xrayKey: 'rest',
  xrayCall: 0,
  warmed: new Set(),
};

export function init() {
  renderScenarioPicker();
  renderNetwork();
  $('#run').addEventListener('click', race);
  tickClock();
  setInterval(tickClock, 15_000);
  selectScenario(scenarios[0]);
}

function tickClock() {
  $('#board-clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ---------- controls ----------
function renderScenarioPicker() {
  const box = $('#scenario-picker');
  for (const s of scenarios) {
    box.append(el('button', {
      class: 'pill', type: 'button', 'aria-pressed': 'false', 'data-id': s.id,
      onclick: () => selectScenario(s),
    }, s.title));
  }
}

function renderNetwork() {
  const box = $('#network');
  for (const n of NETWORKS) {
    const input = el('input', { type: 'radio', name: 'network', value: String(n.ms), checked: n.ms === state.latency });
    input.addEventListener('change', () => { state.latency = n.ms; });
    box.append(el('label', {}, input, el('span', {}, n.ms ? `${n.label} ${n.ms} ms` : n.label)));
  }
}

function selectScenario(scenario) {
  state.scenario = scenario;
  state.params = defaultParams(scenario);
  state.runs = null;
  for (const b of document.querySelectorAll('#scenario-picker .pill')) b.setAttribute('aria-pressed', String(b.dataset.id === scenario.id));
  const slot = $('#param-slot');
  slot.replaceChildren();
  if (scenario.param) {
    const select = el('select', { class: 'select', id: 'param' },
      scenario.param.options.map(([value, text]) => el('option', { value, selected: value === state.params[scenario.param.name] }, text)));
    select.addEventListener('change', () => {
      state.params = { [scenario.param.name]: select.value };
      updateQuestion();
      resetResults();
    });
    slot.append(el('label', { class: 'field-label', for: 'param' }, scenario.param.label), select);
  }
  updateQuestion();
  $('#teaches').textContent = scenario.teaches;
  resetResults();
}

function updateQuestion() {
  $('#question').textContent = state.scenario.question(state.params);
}

// ---------- departure board ----------
const COLS = { requests: 3, roundTrips: 2, received: 5, time: 5 };

function boardRows() {
  const body = $('#board-rows');
  body.replaceChildren();
  const keys = Object.keys(state.scenario.strategies);
  $('#board-title').textContent = `Departures: one question, ${keys.length} routes`;
  for (const key of keys) {
    const s = state.scenario.strategies[key];
    body.append(el('tr', { 'data-lane': key, id: `row-${key}` },
      el('td', {}, el('div', { class: 'route' },
        el('span', { class: 'route-tick', 'aria-hidden': 'true' }),
        el('div', {}, el('div', { class: 'route-name' }, s.label), el('div', { class: 'route-how' }, s.how)))),
      el('td', { class: 'num' }, el('span', { class: 'flaps', 'data-col': 'requests' })),
      el('td', { class: 'num' }, el('span', { class: 'flaps', 'data-col': 'roundTrips' })),
      el('td', { class: 'num' }, el('span', { class: 'flaps', 'data-col': 'received' }), el('span', { class: 'unit', 'data-unit': 'received' })),
      el('td', { class: 'num' }, el('span', { class: 'flaps', 'data-col': 'time' }), el('span', { class: 'unit' }, 'ms')),
      el('td', { 'data-col': 'same' }, el('span', { class: 'route-how' }, 'waiting')),
    ));
    for (const [col, width] of Object.entries(COLS)) setFlaps(body.querySelector(`#row-${key} [data-col="${col}"]`), '', width);
  }
}

function splitBytes(n) {
  if (n < 1024) return [String(n), 'B'];
  if (n < 1024 * 1024) return [(n / 1024).toFixed(1), 'KB'];
  return [(n / 1024 / 1024).toFixed(2), 'MB'];
}

function fillRow(run, reference) {
  const row = $(`#row-${run.key}`);
  setFlaps(row.querySelector('[data-col="requests"]'), run.requests, COLS.requests);
  setFlaps(row.querySelector('[data-col="roundTrips"]'), run.roundTrips, COLS.roundTrips);
  const [num, unit] = splitBytes(run.bytes);
  setFlaps(row.querySelector('[data-col="received"]'), num, COLS.received);
  row.querySelector('[data-unit="received"]').textContent = unit;
  setFlaps(row.querySelector('[data-col="time"]'), Math.round(run.wallMs), COLS.time);
  const same = row.querySelector('[data-col="same"]');
  if (run.error) same.replaceChildren(el('span', { class: 'verdict-bad' }, 'failed'));
  else if (reference) {
    const ok = sameResult(run.result, reference);
    same.replaceChildren(el('span', { class: ok ? 'verdict-ok' : 'verdict-bad' }, ok ? '✓ identical' : '✕ differs'));
  }
}

function resetResults() {
  boardRows();
  $('#board-foot').innerHTML = 'Press <b>Run the race</b>. Each route answers the same question against the same server and data.';
  $('#lanes').replaceChildren(el('p', { class: 'empty-state' }, 'Run the race to see the timeline.'));
  $('#xray-title').textContent = 'The x-ray: what was sent versus what was used';
  $('#call-list').replaceChildren();
  $('#call-meta').textContent = '';
  $('#rest-json').replaceChildren();
  const gql = state.scenario.strategies.graphql;
  $('#gql-query').innerHTML = highlightGraphQL(gql.query);
  $('#gql-json').replaceChildren();
}

// ---------- the race ----------
async function race() {
  const button = $('#run');
  button.disabled = true;
  const { scenario, params, latency } = state;
  const keys = Object.keys(scenario.strategies);
  const base = location.origin;
  boardRows();
  const foot = $('#board-foot');
  try {
    // Warm the server's cache first, so no route is punished for being the first to ask SWAPI.
    const warmKey = `${scenario.id}:${JSON.stringify(params)}`;
    if (!state.warmed.has(warmKey)) {
      button.textContent = 'Warming cache';
      foot.textContent = 'Fetching this data once so every route starts from the same warm cache. The first time can take a few seconds while we politely ask SWAPI.';
      for (const key of keys) await runStrategy(base, scenario, key, params, {});
      state.warmed.add(warmKey);
    }
    button.textContent = 'Racing';
    foot.textContent = 'Routes run one at a time, so they never compete for the same connection.';
    const runs = [];
    let reference = null;
    // GraphQL first only to have a reference answer for the "same answer" column.
    for (const key of ['graphql', ...keys.filter((k) => k !== 'graphql')]) {
      let run;
      try {
        run = await runStrategy(base, scenario, key, params, { latency });
      } catch (err) {
        run = { key, label: scenario.strategies[key].label, error: err.message, calls: [], requests: 0, roundTrips: 0, bytes: 0, wallMs: 0 };
      }
      if (key === 'graphql') reference = run.result;
      runs.push(run);
      fillRow(run, reference);
      for (const c of run.calls) reportSource(c.dataSource);
    }
    state.runs = Object.fromEntries(runs.map((r) => [r.key, r]));
    const failed = runs.find((r) => r.error);
    if (failed) {
      foot.textContent = /429/.test(failed.error)
        ? `${failed.label} hit the server's rate limit (${window.APP_META?.limits?.rateLimitPerMinute ?? 'N'} requests per minute). Wait a minute, or raise RATE_LIMIT_PER_MINUTE in .env for demos.`
        : `${failed.label} failed: ${failed.error}`;
      return;
    }
    state.xrayKey = 'rest';
    state.xrayCall = 0;
    summarise();
    drawWaterfall();
    drawXray();
  } catch (err) {
    foot.textContent = `The race stopped: ${err.message}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Run the race again';
  }
}

function summarise() {
  const runs = Object.values(state.runs).filter((r) => !r.error);
  const gql = state.runs.graphql;
  const rest = runs.filter((r) => r.key !== 'graphql');
  const worst = rest.reduce((a, b) => (b.requests > a.requests ? b : a), rest[0]);
  const parts = [`GraphQL answered in <b>1 request</b> (${fmtMs(gql.wallMs)}).`];
  if (worst) parts.push(`The busiest REST route needed <b>${worst.requests} requests over ${worst.roundTrips} round trip${worst.roundTrips === 1 ? '' : 's'}</b> (${fmtMs(worst.wallMs)}).`);
  if (state.latency) parts.push(`Every request waited a simulated ${state.latency} ms.`);
  if (worst && worst.requests > 6) parts.push('Browsers send at most 6 requests at once to one server over HTTP/1.1, so the rest queue up.');
  $('#board-foot').innerHTML = parts.join(' ');
}

// ---------- waterfall ----------
function niceStep(total) {
  const rough = total / 6;
  const pow = 10 ** Math.floor(Math.log10(Math.max(rough, 1)));
  return [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) || pow * 10;
}

function drawWaterfall() {
  const lanes = $('#lanes');
  lanes.replaceChildren();
  const runs = Object.keys(state.scenario.strategies).map((k) => state.runs[k]).filter((r) => r && !r.error);
  const total = Math.max(...runs.map((r) => Math.max(r.wallMs, ...r.calls.map((c) => c.end - r.calls[0].start)))) * 1.08 || 1;
  const pct = (ms) => `${(ms / total) * 100}%`;

  const axis = el('div', { class: 'axis', 'aria-hidden': 'true' });
  const step = niceStep(total);
  for (let ms = 0; ms <= total; ms += step) axis.append(el('span', { style: { left: pct(ms) } }, ms === 0 ? '0 ms' : `${ms}`));
  lanes.append(axis);

  const animate = !reducedMotion();
  for (const run of runs) {
    const t0 = run.calls[0].start;
    const rowH = run.calls.length > 20 ? 7 : 10;
    const track = el('div', { class: 'track', style: { height: `${Math.max(16, run.calls.length * rowH)}px` } });

    if (run.roundTrips > 1) {
      for (let s = 1; s <= run.roundTrips; s++) {
        const inStage = run.calls.filter((c) => c.stage === s);
        if (!inStage.length) continue;
        const a = Math.min(...inStage.map((c) => c.start)) - t0;
        const b = Math.max(...inStage.map((c) => c.end)) - t0;
        track.append(el('div', { class: 'stage-band', style: { left: pct(a), width: pct(b - a) }, 'aria-hidden': 'true' }, el('b', {}, String(s))));
      }
    }
    run.calls.forEach((c, i) => {
      const bar = el('button', {
        class: 'bar', type: 'button', 'data-lane': run.key,
        style: { left: pct(c.start - t0), width: pct(Math.max(c.end - c.start, total * 0.004)), top: `${i * rowH + (rowH - 6) / 2}px` },
        'aria-label': `${c.method} ${c.url}, status ${c.status}, ${fmtBytes(c.bytes)}, ${fmtMs(c.end - c.start)}`,
        title: `${c.method} ${c.url}\n${c.status}  ${fmtBytes(c.bytes)}  ${fmtMs(c.end - c.start)}`,
        onclick: () => { if (run.key !== 'graphql') { state.xrayKey = run.key; state.xrayCall = i; drawXray(); $('#xray-title').scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
      });
      track.append(bar);
      if (animate) {
        bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
          delay: c.start - t0, duration: Math.max(16, c.end - c.start), easing: 'linear', fill: 'backwards',
        });
      }
    });
    const nearEnd = run.wallMs / total > 0.72; // keep the label inside the panel
    const finish = el('div', { class: `finish${nearEnd ? ' is-end' : ''}`, style: { left: pct(run.wallMs) } }, el('b', {}, fmtMs(run.wallMs)));
    track.append(finish);
    if (animate) finish.animate([{ opacity: 0 }, { opacity: 1 }], { delay: run.wallMs, duration: 160, fill: 'backwards' });

    lanes.append(el('div', { class: 'lane', 'data-lane': run.key },
      el('div', { class: 'lane-label' },
        el('strong', {}, run.label),
        el('span', {}, `${run.requests} request${run.requests === 1 ? '' : 's'}, ${run.roundTrips} round trip${run.roundTrips === 1 ? '' : 's'}`)),
      track));
  }
}

// ---------- x-ray ----------
function drawXray() {
  const rest = state.runs[state.xrayKey] || state.runs.rest;
  const gql = state.runs.graphql;
  const naive = state.runs.rest;

  const head = $('#xray-title');
  head.replaceChildren(
    'REST, following links, received ', el('span', { class: 'rest-num' }, fmtBytes(naive.bytes)),
    ` in ${naive.requests} responses. GraphQL received `, el('span', { class: 'gql-num' }, fmtBytes(gql.bytes)),
    ` in one. The answer itself is ${fmtBytes(naive.usefulBytes)}.`,
  );

  // strategy switcher + one chip per request
  const list = $('#call-list');
  list.replaceChildren();
  const restKeys = Object.keys(state.scenario.strategies).filter((k) => k !== 'graphql' && state.runs[k] && !state.runs[k].error);
  const switcher = el('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'REST route' });
  for (const k of restKeys) {
    const input = el('input', { type: 'radio', name: 'xray-route', value: k, checked: k === rest.key });
    input.addEventListener('change', () => { state.xrayKey = k; state.xrayCall = 0; drawXray(); });
    switcher.append(el('label', {}, input, el('span', {}, state.runs[k].label)));
  }
  list.append(switcher);
  rest.calls.forEach((c, i) => {
    list.append(el('button', {
      class: 'call-chip', type: 'button', 'aria-pressed': String(i === state.xrayCall),
      onclick: () => { state.xrayCall = i; drawXray(); },
    }, `${i + 1}  ${c.url.replace(/^https?:\/\/[^/]+/, '')}`));
  });

  const call = rest.calls[state.xrayCall] || rest.calls[0];
  const used = bytesOf(pruneToUsed(call.json, call.uses));
  const fields = call.json && !Array.isArray(call.json) ? Object.keys(call.json) : [];
  const usedFields = call.uses && typeof call.uses === 'object' ? fields.filter((f) => f in call.uses) : fields;
  $('#call-meta').textContent = `Request ${state.xrayCall + 1} of ${rest.calls.length}: ${call.method} ${call.url.replace(/^https?:\/\/[^/]+/, '')}. `
    + `Used ${usedFields.length} of ${fields.length} top-level fields; about ${fmtBytes(Math.min(used, call.bytes))} of ${fmtBytes(call.bytes)} was needed.`;
  renderJson($('#rest-json'), call.json, { uses: call.uses });

  $('#gql-query').innerHTML = highlightGraphQL(state.scenario.strategies.graphql.query);
  renderJson($('#gql-json'), gql.calls[0]?.json ?? null);

  document.querySelectorAll('.bar.is-selected').forEach((b) => b.classList.remove('is-selected'));
  const lane = document.querySelector(`.lane[data-lane="${rest.key}"]`);
  lane?.querySelectorAll('.bar')[state.xrayCall]?.classList.add('is-selected');
}
