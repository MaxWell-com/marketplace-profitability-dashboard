// Runs the queries in src/etl/queries/*.dax (OLAP cube) and *.sql (DWH) into arrays of rows.
// Column names are shortened, as in the former CSV export: 'Спр - Календарь'[Год] -> «Год», [rev] -> «rev».
// Dates are YYYY-MM-DD strings.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dax, shortName } from '../olapClient.js';
import { query } from '../dwhClient.js';

const QDIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'queries');
const read = (file) => fs.readFileSync(path.join(QDIR, file), 'utf8');
const normDate = (v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? v.slice(0, 10) : v);

export const CUBE = ['freshness', 'nomen', 'bridge', 'sales_month', 'sales_daily', 'mp_daily', 'mp_articles', 'mp_code',
  'ads_wb', 'plan_op', 'our_stock', 'wb_card_month'];
export const DWH = ['dwh_freshness', 'wb_stock_daily', 'oz_stock_daily', 'wb_orders_daily', 'wb_search_month', 'wb_funnel_month',
  'wb_adverts', 'wb_ads_nm_month', 'oz_ads_campaign'];

async function cube(name) {
  const rows = await dax(read(name + '.dax'));
  return rows.map((r) => {
    const o = {};
    for (const [k, v] of Object.entries(r)) o[shortName(k)] = normDate(v);
    return o;
  });
}

/** All tables: { query name: rows }. Cube queries run at most three in parallel (the olapClient limit). */
export async function extractAll(log) {
  const t = {};
  const timed = async (name, fn) => {
    const t0 = Date.now();
    t[name] = await fn();
    log(`  ${name.padEnd(18)} строк ${String(t[name].length).padStart(7)}  ${((Date.now() - t0) / 1000).toFixed(1)} с`);
  };
  await Promise.all([
    Promise.all(CUBE.map((n) => timed(n, () => cube(n)))),
    (async () => { for (const n of DWH) await timed(n, () => query(read(n + '.sql'))); })(),
  ]);
  return t;
}
