// Server smoke test on demo data: placeholder while building, page data, meta, ops endpoints.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATA_SOURCE = 'demo';
process.env.DEMO_TODAY = '2026-11-18';
process.env.OPS_TOKEN = 'test-token';
delete process.env.REQUIRED_TEAM;
const { createApp, buildInBackground } = await import('../src/app.js');

let server;
let base;
before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('GET /health does not wait for the snapshot', async () => {
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), { status: 'ok' });
});

test('before the first build: placeholder page, data endpoints answer 503', async () => {
  // Data requests do not start a build; the page does (and shows the placeholder meanwhile).
  assert.equal((await fetch(`${base}/data/meta.json`)).status, 503);
  const page = await (await fetch(`${base}/`)).text();
  assert.match(page, /Отчет собирается/);
});

test('after the build: the dashboard and every data file are served', async () => {
  await buildInBackground();
  const page = await (await fetch(`${base}/`)).text();
  assert.match(page, /<script src=/);
  for (const name of ['meta', 'profit', 'sales', 'ads', 'stock', 'plan', 'codes', 'list101']) {
    const res = await fetch(`${base}/data/${name}.json`);
    assert.equal(res.status, 200, name);
    assert.ok(Object.keys(await res.json()).length, name);
  }
  assert.equal((await fetch(`${base}/data/nope.json`)).status, 404);
});

test('page data is sent gzip-compressed when the browser accepts it', async () => {
  const res = await fetch(`${base}/data/profit.json`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(res.headers.get('content-encoding'), 'gzip');
});

test('GET /api/meta reports the snapshot coverage', async () => {
  const meta = await (await fetch(`${base}/api/meta`)).json();
  assert.equal(meta.ok, true);
  assert.equal(meta.meta.today, '2026-11-18');
  assert.deepEqual(meta.meta.estMonths, ['2026-10', '2026-11']);
});

test('ops endpoints need the bearer token', async () => {
  assert.equal((await fetch(`${base}/api/ops/etl`)).status, 401);
  const etl = await (await fetch(`${base}/api/ops/etl`, { headers: { Authorization: 'Bearer test-token' } })).json();
  assert.equal(etl.jobs[0].lastRun.status, 'ok');
  const signals = await (await fetch(`${base}/api/ops/signals`, { headers: { Authorization: 'Bearer test-token' } })).json();
  // Two estimated months: the profitability files lag behind — an informational signal.
  assert.ok(signals.signals.some((s) => s.id.endsWith(':profit_lag')));
});

test('POST /api/refresh starts a background rebuild', async () => {
  const res = await fetch(`${base}/api/refresh`, { method: 'POST' });
  assert.equal(res.status, 202);
  await buildInBackground();
});
