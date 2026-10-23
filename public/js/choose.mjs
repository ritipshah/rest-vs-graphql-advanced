// "Which one?": a decision helper for research question 3, plus short answers to all three.
import { $, el } from './ui.mjs';

const FACTORS = [
  { side: 'gql', weight: 2, title: 'Different screens need different slices of the same data', why: 'Each screen writes its own query; no new endpoint per screen.' },
  { side: 'gql', weight: 2, title: 'Users are on slow mobile networks', why: 'One round trip instead of several dependent ones (see Race, Slow 3G).' },
  { side: 'gql', weight: 2, title: 'The data is deeply connected', why: 'Following links two levels deep is one nested query.' },
  { side: 'gql', weight: 1, title: 'Front-end changes often and should not wait for back-end changes', why: 'Clients add fields to the query; the server does not change.' },
  { side: 'gql', weight: 1, title: 'You want a typed, self-documenting contract', why: 'The schema is the documentation, readable by tools (introspection).' },
  { side: 'rest', weight: 2, title: 'Responses should be cached by browsers and CDNs', why: 'Every REST URL is a cache key; ETags give free 304s.' },
  { side: 'rest', weight: 2, title: 'It is a public API for many unknown clients', why: 'Everyone knows REST and HTTP status codes; no query language to learn.' },
  { side: 'rest', weight: 2, title: 'Mostly simple create, read, update, delete', why: 'Resources map cleanly to URLs and HTTP methods.' },
  { side: 'rest', weight: 1, title: 'You upload or stream files', why: 'Plain HTTP handles binary bodies; GraphQL needs extra specs.' },
  { side: 'rest', weight: 1, title: 'A small team that does not want to run query limits', why: 'GraphQL needs depth and cost limits, batching and monitoring per field.' },
];

export function init() {
  const list = $('#factors');
  FACTORS.forEach((f, i) => {
    const input = el('input', { type: 'checkbox', id: `factor-${i}` });
    input.addEventListener('change', weigh);
    list.append(el('li', {}, el('label', { class: 'factor', for: `factor-${i}` },
      input,
      el('div', {}, el('strong', {}, f.title), el('span', {}, f.why)),
      el('span', { class: `side ${f.side}` }, f.side === 'gql' ? 'GraphQL' : 'REST'))));
  });
  renderAnswers();
  weigh();
}

function weigh() {
  let rest = 0;
  let gql = 0;
  const reasons = { rest: [], gql: [] };
  FACTORS.forEach((f, i) => {
    if (!document.getElementById(`factor-${i}`).checked) return;
    if (f.side === 'rest') { rest += f.weight; reasons.rest.push(f.title.toLowerCase()); } else { gql += f.weight; reasons.gql.push(f.title.toLowerCase()); }
  });
  const tilt = Math.max(-12, Math.min(12, (rest - gql) * 2.4)); // positive tips the REST pan down
  $('#beam').style.transform = `rotate(${-tilt}deg)`;
  $('#rest-weight').textContent = String(rest);
  $('#gql-weight').textContent = String(gql);

  const verdict = $('#scale-verdict');
  const reason = $('#scale-reason');
  if (!rest && !gql) { verdict.textContent = 'Either works'; reason.textContent = 'Nothing ticked yet.'; return; }
  if (Math.abs(rest - gql) <= 1) {
    verdict.textContent = 'Either works';
    reason.textContent = 'The reasons are balanced. Many teams use both: REST for public, cacheable resources and GraphQL for their own apps.';
    return;
  }
  const winner = rest > gql ? 'rest' : 'gql';
  verdict.textContent = winner === 'rest' ? 'Lean towards REST' : 'Lean towards GraphQL';
  verdict.style.color = winner === 'rest' ? 'var(--rest-ink)' : 'var(--gql-ink)';
  reason.textContent = `Because ${reasons[winner].slice(0, 2).join(' and ')}${reasons[winner].length > 2 ? ', and more' : ''}.`;
}

function renderAnswers() {
  $('#answers').replaceChildren(
    el('article', {},
      el('h3', {}, 'What are over-fetching and under-fetching?'),
      el('p', {}, 'Over-fetching: the response carries more than the client needs. GET /api/people/1/ sends 16 fields when the card shows three.'),
      el('p', {}, 'Under-fetching: one response is not enough, so the client makes more requests. The person only links to their planet and films, so REST needs a second round.'),
      el('p', {}, el('a', { href: '#race' }, 'See both in the Race x-ray'))),
    el('article', {},
      el('h3', {}, 'What are schema, query and resolver?'),
      el('p', {}, 'The schema is the typed contract: Person has a homeworld of type Planet. The query is what the client sends: the exact fields it wants, nested. A resolver is the server function that fetches one field, run only when the query asks for it.'),
      el('p', {}, el('a', { href: '#lab' }, 'Tick fields in the Query lab'))),
    el('article', {},
      el('h3', {}, 'When would you still choose REST?'),
      el('p', {}, 'When HTTP caching matters, for public APIs used by many unknown clients, for simple resource-style CRUD, for files, and when the team does not want to run GraphQL\'s extra machinery (query limits, batching, per-field monitoring).'),
      el('p', {}, el('a', { href: '#rest' }, 'Watch a 304 in the REST explorer'))),
  );
}
