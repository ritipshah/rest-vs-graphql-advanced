// Entry point: tab routing (#race, #lab, #rest, #choose) and the data-source indicator.
// Each view's code is loaded the first time it is opened.
import { reportSource } from './ui.mjs';

const VIEWS = {
  race: () => import('./race.mjs'),
  lab: () => import('./lab.mjs'),
  rest: () => import('./explorer.mjs'),
  choose: () => import('./choose.mjs'),
};
const started = new Set();

async function show() {
  const name = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'race';
  for (const key of Object.keys(VIEWS)) {
    document.getElementById(`view-${key}`).hidden = key !== name;
  }
  for (const tab of document.querySelectorAll('.tab')) {
    if (tab.getAttribute('href') === `#${name}`) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  if (!started.has(name)) {
    started.add(name);
    const mod = await VIEWS[name]();
    await mod.init(document.getElementById(`view-${name}`));
  }
}

window.addEventListener('hashchange', () => { show(); window.scrollTo({ top: 0 }); });

fetch('/meta')
  .then((r) => r.json())
  .then((meta) => {
    window.APP_META = meta;
    reportSource(meta.dataSource === 'snapshot' ? 'snapshot' : 'live');
  })
  .catch(() => {
    document.getElementById('source-label').textContent = 'Server not reachable';
  });

show();
