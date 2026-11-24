// Dashboard data build: cube and DWH tables + finance department files -> objects meta, profit, sales, ads,
// stock, list101, plan, codes (served as /data/<name>.json in the shape public/app.js expects).
//
// Source rules of the project:
//   - profitability and gross-profit levels come only from the yearly profitability files; months after
//     the last file month are estimated (estimate.js);
//   - sales, marketplace charges, advertising, plan - the OLAP cube;
//   - marketplace stock, search positions, WB funnel and Ozon ads - DWH stg (the cube does not have them);
//   - product attributes (trade mark, motivation category) - finance reference file, else the cube,
//     else the fund type from the profitability file.
import { LINES, OUTSIDE, LEVELS, MEASURES, channel, addLevels, zeroMeasures } from './cascade.js';
import * as estimate from './estimate.js';

// Own product codes (the brands page lists only these; other codes still count in totals).
// Comma-separated prefixes from OWN_CODE_PREFIXES; the demo catalogue uses "NR-".
const OWN_CODE = new RegExp(`^(${(process.env.OWN_CODE_PREFIXES || 'NR-').split(',').map((p) => p.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).filter(Boolean).join('|')})`);

const NOBRAND = '(без марки)';
const BAD = new Set(['', '0', 'Неизвестно', 'nan']);
const ATTR_COLS = ['tm', 'motiv', 'mgroup', 'bdir'];
const SKU_LV = ['vp1', 'vp2', 'vp31', 'vp32', 'vp3', 'vp4'];

