// Optional group restriction: with REQUIRED_TEAM set, access needs one of the groups that the SSO
// proxy passes in X-Auth-Request-Groups; /health stays open for the container probe.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATA_SOURCE = 'demo';
process.env.REQUIRED_TEAM = 'ecomm, finance';
const { createApp } = await import('../src/app.js');

let server;
let base;
before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('/health is open', async () => {
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

test('without a required group the page and the data are forbidden', async () => {
  const html = await fetch(`${base}/`, { headers: { Accept: 'text/html', 'X-Auth-Request-Groups': 'sales' } });
  assert.equal(html.status, 403);
  assert.match(await html.text(), /Нет доступа/);
  const json = await fetch(`${base}/api/meta`, { headers: { 'X-Auth-Request-Groups': 'sales' } });
  assert.equal(json.status, 403);
});

test('any one of the required groups is enough', async () => {
  const res = await fetch(`${base}/api/meta`, { headers: { 'X-Auth-Request-Groups': '/sales,/finance' } });
  assert.equal(res.status, 200);
});
