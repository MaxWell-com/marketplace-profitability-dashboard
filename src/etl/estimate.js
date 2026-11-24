// Profitability estimate for months not yet present in the profitability files (like the "flash" view
// of the previous report).
//
// As soon as a month appears in the finance department's file, no estimate is built for it: the report
// shows the file's figures.
//
// Where each estimated line comes from:
//   - revenue and units - 1C sales from the cube (from 2026 they match the file exactly, same clients;
//     before 2026 1C booked marketplace revenue net of commission, so earlier years do not match);
//   - cost of goods - cube (revenue - gross profit) x a per-channel correction: in the closed months of the
//     year the file's COGS is a stable fraction of the cube's. 1C rows without COGS (a preliminary
//     commission-agent report posted as a single line) use the channel's COGS-to-revenue ratio;
//   - OZON and WB: commission, acquiring, logistics, storage, fines, other - marketplace charges from the cube,
//     net of VAT (/1.22; acquiring is VAT-exempt), allocated to products pro rata to revenue;
//     if 1C revenue is below the marketplace-report revenue net of VAT (1C lags in the current month),
//     the charges are scaled down by the same ratio;
//   - all other lines - the year's average ratio to revenue: line total / client revenue over the year's
//     months already in the file (no months of this year yet - previous year). A client without history
//     uses the channel ratio.
import { MEASURES, channel, addLevels, sumMeasures } from './cascade.js';

const VAT = 1.22;
// cube charge kind -> cascade line
const MP_KIND = {
  'Комиссия маркетплейса': 'comm', 'Эквайринг': 'acq', 'Логистика': 'logi', 'Выдача': 'logi',
  'Размещение и хранение': 'stor', 'Обработка товара': 'stor',
  'Штрафы': 'fines', 'Удержания': 'fines', 'Компенсации': 'fines', 'Корректировка': 'fines',
};
const MP_ARTICLE = { 'Возвраты и утилизация': 'mpother', 'Дополнительные услуги и сервисы': 'mpother' };
const MP_LINES = ['comm', 'acq', 'logi', 'stor', 'fines', 'mpother'];
const NO_VAT = new Set(['acq']);
const RATE_LINES = MEASURES.filter((m) => !['rev', 'qty', 'cogs'].includes(m));

const num = (v) => (v == null || v === '' || !isFinite(Number(v)) ? 0 : Number(v));
const ymOf = (y, m) => `${Math.trunc(y)}-${String(Math.trunc(m)).padStart(2, '0')}`;

/** 1C sales by code from the cube: month, channel, COGS = revenue - gross profit. */
export function loadSales(t) {
  return t.sales_month.map((r) => {
    const rev = num(r.rev), gp = num(r.gp);
    return { ym: ymOf(r['Год'], r['Порядковый номер Месяца']), channel: channel(r['Партнер']), division: r['Подразделение'],
      client: r['Партнер'], code: r['Код'] ?? '', rev, qty: num(r.qty), cogs: rev - gp };
  });
}

/** Marketplace charges by month and channel as cascade lines net of VAT; mprev = marketplace revenue net of VAT. */
export function loadMp(t) {
  const acc = new Map();
  for (const r of t.mp_articles) {
    if (r['Маркетплейс'] == null) continue;
    const ch = { OZON: 'OZON', Wildberries: 'WB' }[r['Маркетплейс']];
    if (!ch) continue;
    let line = MP_KIND[r['Вид начислений']];
    if (MP_ARTICLE[r['Статья расходов']]) line = MP_ARTICLE[r['Статья расходов']];
    if (r['Вид начислений'] === 'Выручка') line = 'mprev';
    if (!line) continue;
    const key = ymOf(r['Год'], r['Порядковый номер Месяца']) + '|' + ch;
    const o = acc.get(key) || Object.fromEntries([...MP_LINES, 'mprev'].map((l) => [l, 0]));
    o[line] += num(r.amount);
    acc.set(key, o);
  }
  for (const o of acc.values()) {
    for (const l of MP_LINES) o[l] = -o[l] / (NO_VAT.has(l) ? 1 : VAT);
    o.mprev = o.mprev / VAT;
  }
  return acc;
}

function sumBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    const o = m.get(k) || Object.fromEntries(MEASURES.map((x) => [x, 0]));
    for (const x of MEASURES) o[x] += r[x] || 0;
    m.set(k, o);
  }
  return m;
}
const ratios = (m) => {
  const out = new Map();
  for (const [k, o] of m) out.set(k, Object.fromEntries(RATE_LINES.map((l) => [l, o.rev > 0 ? o[l] / o.rev : NaN])));
  return out;
};

