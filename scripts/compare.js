// Same questions, every strategy, measured. Talks ONLY to your local server (which caches SWAPI).
// Not a load test: a few dozen requests per run.
//
//   npm run compare                      all scenarios, no extra latency
//   npm run compare -- --latency=80      pretend every request crosses a 4G network (80 ms)
//   npm run compare -- --scenario=card   just one scenario
//   npm run compare -- --markdown        also write docs/results.md for the README
//
// The scenarios live in public/js/scenarios.mjs and are the same ones the browser UI races.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const config = require('../src/config');

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, v] = a.replace(/^--/, '').split('=');
  return [k, v ?? true];
}));
const BASE = args.base || `http://localhost:${config.port}`;
const latency = Number(args.latency || 0);
const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);

(async () => {
  const { scenarios, runStrategy, defaultParams, sameResult } = await import(
    pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'scenarios.mjs')).href
  );
  const chosen = scenarios.filter((s) => !args.scenario || s.id === args.scenario);
  if (!chosen.length) throw new Error(`No scenario "${args.scenario}". Try: ${scenarios.map((s) => s.id).join(', ')}`);

  const meta = await fetch(`${BASE}/meta`).then((r) => r.json());
  const md = [
    `Measured with \`npm run compare${latency ? ` -- --latency=${latency}` : ''}\` on ${new Date().toISOString().slice(0, 10)}; `
    + `data source: ${meta.dataSource}; simulated latency per request: ${latency} ms.`,
    '',
  ];
  console.log(`\nData source: ${meta.dataSource}   Simulated latency: ${latency} ms per request\n`);

  for (const scenario of chosen) {
    const params = defaultParams(scenario);
    const runs = [];
    // Warm the server cache once so the first strategy is not punished for a cold cache.
    await runStrategy(BASE, scenario, 'graphql', params, {});
    for (const key of Object.keys(scenario.strategies)) runs.push(await runStrategy(BASE, scenario, key, params, { latency }));
    const reference = runs.find((r) => r.key === 'graphql').result;

    const rows = runs.map((r) => ({
      strategy: r.label,
      requests: r.requests,
      'round trips': r.roundTrips,
      received: kb(r.bytes),
      'x needed': `${(r.bytes / r.usefulBytes).toFixed(1)}x`,
      'data calls': r.dataCalls,
      'time (ms)': Math.round(r.wallMs),
      'same answer': sameResult(r.result, reference) ? 'yes' : 'NO',
    }));
    console.log(`${scenario.title}: ${scenario.question(params)}`);
    console.table(rows);

    md.push(`**${scenario.title}**: ${scenario.question(params)}`, '');
    md.push(`| ${Object.keys(rows[0]).join(' | ')} |`, `|${Object.keys(rows[0]).map(() => '---').join('|')}|`);
    for (const row of rows) md.push(`| ${Object.values(row).join(' | ')} |`);
    md.push('');
  }

  if (args.markdown) {
    const file = path.join(__dirname, '..', 'docs', `results${latency ? `-latency-${latency}` : ''}.md`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, md.join('\n'));
    console.log(`Wrote ${path.relative(process.cwd(), file)}`);
  }
  console.log('"x needed" = bytes received / bytes of the final answer. 1.0x would mean zero over-fetching.');
})().catch((e) => {
  console.error(e.message.includes('fetch failed') ? 'Is the server running? Start it with `npm start` in another terminal.' : e);
  process.exit(1);
});