const ymOf = (y, m) => `${Math.trunc(y)}-${String(Math.trunc(m)).padStart(2, '0')}`;
const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? 0 : Number(v));
const isNum = (v) => v != null && v !== '' && isFinite(Number(v));
// Round half to even, like Python's round(): exactly x.5 -> nearest even integer.
// Keeps roubles identical to the previous Python build, down to the unit.
const roundEven = (n) => (n - Math.floor(n) === 0.5 ? 2 * Math.round(n / 2) : Math.round(n));
const rnd = (v) => roundEven(num(v));
const round = (v, d) => { const k = 10 ** d; return roundEven(v * k) / k; };
const str = (v) => (v == null ? '' : String(v).trim());
const clean = (v) => { if (v == null) return null; const s = String(v).trim(); return BAD.has(s) ? null : s; };
const fmt1 = (v) => v.toFixed(1);
const pct1 = (v) => `${(v * 100).toFixed(1)}%`;
const dayShift = (d, days) => new Date(Date.parse(d + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const maxOf = (arr) => arr.reduce((a, b) => (b > a ? b : a), arr[0]);

/** Value -> index dictionary, so JSON rows can be compact arrays. */
class Index {
  constructor() { this.items = []; this.pos = new Map(); }
  get(v) {
    const key = typeof v === 'object' && v !== null ? JSON.stringify(v) : v;
    let i = this.pos.get(key);
    if (i === undefined) { i = this.items.length; this.pos.set(key, i); this.items.push(v); }
    return i;
  }
}

/** Sums fields by a grouping key (groups keep first-appearance order). */
function groupSum(rows, keyFn, fields) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (k === null) continue;
    let o = m.get(k);
    if (!o) { o = { key: k, ...Object.fromEntries(fields.map((f) => [f, 0])) }; m.set(k, o); }
    for (const f of fields) o[f] += num(r[f]);
  }
  return m;
}
const sortedEntries = (m) => [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

/** Moscow local time as YYYY-MM-DDTHH:MM (the container runs in UTC). */
const mskIso = (ms) => new Date(ms).toLocaleString('sv-SE', { timeZone: 'Europe/Moscow' }).slice(0, 16).replace(' ', 'T');

export function build({ t, profit, refs, list101, log }) {
  // ---------------------------------------------------------------- reference data
  const nomen = new Map();
  for (const r of t.nomen) { const c = str(r.code); if (c && !nomen.has(c)) nomen.set(c, r); }
  const motiv = refs;
  const CODES = new Index();
  const CODE_ATTR = new Map();
  const known = (c) => c && !BAD.has(c) && (nomen.has(c) || motiv.has(c));

  function codeInfo(code, name = null, fund = null) {
    if (CODE_ATTR.has(code)) return CODE_ATTR.get(code);
    const n = nomen.get(code), m = motiv.get(code);
    const a = {
      name: (n && clean(n.name)) || clean(name) || code,
      tm: (m && clean(m.tm)) || (n && clean(n.brand)) || clean(fund) || NOBRAND,
      bdir: (n && clean(n.bdir)) || '',
      tgroup: (n && clean(n.tgroup)) || '',
      motiv: (m && clean(m.motiv)) || '',
      mgroup: (m && clean(m.mgroup)) || '',
      segment: (m && clean(m.segment)) || (n && clean(n.segment)) || '',
      // The campaign table's brand is the cube's product "Бренд" by 1C code (business decision: always from the cube)
      mark: (n && clean(n.brand)) || '',
    };
    CODE_ATTR.set(code, a);
    return a;
  }
  const brandOf = (code, name, fund) => (known(code) ? codeInfo(code, name, fund).tm : clean(fund) || NOBRAND);
  // product attributes for dashboard slicers: trade mark, motivation category and group, business line
  const attrOf = (code, name, fund) => {
    if (known(code)) { const a = codeInfo(code, name, fund); return [a.tm, a.motiv, a.mgroup, a.bdir]; }
    return [clean(fund) || NOBRAND, '', '', ''];
  };
  const CLIENT_DEPT = new Map();
  function modeDept(rows, keyF, valF, only) {
    const cnt = new Map();
    for (const r of rows) {
      const k = keyF(r), v = valF(r);
      if (k == null || v == null) continue;
      const c = cnt.get(k) || new Map(); c.set(v, (c.get(v) || 0) + 1); cnt.set(k, c);
    }
    for (const [k, c] of cnt) {
      if (only && CLIENT_DEPT.has(k)) continue;
      let best = null, bn = -1;
      for (const [v, n] of c) if (n > bn) { best = v; bn = n; }
      CLIENT_DEPT.set(k, best);
    }
  }
  const files = {};

  // ---------------------------------------------------------------- 1. profitability (Excel)
  log('Доходность (Excel)');
  const fileRows = profit.rows;
  const lastByYear = {};
  for (const r of fileRows) if (r.rev !== 0) { const y = r.ym.slice(0, 4); if (!lastByYear[y] || r.ym > lastByYear[y]) lastByYear[y] = r.ym; }
  const fr = t.freshness[0] || {};
  const sm = estimate.loadSales(t), mp = estimate.loadMp(t);
  // months after the finance file: estimate from 1C sales, marketplace charges and the year's average ratios
  const est = estimate.build(fileRows, sm, mp, String(fr.today || '').slice(0, 7));
  for (const m of est.months) {
    const rev = est.est.filter((r) => r.ym === m).reduce((s, r) => s + r.rev, 0);
    log(`  оценка ${m}: выручка ${fmt1(rev / 1e6)} млн, проценты по ${est.basis[m][0]}..${est.basis[m][1]}`);
  }
  const bt = estimate.backtest(fileRows, sm, mp);
  for (const chn of ['ALL', 'OTHER', 'OZON', 'WB']) {
    const g = bt.filter((r) => r.ch === chn);
    if (!g.length) continue;
    const err = g.reduce((s, r) => s + Math.abs(r.vp4_est / r.rev_est - r.vp4_file / r.rev_file), 0) / g.length * 100;
    log(`  проверка оценки на закрытых месяцах ${g[0].ym}..${g[g.length - 1].ym}, ${chn}: ВП4 отклоняется в среднем на ${fmt1(err)} п.п.`);
  }
  const rows = fileRows.concat(est.est.map((r) => ({ ...zeroMeasures(), ...r, name: '', fund: '' })));
  for (const r of rows) r.attr = attrOf(r.code, r.name, r.fund);
  modeDept(rows, (r) => r.client, (r) => r.division, false);
  const pMonths = new Index(), pClients = new Index(), pAttrs = new Index();
  const pg = groupSum(rows, (r) => JSON.stringify([r.ym, r.client, r.attr]), MEASURES);
  const pRows = sortedEntries(pg).map(([k, o]) => {
    const [ym, client, attr] = JSON.parse(k);
    return [pMonths.get(ym), pClients.get(client), pAttrs.get(attr), ...MEASURES.map((m) => rnd(o[m]))];
  });
  // SKU: month x channel x code -> revenue, units and gross-profit levels
  const names = new Map();
  for (const r of rows) if (r.name !== '' && !names.has(r.code)) names.set(r.code, r);
  const sg = groupSum(rows.filter((r) => OWN_CODE.test(r.code)), (r) => JSON.stringify([r.ym, r.channel, r.code]), MEASURES);
  const sku = sortedEntries(sg).map(([k, o]) => {
    const [ym, ch, code] = JSON.parse(k);
    const ci = CODES.get(code);
    const nm = names.get(code);
    codeInfo(code, nm ? nm.name : null, nm ? nm.fund : null);
    addLevels(o);
    return [pMonths.get(ym), ch, ci, ...['rev', 'qty', ...SKU_LV].map((f) => rnd(o[f]))];
  });
  const fileInfo = profit.files.map((f) => ({ year: f.year, name: f.name, mtime: mskIso(f.mtime), last_month: lastByYear[String(f.year)] || null }));
  files.profit = {
    measures: MEASURES, months: pMonths.items, attr_cols: ATTR_COLS, attrs: pAttrs.items,
    clients: pClients.items.map((c) => ({ name: c, channel: channel(c), dept: CLIENT_DEPT.get(c) || '' })),
    rows: pRows, sku_cols: ['rev', 'qty', ...SKU_LV], sku,
    files: fileInfo, est_months: est.months, est_basis: est.basis,
    est_check: bt.map((r) => [r.ym, r.ch, r.rev_file, r.vp4_file, r.rev_est, r.vp4_est]),
  };
  const totY = {};
  for (const r of rows) totY[r.ym.slice(0, 4)] = (totY[r.ym.slice(0, 4)] || 0) + r.rev;
  log(`  выручка E-comm по файлам и оценке, млн: ${Object.entries(totY).sort().map(([y, v]) => `${y}: ${fmt1(v / 1e6)}`).join(', ')}`);

  // ---------------------------------------------------------------- 2. sales (cube)
  log('Продажи (куб)');
  const smAll = t.sales_month.map((r) => ({ ...r, ym: ymOf(r['Год'], r['Порядковый номер Месяца']),
    channel: channel(r['Партнер']), code: r['Код'] == null ? null : String(r['Код']) }));
  for (const r of smAll) r.attr = attrOf(r.code);
  const smr = smAll.filter((r) => r['Партнер'] != null);
  modeDept(smr, (r) => r['Партнер'], (r) => r['Подразделение'], true);
  const sMonths = new Index(), partners = new Index(), brands = new Index(), sAttrs = new Index();
  const sRows = sortedEntries(groupSum(smr, (r) => JSON.stringify([r.ym, r['Партнер'], r.attr]), ['rev', 'qty', 'gp'])).map(([k, o]) => {
    const [ym, p, attr] = JSON.parse(k);
    return [sMonths.get(ym), partners.get(p), sAttrs.get(attr), rnd(o.rev), rnd(o.qty), rnd(o.gp)];
  });
  const sSku = sortedEntries(groupSum(smAll.filter((r) => r.code != null), (r) => JSON.stringify([r.ym, r.channel, r.code]), ['rev', 'qty', 'gp'])).map(([k, o]) => {
    const [ym, ch, code] = JSON.parse(k);
    codeInfo(code);
    return [sMonths.get(ym), ch, CODES.get(code), rnd(o.rev), rnd(o.qty), rnd(o.gp)];
  });
  // daily: 1C sales by channel and marketplace reports
  const d1 = new Map(), md = new Map();
  for (const r of t.sales_daily) { const k = r['Дата'] + '|' + channel(r['Партнер']); d1.set(k, (d1.get(k) || 0) + num(r.rev)); }
  for (const r of t.mp_daily) { if (r['Маркетплейс'] == null) continue; const k = r['Дата'] + '|' + r['Маркетплейс']; md.set(k, (md.get(k) || 0) + num(r.rev)); }
  const days = [...new Set([...t.sales_daily.map((r) => r['Дата']), ...t.mp_daily.filter((r) => r['Маркетплейс'] != null).map((r) => r['Дата'])])].sort();
  const daily = {
    days,
    c1: Object.fromEntries(['OZON', 'WB', 'OTHER'].map((ch) => [ch, days.map((d) => rnd(d1.get(d + '|' + ch)))])),
    mp: Object.fromEntries(['OZON', 'Wildberries'].map((k) => [k, days.map((d) => rnd(md.get(d + '|' + k)))])),
  };
  // marketplace charges by article and seller account
  const art = t.mp_articles.filter((r) => r['Маркетплейс'] != null).map((r) => [
    ymOf(r['Год'], r['Порядковый номер Месяца']), r['Маркетплейс'], str(r['Личный кабинет маркетплейса']),
    isNum(r['Порядковый номер Статьи расходов']) ? Math.trunc(Number(r['Порядковый номер Статьи расходов'])) : 0,
    str(r['Статья расходов']) || '(без статьи)', str(r['Вид начислений']), rnd(r.amount), rnd(r.amount_mapped)]);
  // marketplace charges by code -> by brand
  const mc = t.mp_code.filter((r) => r['Маркетплейс'] != null).map((r) => ({ ...r, ym: ymOf(r['Год'], r['Порядковый номер Месяца']), brand: brandOf(str(r['Код'])) }));
  const mpb = sortedEntries(groupSum(mc, (r) => JSON.stringify([r.ym, r['Маркетплейс'], r.brand]), ['rev', 'qty', 'cost'])).map(([k, o]) => {
    const [ym, m, b] = JSON.parse(k);
    return [sMonths.get(ym), m, brands.get(b), rnd(o.rev), rnd(o.qty), rnd(o.cost)];
  });
  files.sales = {
    months: sMonths.items, brands: brands.items, attr_cols: ATTR_COLS, attrs: sAttrs.items,
    partners: partners.items.map((p) => ({ name: p, channel: channel(p), dept: CLIENT_DEPT.get(p) || '' })),
    rows: sRows, sku_cols: ['rev', 'qty', 'gp'], sku: sSku, daily,
    mp_articles_cols: ['ym', 'mp', 'cabinet', 'art_no', 'article', 'kind', 'amount', 'amount_mapped'], mp_articles: art,
    mp_brand_cols: ['rev', 'qty', 'cost'], mp_brand: mpb,
  };

  // ---------------------------------------------------------------- bridge: marketplace SKU -> 1C code
  const br = new Map();
  for (const r of t.bridge) {
    const m = { Wildberries: 'WB', OZON: 'OZON' }[r['Маркетплейс']];
    const code = r['Код'];
    if (code == null || code === '') continue;
    const k = `${m}|${str(r['SKU в системе маркетплейса'])}`;
    if (!br.has(k)) br.set(k, String(code));
  }
  const brGet = (mp_, sku_) => br.get(`${mp_}|${str(sku_)}`) ?? null;

  // ---------------------------------------------------------------- 3. advertising
  log('Реклама (куб; кампании Ozon - DWH)');
  const ACOLS = ['views', 'clicks', 'cart', 'cost', 'orders', 'orders_rub'];
  const performer = (name) => { const n = (name || '').trimEnd(); return n.endsWith('AGC') ? 'агентство' : n.endsWith('&') ? 'Ирина' : 'Павел'; };
  // product = 1C code straight from the cube (the ads fact is linked to the product dimension), no SKU -> code bridge needed
  const a = t.ads_wb.filter((r) => r['Маркетплейс'] != null).map((r) => {
    const mp_ = { Wildberries: 'WB', OZON: 'OZON' }[r['Маркетплейс']] ?? null;
    return { ...r, ym: ymOf(r['Год'], r['Порядковый номер Месяца']), mp: mp_, cid: str(r['ID рекламной кампании']), code: str(r['Код']) || null };
  });
  for (const mp_ of ['OZON', 'WB']) {
    const g = a.filter((r) => r.mp === mp_);
    if (!g.length) continue;
    const tot = g.reduce((s, r) => s + num(r.cost), 0), hit = g.filter((r) => r.code).reduce((s, r) => s + num(r.cost), 0);
    log(`  ${mp_}: доля затрат с найденным кодом ${pct1(hit / Math.max(tot, 1))}`);
  }
  for (const r of a) if (!r.code) r.code = '(не сопоставлено)';
  const aMonths = new Index();
  const aRows = sortedEntries(groupSum(a.filter((r) => r.mp), (r) => JSON.stringify([r.ym, r.mp, r.code]), ACOLS)).map(([k, o]) => {
    const [ym, mp_, code] = JSON.parse(k);
    if (code !== '(не сопоставлено)') codeInfo(code);
    return [aMonths.get(ym), mp_, CODES.get(code), ...ACOLS.map((c) => rnd(o[c]))];
  });
  const advName = new Map(t.wb_adverts.map((r) => [str(r.advert_id), r.name || '']));
  const wbc = sortedEntries(groupSum(a.filter((r) => r.mp === 'WB' && r.cid !== ''), (r) => JSON.stringify([r.ym, r.cid]), ACOLS));
  const oz = t.oz_ads_campaign.map((r) => ({ ...r, camp: str(r.camp) }));
  const cubeOz = new Map(), dwhOz = new Map();
  for (const r of a) if (r.mp === 'OZON') cubeOz.set(r.ym, (cubeOz.get(r.ym) || 0) + num(r.cost));
  for (const r of oz) dwhOz.set(r.ym, (dwhOz.get(r.ym) || 0) + num(r.cost));
  for (const m of [...cubeOz.keys()].sort()) log(`  Ozon реклама ${m}: куб ${(cubeOz.get(m) / 1e6).toFixed(2)} млн, DWH кампании ${((dwhOz.get(m) || 0) / 1e6).toFixed(2)} млн`);
  // a campaign's advertised product: the 1C code with the highest spend (WB over the whole period, OZON only
  // for the months the cube has Ozon ads by product)
  const cc = [...groupSum(a.filter((r) => r.code !== '(не сопоставлено)' && r.mp && r.cid !== ''), (r) => JSON.stringify([r.mp, r.cid, r.code]), ['cost', 'orders_rub']).values()]
    .filter((o) => o.cost > 0 || o.orders_rub > 0)
    .sort((x, y) => y.cost - x.cost || y.orders_rub - x.orders_rub);
  const byCamp = new Map();
  for (const o of cc) { const [mp_, cid, code] = JSON.parse(o.key); const k = mp_ + '|' + cid; const l = byCamp.get(k) || []; l.push({ code, cost: o.cost }); byCamp.set(k, l); }
  const campCodes = new Map();
  for (const [k, l] of byCamp) {
    const paid = l.filter((x) => x.cost > 0);
    const lst = (paid.length ? paid : l.slice(0, 1)).map((x) => x.code);
    codeInfo(lst[0]);
    campCodes.set(k, [CODES.get(lst[0]), lst.length - 1]);
  }
  const withCode = (d) => { const c = campCodes.get(d.mp + '|' + d.id); if (c) { d.code = c[0]; d.more = c[1]; } return d; };
  const camps = new Index(), cinfo = [], crow = [];
  for (const [k, o] of wbc) {
    const [ym, cid] = JSON.parse(k);
    const ki = camps.get('WB|' + cid);
    if (ki === cinfo.length) { const nm = advName.get(cid) || ''; cinfo.push(withCode({ mp: 'WB', id: cid, name: nm, who: performer(nm) })); }
    crow.push([aMonths.get(ym), ki, ...ACOLS.map((c) => rnd(o[c]))]);
  }
  for (const r of oz) {
    const ki = camps.get('OZON|' + r.camp);
    if (ki === cinfo.length) cinfo.push(withCode({ mp: 'OZON', id: r.camp, name: r.title || '', who: '' }));
    crow.push([aMonths.get(r.ym), ki, ...ACOLS.map((c) => rnd(r[c]))]);
  }
  for (const mp_ of ['WB', 'OZON']) {
    const cs = cinfo.filter((c) => c.mp === mp_);
    log(`  ${mp_}: кампаний ${cs.length}, с товаром 1С ${cs.filter((c) => 'code' in c).length}`);
  }
  files.ads = { months: aMonths.items, cols: ACOLS, rows: aRows, camps: cinfo, camp_rows: crow,
    note: 'Ozon по товарам есть в кубе только с 07.2026; итоги и кампании Ozon за весь период - DWH.' };

  // ---------------------------------------------------------------- 4. marketplace availability
  log('Наличие на МП (DWH)');
  // a day with zero stock across the whole marketplace is a load failure, not an actual stock-out
  const dropZeroDays = (df) => {
    const tot = new Map();
    for (const r of df) tot.set(r.d, (tot.get(r.d) || 0) + num(r.stock));
    return df.filter((r) => tot.get(r.d) > 0);
  };
  const wb = dropZeroDays(t.wb_stock_daily.map((r) => ({ d: r.d, nm: str(r.nm_id), stock: num(r.stock), code: brGet('WB', r.nm_id) })));
  const ozs = dropZeroDays(t.oz_stock_daily.map((r) => ({ d: r.d, stock: num(r.stock), ads: num(r.ads), code: brGet('OZON', r.sku) })));
  for (const [nm, df] of [['WB', wb], ['OZON', ozs]]) {
    const dmax = maxOf(df.map((r) => r.d));
    const last = df.filter((r) => r.d === dmax);
    const tot = last.reduce((s, r) => s + r.stock, 0), withCode = last.filter((r) => r.code).reduce((s, r) => s + r.stock, 0);
    log(`  ${nm}: последний день ${dmax}, остаток ${Math.round(tot).toLocaleString('en-US')} шт, с кодом ${pct1(withCode / Math.max(tot, 1))}`);
  }
  const wo = t.wb_orders_daily.map((r) => ({ d: r.d, orders: num(r.orders), code: brGet('WB', r.nm_id) }));
  const stock = { series: {}, items: [], monthly: [], search: [], funnel: [] };
  for (const [mp_, df] of [['WB', wb], ['OZON', ozs]]) {
    const s = new Map();
    for (const r of df) s.set(r.d, (s.get(r.d) || 0) + r.stock);
    const ds = [...s.keys()].sort();
    stock.series[mp_] = { days: ds, stock: ds.map((d) => rnd(s.get(d))) };
  }
  // current state per code: stock on the last day, sales per day, days of cover, share of in-stock days over 30 days
  const byCodeDay = (df, fields) => {
    const m = new Map();
    for (const r of df) {
      if (!r.code) continue;
      const k = r.code + '|' + r.d;
      const o = m.get(k) || { code: r.code, d: r.d, ...Object.fromEntries(fields.map((f) => [f, 0])) };
      for (const f of fields) o[f] += r[f];
      m.set(k, o);
    }
    const byCode = new Map();
    for (const o of m.values()) { const l = byCode.get(o.code) || []; l.push(o); byCode.set(o.code, l); }
    return new Map([...byCode.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)));
  };
  const wEnd = maxOf(wb.map((r) => r.d)), woEnd = maxOf(wo.map((r) => r.d));
  const wsales = new Map();
  for (const r of wo) if (r.code && r.d > dayShift(woEnd, -28)) wsales.set(r.code, (wsales.get(r.code) || 0) + r.orders);
  for (const [code, g] of byCodeDay(wb.filter((r) => r.d > dayShift(wEnd, -30)), ['stock'])) {
    const dmax = maxOf(g.map((o) => o.d));
    const now = g.filter((o) => o.d === dmax).reduce((s, o) => s + o.stock, 0);
    const avg = (wsales.get(code) || 0) / 28;
    stock.items.push(['WB', CODES.get(code), Math.trunc(now), round(avg, 2), avg > 0 ? round(now / avg, 1) : null, round(g.filter((o) => o.stock > 0).length / 30, 3)]);
    codeInfo(code);
  }
  const oEnd = maxOf(ozs.map((r) => r.d));
  for (const [code, g] of byCodeDay(ozs.filter((r) => r.d > dayShift(oEnd, -30)), ['stock', 'ads'])) {
    const dmax = maxOf(g.map((o) => o.d));
    const last = g.filter((o) => o.d === dmax);
    const now = last.reduce((s, o) => s + o.stock, 0), avg = last.reduce((s, o) => s + o.ads, 0);
    stock.items.push(['OZON', CODES.get(code), Math.trunc(now), round(avg, 2), avg > 0 ? round(now / avg, 1) : null, round(g.filter((o) => o.stock > 0).length / 30, 3)]);
    codeInfo(code);
  }
  // our finished-goods stock (cube): sum over the selected own warehouses, latest snapshot
  const our = new Map(t.our_stock.map((r) => [str(r['Код']), num(r.stock)]));
  for (const it of stock.items) it.push(rnd(our.get(CODES.items[it[1]]) || 0));
  // monthly: share of in-stock days and average stock
  for (const [mp_, df] of [['WB', wb], ['OZON', ozs]]) {
    const m = new Map();
    for (const [code, g] of byCodeDay(df, ['stock'])) {
      for (const o of g) {
        const k = o.d.slice(0, 7) + '|' + code;
        const x = m.get(k) || { ym: o.d.slice(0, 7), code, days: 0, instock: 0, sum: 0 };
        x.days++; if (o.stock > 0) x.instock++; x.sum += o.stock;
        m.set(k, x);
      }
    }
    for (const x of [...m.values()].sort((p, q) => (p.ym < q.ym ? -1 : p.ym > q.ym ? 1 : p.code < q.code ? -1 : 1))) {
      stock.monthly.push([x.ym, mp_, CODES.get(x.code), x.days, x.instock, round(x.sum / x.days, 1)]);
    }
  }
  // search position (average weighted by card opens) and the WB funnel
  const se = new Map();
  for (const r of t.wb_search_month) {
    const code = brGet('WB', r.nm_id);
    if (!code) continue;
    const k = r.ym + '|' + code;
    const o = se.get(k) || { ym: r.ym, code, pw: 0, w: 0, vis: 0, n: 0 };
    const w = Math.max(num(r.opens), 1);
    o.pw += num(r.pos) * w; o.w += w; o.vis += num(r.visibility); o.n++;
    se.set(k, o);
  }
  for (const o of [...se.values()].sort((p, q) => (p.ym < q.ym ? -1 : p.ym > q.ym ? 1 : p.code < q.code ? -1 : 1))) {
    stock.search.push([o.ym, CODES.get(o.code), round(o.pw / o.w, 1), round(o.vis / o.n, 1)]);
  }
  const FCOLS = ['opens', 'carts', 'orders', 'orders_rub', 'buyouts', 'buyouts_rub'];
  const fu = t.wb_funnel_month.map((r) => ({ ...r, code: brGet('WB', r.nm_id) })).filter((r) => r.code);
  stock.funnel = sortedEntries(groupSum(fu, (r) => JSON.stringify([r.ym, r.code]), FCOLS)).map(([k, o]) => {
    const [ym, code] = JSON.parse(k);
    return [ym, CODES.get(code), ...FCOLS.map((c) => rnd(o[c]))];
  });
  stock.funnel_cols = FCOLS;
  stock.items_cols = ['mp', 'code', 'stock', 'per_day', 'cover_days', 'instock_30d', 'our_stock'];
  stock.monthly_cols = ['ym', 'mp', 'code', 'days', 'instock_days', 'avg_stock'];
  stock.search_cols = ['ym', 'code', 'pos', 'visibility'];
  files.stock = stock;

  // ---------------------------------------------------------------- 4a. list 101
  // Actual = WB revenue from the sales report net of VAT (2025 /1.2, from 2026 /1.22, the rate went 20% -> 22%);
  // ad cost ratio = spend / ad-driven orders by nm_id from the DWH (the cube spreads ads over 1C products, while
  // list 101 tracks every individual card); average stock = daily average of the sum over WB warehouses;
  // position = average search position (available only for recent months).
  log('Список 101 (ПЭО; куб и DWH)');
  const ids = new Set(list101.filter((r) => r.nm_id !== '').map((r) => r.nm_id));
  const L = new Map();
  const cell = (ym, nm) => { const k = ym + '|' + nm; let o = L.get(k); if (!o) { o = { ym, nm }; L.set(k, o); } return o; };
  const add = (o, f, v) => { o[f] = (o[f] ?? 0) + v; };
  for (const r of t.wb_card_month) {
    const nm = str(r['SKU в системе маркетплейса']);
    if (!ids.has(nm)) continue;
    const o = cell(ymOf(r['Год'], r['Порядковый номер Месяца']), nm);
    add(o, 'rev', num(r.rev) / (Number(r['Год']) >= 2026 ? 1.22 : 1.2));
    add(o, 'qty', num(r.qty));
  }
  for (const r of t.wb_ads_nm_month) {
    const nm = str(r.nm_id);
    if (!ids.has(nm)) continue;
    const o = cell(r.ym, nm);
    add(o, 'cost', num(r.cost)); add(o, 'orders_rub', num(r.orders_rub));
  }
  const ws = new Map();
  for (const r of wb) if (ids.has(r.nm)) { const k = r.d + '|' + r.nm; ws.set(k, (ws.get(k) || 0) + r.stock); }
  const wsm = new Map();
  for (const [k, v] of ws) { const [d, nm] = k.split('|'); const kk = d.slice(0, 7) + '|' + nm; const x = wsm.get(kk) || { sum: 0, n: 0 }; x.sum += v; x.n++; wsm.set(kk, x); }
  for (const [k, x] of wsm) { const [ym, nm] = k.split('|'); const o = cell(ym, nm); o.avg_stock = x.sum / x.n; o.stock_days = x.n; }
  const pm = new Map();
  for (const r of t.wb_search_month) { const nm = str(r.nm_id); if (!ids.has(nm)) continue; const k = r.ym + '|' + nm; const x = pm.get(k) || { s: 0, n: 0 }; x.s += num(r.pos); x.n++; pm.set(k, x); }
  for (const [k, x] of pm) { const [ym, nm] = k.split('|'); cell(ym, nm).pos = x.s / x.n; }
  const nz = (v, d = 0) => (v == null || !isFinite(v) ? null : d ? round(v, d) : roundEven(v));
  const lRows = [...L.values()].filter((o) => o.ym >= '2025-01').sort((p, q) => (p.ym < q.ym ? -1 : p.ym > q.ym ? 1 : p.nm < q.nm ? -1 : 1))
    .map((o) => [o.ym, o.nm, nz(o.rev), nz(o.qty), nz(o.cost), nz(o.orders_rub), nz(o.avg_stock, 1), nz(o.stock_days), nz(o.pos, 2)]);
  const items = list101.map((r) => {
    const code = r.nm_id ? brGet('WB', r.nm_id) : null;
    if (code) codeInfo(code);
    return { pos: r.pos, nm: r.nm_id, code: code ? CODES.get(code) : null, art: r.art, brand: r.brand, name: r.name,
      status: r.status, old_nm: r.old_nm_id, old_art: r.old_art, old_name: r.old_name };
  });
  const lastL = lRows.length ? maxOf(lRows.map((r) => r[0])) : '';
  log(`  карточек в списке ${ids.size}, с кодом 1С ${items.filter((i) => i.nm && i.code != null).length}; с продажами в ${lastL}: ${new Set(lRows.filter((r) => r[0] === lastL && r[2] > 0).map((r) => r[1])).size}`);
  files.list101 = { items, cols: ['ym', 'nm', 'rev', 'qty', 'ad_cost', 'ad_orders_rub', 'avg_stock', 'stock_days', 'pos'], rows: lRows, targets: { pos: 30, turnover: 45 } };

  // ---------------------------------------------------------------- 5. plan
  log('План (куб «План Факт»)');
  const p = t.plan_op.map((r) => ({ ym: String(r['Месяц отчетного периода'] || '').slice(0, 7), article: str(r['Статья бюджетов']), dept: r['Подразделение'],
    a1: r['Аналитика 1'], a4: r['Аналитика 4'], plan: num(r.plan) }));
  const op = p.filter((r) => r.article.startsWith('План продаж по клиентам')).map((r) => [r.ym, r.dept, typeof r.a4 === 'string' ? r.a4 : '', typeof r.a1 === 'string' ? r.a1 : '', rnd(r.plan)]);
  const cat = p.filter((r) => r.article.startsWith('План продаж по подразделениям') && r.ym >= '2026-01' && r.a1 != null && r.dept != null);
  const catr = sortedEntries(groupSum(cat, (r) => JSON.stringify([r.ym, r.dept, r.a1]), ['plan'])).map(([k, o]) => [...JSON.parse(k), rnd(o.plan)]);
  // actuals by motivation category: 1C sales by code -> category from the finance reference file
  const sm26 = t.sales_month.map((r) => ({ ...r, ym: ymOf(r['Год'], r['Порядковый номер Месяца']) })).filter((r) => r.ym >= '2026-01');
  for (const r of sm26) r.motiv = r['Код'] != null ? codeInfo(String(r['Код'])).motiv : '';
  const revAll = sm26.reduce((s, r) => s + num(r.rev), 0);
  const planned = new Set(cat.map((r) => r.a1));
  log(`  факт 2026 с категорией мотивации: ${pct1(sm26.filter((r) => r.motiv !== '').reduce((s, r) => s + num(r.rev), 0) / revAll)} выручки; категория есть в плане: ${pct1(sm26.filter((r) => planned.has(r.motiv)).reduce((s, r) => s + num(r.rev), 0) / revAll)}`);
  const catf = sortedEntries(groupSum(sm26.filter((r) => r['Подразделение'] != null), (r) => JSON.stringify([r.ym, r['Подразделение'], r.motiv]), ['rev']))
    .map(([k, o]) => { const [ym, d, m] = JSON.parse(k); return [ym, d, m || '(без категории)', rnd(o.rev)]; });
  const grp = {};
  for (const a_ of CODE_ATTR.values()) if (a_.motiv && a_.mgroup && !(a_.motiv in grp)) grp[a_.motiv] = a_.mgroup;
  files.plan = { op_cols: ['ym', 'dept', 'client', 'manager', 'plan'], op, cat_cols: ['ym', 'dept', 'category', 'value'], cat_plan: catr, cat_fact: catf, cat_group: grp };

  // ---------------------------------------------------------------- code dictionary and meta
  const dw = Object.fromEntries(t.dwh_freshness.map((r) => [r.src, r]));
  const def = (c) => ({ name: c, tm: NOBRAND, bdir: '', tgroup: '', motiv: '', mgroup: '', segment: '', mark: '' });
  const attrs = CODES.items.map((c) => CODE_ATTR.get(c) || def(c));
  files.codes = { codes: CODES.items, cols: ['name', 'tm', 'bdir', 'tgroup', 'motiv', 'mgroup', 'segment', 'mark'],
    attrs: attrs.map((x) => [x.name, x.tm, x.bdir, x.tgroup, x.motiv, x.mgroup, x.segment, x.mark]) };
  files.meta = {
    built: mskIso(Date.now()),
    today: fr.today,
    our_stock_date: fr.stock_max,
    cascade: {
      lines: LINES.map(([id, label]) => ({ id, label })),
      outside: OUTSIDE.map(([id, label]) => ({ id, label })),
      levels: LEVELS.map(([id, label, items_]) => ({ id, label, items: items_ })),
      columns: Object.fromEntries([...LINES, ...OUTSIDE].map(([id, , cols]) => [id, cols])),
    },
    sources: [
      { id: 'excel', label: 'Файлы «Доходность» (ПЭО)', detail: fileInfo.map((f) => `${f.name} — по ${f.last_month}`).join('; ') },
      { id: 'cube_sales', label: 'Куб: продажи 1С', detail: `по ${fr.sales_max} включительно` },
      { id: 'cube_mp', label: 'Куб: начисления маркетплейсов', detail: `по ${fr.mp_max}` },
      { id: 'cube_ads', label: 'Куб: рекламные кампании (по товарам 1С)', detail: `по ${fr.ads_max}` },
      { id: 'dwh_stock', label: 'DWH: остатки WB / Ozon', detail: `WB по ${dw.wb_stock?.dmax}, Ozon по ${dw.oz_stock?.dmax}` },
      { id: 'cube_stock', label: 'Куб: наши остатки ГП (Склад № 1, 2а, 2б, 2в)', detail: `снимок на ${fr.stock_max}` },
      { id: 'dwh_search', label: 'DWH: позиции и воронка WB', detail: `позиции по ${dw.wb_search?.dmax}, воронка по ${dw.wb_funnel?.dmax}` },
      { id: 'dwh_ozads', label: 'DWH: реклама Ozon', detail: `по ${dw.oz_ads?.dmax}` },
      { id: 'dwh_wbads', label: 'DWH: реклама WB по карточкам (список 101)', detail: `по ${dw.wb_ads?.dmax}` },
      { id: 'list101', label: 'Список 101 (ПЭО)', detail: '«101 и ТМ отчеты квартал.xlsx», лист «101 new», правая часть («стало»)' },
      { id: 'plan', label: 'Куб: план (бюджет «План Факт»)', detail: 'опер-план по клиентам и менеджерам, план по категориям мотивации' },
    ],
    log: [],
  };
  return {
    files,
    summary: { today: fr.today, profitLast: Object.values(lastByYear).sort().pop() || null, estMonths: est.months,
      sales_max: fr.sales_max, mp_max: fr.mp_max, wb_stock: dw.wb_stock?.dmax, oz_stock: dw.oz_stock?.dmax },
  };
}
