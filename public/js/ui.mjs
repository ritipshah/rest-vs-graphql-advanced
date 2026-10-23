// Small helpers shared by every view. No framework: plain DOM.

export const $ = (sel, root = document) => root.querySelector(sel);
export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** el('button', { class: 'pill', onclick }, 'Text') */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) node.append(c);
  return node;
}

// \u00a0 (non-breaking space) keeps "13.7 KB" on one line
export function fmtBytes(n) {
  if (n < 1024) return `${n}\u00a0B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}\u00a0KB`;
  return `${(n / 1024 / 1024).toFixed(2)}\u00a0MB`;
}
export const fmtMs = (ms) => `${Math.round(ms)}\u00a0ms`;
export const bytesOf = (value) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- data source indicator in the header ----------
const SOURCE_TEXT = {
  live: 'Live SWAPI',
  cache: 'Live SWAPI, from cache',
  snapshot: 'Offline snapshot',
  fallback: 'SWAPI unreachable: showing snapshot data',
};
export function reportSource(value) {
  if (!value) return;
  const parts = String(value).split(',');
  const state = ['fallback', 'live', 'cache', 'snapshot'].find((s) => parts.includes(s));
  if (!state) return;
  const box = document.getElementById('source');
  box.dataset.state = state;
  document.getElementById('source-label').textContent = SOURCE_TEXT[state];
  box.title = `Last response came from: ${value}`;
}

// ---------- JSON viewer with optional x-ray ----------
// uses: null = plain view; true = all used; { key: true | {...} } = only those keys used
const URL_RE = /^https?:\/\/[^\s]+\/api\/\w+\/\d+\/?(\?.*)?$/;

/** The part of `value` that `uses` says was needed (for "used bytes"). */
export function pruneToUsed(value, uses) {
  if (uses === true || uses === null || uses === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => pruneToUsed(v, uses));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).filter((k) => k in uses).map((k) => [k, pruneToUsed(value[k], uses[k])]));
  }
  return value;
}

export function renderJson(target, value, { uses = null, onLink = null, maxString = 140, maxItems = 40 } = {}) {
  target.replaceChildren();
  const out = document.createDocumentFragment();
  const t = (s) => document.createTextNode(s);
  const span = (cls, text) => el('span', { class: cls, text });

  function scalar(v) {
    if (typeof v === 'string') {
      if (onLink && URL_RE.test(v)) {
        return el('button', { class: 'j-link', type: 'button', onclick: () => onLink(v), title: 'Follow this link (one more request)' }, JSON.stringify(v));
      }
      const shown = v.length > maxString ? `${v.slice(0, maxString)}…` : v;
      return span('j-str', JSON.stringify(shown).replace(/\\r\\n/g, '\\n'));
    }
    if (typeof v === 'number') return span('j-num', String(v));
    return span('j-lit', String(v));
  }

  function write(parent, v, u, indent) {
    const pad = '  '.repeat(indent);
    if (Array.isArray(v)) {
      if (!v.length) { parent.append(span('j-punc', '[]')); return; }
      parent.append(span('j-punc', '['), t('\n'));
      const shown = v.slice(0, maxItems);
      shown.forEach((item, i) => {
        parent.append(t(`${pad}  `));
        write(parent, item, u, indent + 1);
        if (i < v.length - 1) parent.append(span('j-punc', ','));
        parent.append(t('\n'));
      });
      if (v.length > shown.length) parent.append(t(`${pad}  `), span('j-more', `… ${v.length - shown.length} more`), t('\n'));
      parent.append(t(pad), span('j-punc', ']'));
      return;
    }
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      if (!keys.length) { parent.append(span('j-punc', '{}')); return; }
      parent.append(span('j-punc', '{'), t('\n'));
      keys.forEach((k, i) => {
        const xray = u && typeof u === 'object';
        const used = !xray || k in u;
        const line = el('span', { class: xray ? (used ? 'xr-used' : 'xr-unused') : null });
        line.append(span('j-key', JSON.stringify(k)), span('j-punc', ': '));
        write(line, v[k], xray ? (used ? u[k] : null) : u, indent + 1);
        parent.append(t(`${pad}  `), line);
        if (i < keys.length - 1) parent.append(span('j-punc', ','));
        parent.append(t('\n'));
      });
      parent.append(t(pad), span('j-punc', '}'));
      return;
    }
    parent.append(scalar(v));
  }

  write(out, value, uses, 0);
  target.append(out);
}

// ---------- GraphQL syntax highlighting (for the editor overlay and read-only views) ----------
const GQL_TOKEN = /(#[^\n]*)|("(?:[^"\\]|\\.)*"?)|(\$[_A-Za-z][_0-9A-Za-z]*)|(-?\d+(?:\.\d+)?)|([_A-Za-z][_0-9A-Za-z]*)|(\.\.\.|[{}()[\]:!=@,|])|(\s+)|(.)/g;
const KEYWORDS = new Set(['query', 'mutation', 'subscription', 'fragment', 'on', 'true', 'false', 'null']);
export function highlightGraphQL(src) {
  let html = '';
  for (const m of src.matchAll(GQL_TOKEN)) {
    const [tok, com, str, vari, num, name, punc] = m;
    const e = escapeHtml(tok);
    if (com) html += `<span class="g-com">${e}</span>`;
    else if (str) html += `<span class="g-str">${e}</span>`;
    else if (vari) html += `<span class="g-var">${e}</span>`;
    else if (num) html += `<span class="g-num">${e}</span>`;
    else if (name) {
      if (KEYWORDS.has(name)) html += `<span class="g-key">${e}</span>`;
      else if (/^[A-Z]/.test(name) && name !== 'MGLT') html += `<span class="g-type">${e}</span>`;
      else html += `<span class="g-name">${e}</span>`;
    } else if (punc) html += `<span class="g-punc">${e}</span>`;
    else html += e;
  }
  return html;
}

// ---------- split-flap cells ----------
const DIGITS = '0123456789';
/**
 * Show `text` (right-aligned, padded to `width`) in a row of flap cells, turning each
 * changed cell through the characters in between, like a station departure board.
 */
export function setFlaps(container, text, width) {
  const value = String(text).padStart(width, ' ').slice(-width);
  while (container.children.length < width) container.append(el('span', { class: 'flap is-blank', 'aria-hidden': 'true', text: ' ' }));
  container.setAttribute('aria-label', String(text).trim() || 'none');
  const cells = [...container.children];
  cells.forEach((cell, i) => {
    const to = value[i];
    const from = cell.textContent;
    if (from === to) return;
    if (reducedMotion()) { paint(cell, to); return; }
    const steps = [];
    if (DIGITS.includes(to)) {
      let d = DIGITS.includes(from) ? Number(from) : 0;
      steps.push(String(d));
      while (String(d) !== to) { d = (d + 1) % 10; steps.push(String(d)); }
    } else {
      steps.push(to);
    }
    steps.forEach((ch, s) => setTimeout(() => {
      paint(cell, ch);
      cell.classList.remove('is-turning');
      void cell.offsetWidth; // restart the animation
      cell.classList.add('is-turning');
    }, i * 45 + s * 55));
  });
}
function paint(cell, ch) {
  cell.textContent = ch;
  cell.classList.toggle('is-blank', ch === ' ');
}