/** Ratios to revenue by client and by channel, plus the per-channel COGS correction. */
function rates(base, smBase) {
  const byCl = sumBy(base, 'client'), byCh = sumBy(base, 'channel');
  const cubeCogs = new Map();
  for (const r of smBase) if (r.cogs > 0) cubeCogs.set(r.channel, (cubeCogs.get(r.channel) || 0) + r.cogs);
  const k = new Map(), cogsPct = new Map();
  for (const [ch, o] of byCh) {
    const cc = cubeCogs.get(ch);
    k.set(ch, cc ? o.cogs / cc : 1.0);
    cogsPct.set(ch, o.rev > 0 ? o.cogs / o.rev : NaN);
  }
  return { cl: ratios(byCl), ch: ratios(byCh), k, cogsPct };
}

/** Estimate rows for one month, in the file-row shape (without name/fund). */
export function month(m, sm, mp, base, smBase) {
  const { cl, ch, k, cogsPct } = rates(base, smBase);
  const out = [];
  for (const s of sm) {
    if (s.ym !== m || (s.rev === 0 && s.qty === 0)) continue;
    const kk = k.get(s.channel) ?? 1.0, cp = cogsPct.get(s.channel);
    const o = { ym: m, division: s.division, client: s.client, code: s.code ?? '', channel: s.channel, rev: s.rev, qty: s.qty };
    o.cogs = s.cogs > 0 ? s.cogs * kk : (s.rev > 0 ? s.rev * (isFinite(cp) ? cp : 0) : 0);
    const rc = cl.get(s.client), rch = ch.get(s.channel);
    for (const line of RATE_LINES) {
      let r = rc ? rc[line] : NaN;
      if (!isFinite(r)) r = rch ? rch[line] : NaN;
      o[line] = (isFinite(r) ? r : 0) * s.rev;
    }
    out.push(o);
  }
  // marketplace charges from the cube instead of ratios
  for (const chn of ['OZON', 'WB']) {
    const rows = out.filter((o) => o.channel === chn);
    const tot = rows.reduce((a, o) => a + o.rev, 0);
    const v = mp.get(m + '|' + chn);
    if (!rows.length || tot <= 0 || !v) continue;
    // 1C may lag behind the marketplace reports (preliminary commission-agent report in the current month):
    // then charges are taken in the same proportion as 1C revenue to marketplace revenue net of VAT
    const scale = v.mprev > 0 ? Math.min(1.0, tot / v.mprev) : 1.0;
    for (const o of rows) {
      const share = (o.rev / tot) * scale;
      for (const line of MP_LINES) o[line] = share * v[line];
    }
  }
  return out;
}

const uniqSorted = (arr) => [...new Set(arr)].sort();

/** rows = finance file rows. Returns estimate rows, estimated months and the ratio base period per month. */
export function build(rows, sm, mp, todayYm) {
  const filled = rows.filter((r) => r.rev !== 0).map((r) => r.ym);
  const last = filled.reduce((a, b) => (b > a ? b : a), '');
  const months = uniqSorted(sm.map((s) => s.ym)).filter((m) => last < m && m <= todayYm);
  const allYm = uniqSorted(rows.map((r) => r.ym));
  const est = [], basis = {};
  for (const m of months) {
    const y = m.slice(0, 4);
    let bm = allYm.filter((x) => x.slice(0, 4) === y && x <= last);
    if (!bm.length) bm = allYm.filter((x) => x.slice(0, 4) === String(Number(y) - 1));
    const set = new Set(bm);
    est.push(...month(m, sm, mp, rows.filter((r) => set.has(r.ym)), sm.filter((s) => set.has(s.ym))));
    basis[m] = [bm[0], bm[bm.length - 1]];
  }
  return { est, months, basis };
}

/** Backtest: estimate each closed month of the year from the ratios of its other months, against the finance file. */
export function backtest(rows, sm, mp, year = '2026') {
  const ms = uniqSorted(rows.filter((r) => r.rev !== 0 && r.ym.slice(0, 4) === year).map((r) => r.ym));
  const res = [];
  for (const m of ms) {
    const set = new Set(ms.filter((x) => x !== m));
    const e = month(m, sm, mp, rows.filter((r) => set.has(r.ym)), sm.filter((s) => set.has(s.ym)));
    const f = rows.filter((r) => r.ym === m);
    for (const chn of ['ALL', 'OZON', 'WB', 'OTHER']) {
      const de = addLevels(sumMeasures(chn === 'ALL' ? e : e.filter((o) => o.channel === chn)));
      const df = addLevels(sumMeasures(chn === 'ALL' ? f : f.filter((o) => o.channel === chn)));
      res.push({ ym: m, ch: chn, rev_file: df.rev, rev_est: de.rev, vp3_file: df.vp3, vp4_file: df.vp4, vp3_est: de.vp3, vp4_est: de.vp4 });
    }
  }
  return res;
}
