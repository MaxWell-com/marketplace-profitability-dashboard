// Demo inputs → build(): the contract with the production ETL, cross-source consistency and the
// scenarios the dashboard pages rely on (see src/demo/model.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildInputs, WB, OZON } from '../src/demo/model.js';
import { build } from '../src/etl/build.js';

const TODAY = '2026-11-18';
const inputs = buildInputs(TODAY);
const { t, profit, refs, list101 } = inputs;
const log = [];
const { files, summary } = build({ ...inputs, log: (m) => log.push(m) });

test('inputs are deterministic', () => {
  // Hash instead of deepEqual: the inputs hold hundreds of thousands of rows.
  const digest = (x) => createHash('sha256').update(JSON.stringify([x.t, x.profit, [...x.refs], x.list101])).digest('hex');
  // Two fresh runs: build() annotates its inputs in place, so the ones used above are not pristine.
  assert.equal(digest(buildInputs(TODAY)), digest(buildInputs(TODAY)));
});

test('every table the ETL reads is present and non-empty', () => {
  for (const name of ['freshness', 'nomen', 'bridge', 'sales_month', 'sales_daily', 'mp_daily', 'mp_articles', 'mp_code',
    'ads_wb', 'plan_op', 'our_stock', 'wb_card_month', 'dwh_freshness', 'wb_stock_daily', 'oz_stock_daily',
    'wb_orders_daily', 'wb_search_month', 'wb_funnel_month', 'wb_adverts', 'wb_ads_nm_month', 'oz_ads_campaign']) {
    assert.ok(Array.isArray(t[name]) && t[name].length, `table ${name} is empty`);
  }
  assert.equal(t.freshness[0].today, TODAY);
});

test('codes, partners and marketplace ids agree across sources', () => {
  const codes = new Set(t.nomen.map((r) => r.code));
  for (const r of [...t.sales_month, ...t.ads_wb, ...t.bridge]) assert.ok(codes.has(r.Код), `unknown code ${r.Код}`);
  for (const r of profit.rows) assert.ok(codes.has(r.code) && refs.has(r.code));
  const partners = new Set(t.sales_month.map((r) => r.Партнер));
  for (const p of [WB, OZON]) assert.ok(partners.has(p));
  for (const r of t.plan_op.filter((x) => x['Статья бюджетов'].startsWith('План продаж по клиентам'))) assert.ok(partners.has(r['Аналитика 4']));
  const bridged = new Set(t.bridge.filter((r) => r.Маркетплейс === 'Wildberries').map((r) => r['SKU в системе маркетплейса']));
  for (const r of list101.filter((x) => x.nm_id)) assert.ok(bridged.has(r.nm_id));
  const advertIds = new Set(t.wb_adverts.map((r) => r.advert_id));
  for (const r of t.ads_wb.filter((x) => x.Маркетплейс === 'Wildberries')) assert.ok(advertIds.has(r['ID рекламной кампании']));
});

test('nothing is dated after "today"', () => {
  const ym = TODAY.slice(0, 7);
  for (const r of t.sales_month) assert.ok(`${r.Год}-${String(r['Порядковый номер Месяца']).padStart(2, '0')}` <= ym);
  for (const r of t.oz_ads_campaign) assert.ok(r.ym <= ym);
  for (const r of [...t.sales_daily, ...t.mp_daily]) assert.ok(r.Дата < TODAY);
});

test('profitability files close two months back; the rest is estimated', () => {
  assert.equal(summary.profitLast, '2026-09');
  assert.deepEqual(summary.estMonths, ['2026-10', '2026-11']);
  for (const f of profit.files) assert.ok(f.last_month, `file ${f.year} has no closed month`);
});

test('the estimate is checked on closed months and stays close to the files', () => {
  const line = log.find((l) => l.includes('проверка оценки') && l.includes('ALL'));
  const pp = Number(line.match(/на ([\d.]+) п\.п\./)[1]);
  assert.ok(pp < 3, line);
});

test('every page gets data', () => {
  for (const name of ['meta', 'profit', 'sales', 'ads', 'stock', 'plan', 'codes', 'list101']) assert.ok(files[name], name);
  assert.ok(files.ads.camps.some((c) => c.mp === 'WB') && files.ads.camps.some((c) => c.mp === 'OZON'));
  const performers = new Set(files.ads.camps.filter((c) => c.mp === 'WB').map((c) => c.who));
  assert.deepEqual([...performers].sort(), ['Ирина', 'Павел', 'агентство']);
  assert.ok(files.stock.items.length > 100);
});

test('only own product codes (OWN_CODE_PREFIXES, default NR-) reach the brands page', () => {
  assert.ok(files.profit.sku.length > 0);
  // sku rows reference the codes table by index (third column)
  for (const row of files.profit.sku) assert.match(files.codes.codes[row[2]], /^NR-/);
});
