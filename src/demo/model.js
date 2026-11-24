// Synthetic inputs for the demo data source: everything build() expects from the cube, the DWH and
// the finance department's files — generated from one simulated business, so the sources agree.
//
// The core is a monthly sales book: partner × SKU × month, for eight E-comm partners (Wildberries
// and Ozon, two smaller marketplaces, online retail chains and a professional web store). Everything
// else is derived from it:
//   1C sales        sales_month (rev without VAT, gross profit) and sales_daily (spread over days with
//                   a weekday profile and the 11.11 / Black Friday peaks);
//   marketplaces    mp_daily (marketplace-report revenue with VAT), mp_articles (charges by article
//                   and cabinet), mp_code;
//   profitability   the yearly «Доходность» files: the same rows with the gross-profit cascade
//                   ВП1–ВП4 (cost lines as shares of revenue, per channel), closed two months before
//                   "today" — the last months are estimated by the dashboard itself;
//   advertising     WB and Ozon campaigns (cube from 2026-07 for Ozon, as in production), campaign
//                   names whose suffix encodes the performer, ad spend by WB card;
//   marketplace     WB cards (nm_id) and Ozon SKUs bridged to 1C codes; daily stock with replenishment
//   stock           and stock-outs, WB orders, search positions and the sales funnel;
//   plans           sales plan by client (with managers) and by motivation category;
//   references      product dimension, finance reference (brand, motivation category) and list 101.
// Before 2026 WB/Ozon revenue in 1C is net of commission, as it was in production; VAT is 20% up to
// 2025 and 22% from 2026.
//
// Deterministic: every entity draws from its own seeded stream.
import { BRANDS, GIFT_SETS, SEASON } from './catalog.js';
import { rng, hash32 } from './random.js';

const DAY = 86_400_000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const ms = (d) => Date.parse(`${d}T00:00:00Z`);
const ymOf = (d) => d.slice(0, 7);
const ymAdd = (ym, k) => {
  const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + k;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
};
const monthsBetween = (a, b) => { const out = []; for (let ym = a; ym <= b; ym = ymAdd(ym, 1)) out.push(ym); return out; };
const daysBetween = (a, b) => { const out = []; for (let t = ms(a); t <= ms(b); t += DAY) out.push(iso(t)); return out; };
const daysInMonth = (ym) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const vat = (ym) => (ym >= '2026-01' ? 1.22 : 1.2);
const round2 = (v) => Math.round(v * 100) / 100;
const cubeMonth = (ym) => ({ Год: Number(ym.slice(0, 4)), 'Порядковый номер Месяца': Number(ym.slice(5, 7)) });

export const WB = 'РВБ (ВАЙЛДБЕРРИЗ ООО)';
export const OZON = 'Интернет Решения ООО';

// Monthly revenue without VAT in mid-2025; growth is annual.
const PARTNERS = [
  { name: WB, div: 'E-comm-Маркетплейсы', mp: 'WB', size: 82e6, growth: 0.28, listing: 0.75, mix: { retail: 1, kids: 1, derma: 0.8, prof: 0.3 } },
  { name: OZON, div: 'E-comm-Маркетплейсы', mp: 'OZON', size: 58e6, growth: 0.36, listing: 0.65, mix: { retail: 1, kids: 0.9, derma: 0.9, prof: 0.3 } },
  { name: 'Витрина 24 ООО', div: 'E-comm-Маркетплейсы', size: 5.5e6, growth: 0.1, listing: 0.25, mix: { retail: 1, kids: 0.6, derma: 0.4 } },
  { name: 'Пикап Маркет ООО', div: 'E-comm-Маркетплейсы', size: 3.2e6, growth: -0.12, listing: 0.18, mix: { retail: 1, kids: 0.5 } },
  { name: 'Гранит АО', div: 'E-comm-Ритейл', size: 8.5e6, growth: 0.16, listing: 0.3, mix: { retail: 1, kids: 0.8, derma: 0.3 } },
  { name: 'Перелесок ТД ООО', div: 'E-comm-Ритейл', size: 4.8e6, growth: 0.04, listing: 0.22, mix: { retail: 1, kids: 0.6 } },
  { name: 'Полка Онлайн ООО', div: 'E-comm-Ритейл', size: 2.2e6, growth: 0.22, listing: 0.15, mix: { retail: 1, derma: 0.6 } },
  { name: 'Профсалон Онлайн ООО', div: 'E-comm-Проф', size: 3.1e6, growth: 0.12, listing: 0.5, mix: { prof: 1 } },
];
const MANAGERS = { 'E-comm-Маркетплейсы': 'Корнилова Вероника Андреевна', 'E-comm-Ритейл': 'Захарова Ольга Николаевна', 'E-comm-Проф': 'Ветрова Кристина Алексеевна' };
const OZON_SECOND_MANAGER = 'Борисов Илья Андреевич'; // all people are fictional

const MOTIV = {
  'Стойкие крем-краски': 'Окрашивание волос', 'Краски для бровей и ресниц': 'Окрашивание волос',
  'Оттеночные средства': 'Окрашивание волос', Осветлители: 'Окрашивание волос',
  Шампуни: 'Уход за волосами', 'Несмываемый уход': 'Уход за волосами',
  'Профессиональные красители': 'Профессиональная косметика', 'Профессиональный уход': 'Профессиональная косметика',
  'Оксиды и осветление': 'Профессиональная косметика',
  'Гели для душа': 'Уход за лицом и телом', 'Уход за лицом': 'Уход за лицом и телом', 'Дезодоранты-антиперспиранты': 'Уход за лицом и телом',
  'Макияж глаз': 'Декоративная косметика', Парфюмерия: 'Декоративная косметика',
  Дермокосметика: 'Дерматокосметика', 'Интимная гигиена': 'Дерматокосметика', 'Маски для лица': 'Дерматокосметика',
  'Детские средства для купания': 'Детская косметика', 'Детский уход 0+': 'Детская косметика', 'Детская зубная паста': 'Детская косметика',
};
const MGROUP = {
  'Окрашивание волос': 'Волосы', 'Уход за волосами': 'Волосы', 'Профессиональная косметика': 'Проф',
  'Уход за лицом и телом': 'Лицо и тело', 'Декоративная косметика': 'Лицо и тело', 'Дерматокосметика': 'Лицо и тело',
  'Детская косметика': 'Дети', 'Подарочные наборы': 'Лицо и тело',
};
const BDIR = { retail: 'Ритейл', kids: 'Ритейл', derma: 'Аптечная косметика', prof: 'Профкосметика' };
const LICENSED = new Set(['МЕГАДРАКОНЫ', 'FRUIT DRAGONS']); // pay royalties

// --- Products ---------------------------------------------------------------------------------

function buildSkus() {
  const r = rng(hash32('ecomm-skus'));
  const skus = [];
  for (const b of BRANDS) {
    for (const line of b.lines) {
      const n = Math.min(line.n, line.types.length * line.vars.length);
      for (let i = 0; i < n; i++) {
        const [type, volume, priceFactor, tg] = line.types[i % line.types.length];
        const variant = line.vars[Math.floor(i / line.types.length) % line.vars.length];
        const group = tg || line.tg;
        skus.push({
          code: `NR-${10001 + skus.length}`,
          name: [type, b.tm, variant, volume].filter(Boolean).join(' '),
          brand: b.b, tm: b.tm, subbrand: line.sub, channel: b.channel, group, motiv: MOTIV[group] || 'Прочее',
          season: line.season || b.season, growth: b.growth, margin: b.margin,
          price: round2(b.price * priceFactor * r.lognorm(0.12)), pop: r.lognorm(0.9),
          stage: line.archive ? '99-Архив' : '03-Активные продажи',
          end: line.archive ? ymAdd('2025-01', r.int(0, 8)) : null,
          launch: b.launch && r.chance(b.novFrac) ? ymAdd(`${String(b.launch[0]).slice(0, 4)}-${String(b.launch[0]).slice(4)}`, r.int(0, 10)) : null,
        });
      }
    }
  }
  for (const [brand, name, priceFactor] of GIFT_SETS) {
    const b = BRANDS.find((x) => x.b === brand || x.tm === brand);
    skus.push({
      code: `NR-${10001 + skus.length}`, name, brand: b.b, tm: b.tm, subbrand: `${b.tm} Подарочные наборы`, channel: b.channel,
      group: 'Подарочные наборы', motiv: 'Подарочные наборы', season: 'gifts', growth: 0.05, margin: b.margin,
      price: round2(b.price * priceFactor), pop: 0.6 * r.lognorm(0.4), stage: '05-Сезонный ассортимент', end: null, launch: null,
    });
  }
  return skus;
}

// --- Generator --------------------------------------------------------------------------------

/** All inputs of build() for a demo "today" (YYYY-MM-DD, in 2026: the UI's year selectors are 2025–2026). */
export function buildInputs(today) {
  const todayYm = ymOf(today);
  const lastDay = iso(ms(today) - DAY);                 // 1C and marketplace reports run to yesterday
  const elapsed = Number(lastDay.slice(8, 10)) / daysInMonth(todayYm);
  const profitLast = ymAdd(todayYm, -2);               // the finance files lag two months behind
  const months = monthsBetween('2024-01', todayYm);
  const skus = buildSkus();
  const byCode = new Map(skus.map((s) => [s.code, s]));
  const t = {};

  // ---- monthly sales book: partner × SKU × month ----
  const book = [];  // { ym, p, s, rev, qty, gp }
  for (const p of PARTNERS) {
    const r = rng(hash32('listing', p.name));
    const listed = skus.filter((s) => p.mix[s.channel] && r.next() < Math.min(0.95, p.listing * (0.6 + Math.min(1, s.pop / 2))));
    const weight = (s) => s.pop * p.mix[s.channel];
    const total = listed.reduce((a, s) => a + weight(s), 0);
    for (const s of listed) {
      const rs = rng(hash32('book', p.name, s.code));
      const share = weight(s) / total;
      for (const ym of months) {
        const noise = rs.lognorm(0.3); const uMargin = rs.uni(-0.03, 0.03);
        if (s.launch && ym < s.launch) continue;
        if (s.end && ym > s.end) continue;
        const years = (Number(ym.slice(0, 4)) - 2025) + (Number(ym.slice(5, 7)) - 7) / 12;
        let rev = p.size * share * (SEASON[s.season] || SEASON.flat)[Number(ym.slice(5, 7)) - 1]
          * (1 + p.growth) ** years * (1 + s.growth) ** years * noise;
        if (p.mp && ym < '2026-01') rev *= 0.78;          // 1C revenue net of commission before 2026
        if (ym === todayYm) rev *= elapsed;
        if (rev < 3000) continue;
        const qty = Math.max(1, Math.round(rev / (s.price * 0.56)));
        rev = round2(rev);
        book.push({ ym, p, s, rev, qty, gp: round2(rev * (s.margin + uMargin)) });
      }
    }
  }

  t.sales_month = book.map((b) => ({
    ...cubeMonth(b.ym), Подразделение: b.p.div, Партнер: b.p.name, Код: b.s.code, rev: b.rev, qty: b.qty, gp: b.gp,
  }));

  // ---- daily: 1C by partner, marketplace reports by marketplace ----
  const partnerMonth = new Map(); // `${partner}|${ym}` → { rev, qty }
  for (const b of book) {
    const k = `${b.p.name}|${b.ym}`;
    const a = partnerMonth.get(k) || { rev: 0, qty: 0 };
    a.rev += b.rev; a.qty += b.qty; partnerMonth.set(k, a);
  }
  const dayWeight = (d) => {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    let w = [0.9, 1.08, 1.04, 1.02, 1.0, 0.98, 0.88][dow];
    const md = d.slice(5);
    if (md === '11-11') w *= 2.6;
    if (md >= '11-26' && md <= '11-30') w *= 1.7;
    if (md >= '12-20' && md <= '12-28') w *= 1.35;
    return w;
  };
  const days = daysBetween('2025-01-01', lastDay);
  const dayW = new Map(days.map((d) => [d, dayWeight(d)]));
  const monthW = new Map();
  for (const d of days) monthW.set(ymOf(d), (monthW.get(ymOf(d)) || 0) + dayW.get(d));
  t.sales_daily = [];
  t.mp_daily = [];
  const mpDailyByMonth = new Map(); // `${mp}|${ym}` → MP revenue with VAT
  for (const p of PARTNERS) {
    const r = rng(hash32('daily', p.name));
    for (const d of days) {
      const pm = partnerMonth.get(`${p.name}|${ymOf(d)}`);
      const noise = r.lognorm(0.12);
      if (!pm) continue;
      const k = (dayW.get(d) / monthW.get(ymOf(d))) * noise;
      t.sales_daily.push({ Дата: d, Подразделение: p.div, Партнер: p.name, rev: round2(pm.rev * k), qty: Math.round(pm.qty * k) });
      if (p.mp) {
        // Marketplace-report revenue: retail price with VAT, above 1C wholesale revenue.
        const mpRev = round2(pm.rev * k * vat(ymOf(d)) * (ymOf(d) < '2026-01' ? 1.18 / 0.78 : 1.18) * r.lognorm(0.05));
        const mp = p.mp === 'WB' ? 'Wildberries' : 'OZON';
        t.mp_daily.push({ Дата: d, Маркетплейс: mp, rev: mpRev });
        mpDailyByMonth.set(`${mp}|${ymOf(d)}`, (mpDailyByMonth.get(`${mp}|${ymOf(d)}`) || 0) + mpRev);
      }
    }
  }

  // ---- marketplace charges by article and cabinet ----
  const ARTICLES = [
    // [order, Статья расходов, Вид начислений, share of MP revenue (charges negative), WB/OZON tweak]
    [1, 'Выручка', 'Выручка', 1],
    [2, 'Комиссия', 'Комиссия маркетплейса', -0.205],
    [3, 'Эквайринг', 'Эквайринг', -0.015],
    [4, 'Логистика', 'Логистика', -0.068],
    [5, 'Логистика', 'Выдача', -0.011],
    [6, 'Хранение', 'Размещение и хранение', -0.021],
    [7, 'Хранение', 'Обработка товара', -0.006],
    [8, 'Штрафы и удержания', 'Штрафы', -0.0025],
    [9, 'Штрафы и удержания', 'Удержания', -0.003],
    [10, 'Штрафы и удержания', 'Компенсации', 0.0012],
    [11, 'Штрафы и удержания', 'Корректировка', -0.0006],
    [12, 'Возвраты и утилизация', 'Возвраты и утилизация', -0.004],
    [13, 'Дополнительные услуги и сервисы', 'Продвижение и сервисы', -0.007],
  ];
  const CABINETS = { Wildberries: [['NORD', 0.78], ['NORD Kids', 0.22]], OZON: [['NORD', 0.84], ['NORD Professional', 0.16]] };
  t.mp_articles = [];
  for (const mp of ['Wildberries', 'OZON']) {
    const r = rng(hash32('articles', mp));
    for (const ym of monthsBetween('2025-01', todayYm)) {
      const rev = mpDailyByMonth.get(`${mp}|${ym}`) || 0;
      for (const [cab, cabShare] of CABINETS[mp]) {
        for (const [order, article, kind, share] of ARTICLES) {
          const tweak = mp === 'OZON' && kind === 'Комиссия маркетплейса' ? 0.9 : 1;
          const amount = round2(rev * cabShare * share * tweak * (share === 1 ? 1 : r.lognorm(0.08)));
          if (!amount) continue;
          t.mp_articles.push({
            ...cubeMonth(ym), Маркетплейс: mp, 'Личный кабинет маркетплейса': cab, 'Порядковый номер Статьи расходов': order,
            'Статья расходов': article, 'Вид начислений': kind, amount, amount_mapped: round2(amount * r.uni(0.95, 0.995)),
          });
        }
      }
    }
  }

  // ---- marketplace SKU ids and the bridge to 1C codes ----
  const mpBook = (mp) => book.filter((b) => b.p.mp === mp);
  const nmOf = new Map(); const ozOf = new Map();
  for (const b of mpBook('WB')) if (!nmOf.has(b.s.code)) nmOf.set(b.s.code, String(100_000_000 + (hash32('nm', b.s.code) % 899_999_999)));
  for (const b of mpBook('OZON')) if (!ozOf.has(b.s.code)) ozOf.set(b.s.code, String(1_000_000_000 + (hash32('oz', b.s.code) % 899_999_999)));
  t.bridge = [
    ...[...nmOf].map(([code, nm]) => ({ Маркетплейс: 'Wildberries', 'SKU в системе маркетплейса': nm, Код: code })),
    ...[...ozOf].map(([code, sku]) => ({ Маркетплейс: 'OZON', 'SKU в системе маркетплейса': sku, Код: code })),
  ];
  // A few new WB cards without sales yet: they have stock, but no 1C code until the first sale.
  const orphanNm = ['198765432', '187654321', '176543219'];

  // Monthly marketplace units per code (for stock, orders and funnels).
  const mpMonth = (mp) => {
    const m = new Map();
    for (const b of mpBook(mp)) {
      const k = `${b.s.code}|${b.ym}`;
      m.set(k, (m.get(k) || 0) + b.qty);
    }
    return m;
  };
  const wbQty = mpMonth('WB'); const ozQty = mpMonth('OZON');
  const ratePerDay = (m, code, ym) => (m.get(`${code}|${ym}`) || 0) / (ym === todayYm ? Math.max(1, Number(lastDay.slice(8, 10))) : daysInMonth(ym));

  t.mp_code = [];
  for (const mp of ['WB', 'OZON']) {
    const agg = new Map();
    for (const b of mpBook(mp)) {
      if (b.ym < '2025-01') continue;
      const k = `${b.ym}|${b.s.code}`;
      const a = agg.get(k) || { ym: b.ym, code: b.s.code, rev: 0, qty: 0 };
      a.rev += b.rev * vat(b.ym) * 1.18; a.qty += b.qty; agg.set(k, a);
    }
    for (const a of agg.values()) {
      t.mp_code.push({ ...cubeMonth(a.ym), Маркетплейс: mp === 'WB' ? 'Wildberries' : 'OZON', Код: a.code, rev: round2(a.rev), qty: a.qty, cost: round2(-a.rev * 0.33) });
    }
  }

  // ---- marketplace stock (DWH) ----
  const stockSeries = (codes, from, ids, qtyMap, salt) => {
    const rows = [];
    for (const code of codes) {
      const id = ids.get(code);
      const r = rng(hash32(salt, id));
      const chronic = r.chance(0.08);
      let stock = null;
      let arrival = null; // [day, qty] of the shipment on its way to the marketplace warehouse
      for (const d of daysBetween(from, today)) {
        const rate = ratePerDay(qtyMap, code, ymOf(d));
        if (stock === null) stock = Math.round(rate * r.uni(20, 60));
        stock -= Math.min(stock, Math.round(rate * r.lognorm(0.3)));
        if (arrival && arrival[0] <= d) { stock += arrival[1]; arrival = null; }
        // Replenish below ten days of cover; "chronic" cards mostly miss the reorder.
        if (stock < rate * 10 && !arrival && !(chronic && r.chance(0.85))) {
          arrival = [iso(ms(d) + r.int(4, 9) * DAY), Math.round(rate * r.uni(25, 45))];
        }
        const pending = arrival ? arrival[1] : 0;
        rows.push({ d, id, stock, transit: pending, rate });
      }
    }
    return rows;
  };
  const wbStock = stockSeries([...nmOf.keys()], '2025-12-11', nmOf, wbQty, 'wb-stock');
  t.wb_stock_daily = wbStock.map((x) => ({ d: x.d, nm_id: x.id, vendor_code: `${x.id.slice(-5)}-NR`, stock: x.stock }));
  for (const nm of orphanNm) {
    for (const d of daysBetween(iso(ms(today) - 20 * DAY), today)) t.wb_stock_daily.push({ d, nm_id: nm, vendor_code: `${nm.slice(-5)}-NR`, stock: 240 });
  }
  const ozStock = stockSeries([...ozOf.keys()], '2026-02-08', ozOf, ozQty, 'oz-stock');
  t.oz_stock_daily = ozStock.map((x) => ({
    d: x.d, sku: x.id, offer_id: `NR-${x.id.slice(-5)}`, stock: x.stock, transit: x.transit,
    ads: round2(x.rate), idc: x.rate > 0 ? Math.round(x.stock / x.rate) : null,
  }));

  // WB orders for the last 60 days: follow sales, collapse when out of stock.
  const wbStockOn = new Map(wbStock.map((x) => [`${x.id}|${x.d}`, x.stock]));
  t.wb_orders_daily = [];
  for (const [code, nm] of nmOf) {
    const r = rng(hash32('wb-orders', nm));
    for (const d of daysBetween(iso(ms(today) - 60 * DAY), lastDay)) {
      const rate = ratePerDay(wbQty, code, ymOf(d)) * ((wbStockOn.get(`${nm}|${d}`) ?? 1) > 0 ? 1 : 0.08);
      const orders = Math.round(rate * r.lognorm(0.35));
      if (orders) t.wb_orders_daily.push({ d, nm_id: nm, orders, orders_rub: round2(orders * byCode.get(code).price * 1.9) });
    }
  }

  // ---- WB cards: revenue, search, funnel ----
  t.wb_card_month = []; t.wb_search_month = []; t.wb_funnel_month = [];
  const prevYm = ymAdd(todayYm, -1);
  for (const [code, nm] of nmOf) {
    const s = byCode.get(code);
    const r = rng(hash32('wb-card', nm));
    const pos0 = Math.max(1, 24 / s.pop ** 0.6 * r.lognorm(0.45));
    for (const ym of monthsBetween('2025-01', todayYm)) {
      const qty = wbQty.get(`${code}|${ym}`) || 0;
      const noise = r.lognorm(0.1); const uPos = r.lognorm(0.2);
      if (!qty) continue;
      const rev = round2(qty * s.price * 1.9 * vat(ym) / 1.2 * noise);
      t.wb_card_month.push({ ...cubeMonth(ym), 'SKU в системе маркетплейса': nm, rev, qty });
      const opens = Math.round(qty * r.uni(9, 16)); const carts = Math.round(opens * r.uni(0.1, 0.18));
      const orders = Math.round(qty * r.uni(1.05, 1.2));
      t.wb_funnel_month.push({ ym, nm_id: nm, opens, carts, orders, orders_rub: round2(orders * s.price * 1.9), buyouts: qty, buyouts_rub: rev });
      if (ym >= '2026-03' && ym <= prevYm) {
        t.wb_search_month.push({ ym, nm_id: nm, pos: round2(pos0 * uPos), visibility: round2(Math.min(95, 60 / (pos0 * uPos) * 10)), opens: Math.round(opens * 0.6), orders: Math.round(orders * 0.5), days: daysInMonth(ym) });
      }
    }
  }

  // ---- advertising ----
  const wbCodes = [...nmOf.keys()].sort((a, b) => byCode.get(b).pop - byCode.get(a).pop);
  const ozCodes = [...ozOf.keys()].sort((a, b) => byCode.get(b).pop - byCode.get(a).pop);
  const SUFFIX = [' AGC', ' &', '', ' AGC', '', ' &', ''];
  t.ads_wb = []; t.wb_adverts = []; t.oz_ads_campaign = []; t.wb_ads_nm_month = [];
  const nmAds = new Map(); // `${ym}|${nm}` → { cost, orders_rub }
  const campaigns = (mp, codes, n) => {
    const r = rng(hash32('camps', mp));
    return codes.slice(0, n).map((code, i) => {
      const s = byCode.get(code);
      const start = ymAdd('2025-01', r.int(0, 18));
      return {
        id: String((mp === 'WB' ? 21_000_000 : 31_000_000) + hash32('camp', mp, code) % 999_999),
        code, second: r.chance(0.3) ? codes[r.int(0, Math.min(codes.length - 1, n * 2))] : null,
        name: `${s.tm} ${s.name.split(' ')[0]} — ${['поиск', 'каталог', 'автокампания', 'бренд'][i % 4]}${SUFFIX[i % SUFFIX.length]}`,
        start, budget: 90_000 * s.pop * r.lognorm(0.5), r,
        // Some campaigns were stopped after a few months; the rest run to the current month.
        end: (() => { const stop = r.chance(0.35) ? ymAdd(start, r.int(3, 9)) : todayYm; return stop < todayYm ? stop : todayYm; })(),
      };
    });
  };
  const adMetrics = (c, ym, mp) => {
    const cost = round2(c.budget * c.r.lognorm(0.25) * (ym === todayYm ? elapsed : 1));
    const views = Math.round(cost / c.r.uni(180, 320) * 1000);
    const clicks = Math.round(views * c.r.uni(0.035, 0.065));
    const orders = Math.round(clicks * c.r.uni(0.06, 0.12));
    return { cost, views, clicks, cart: Math.round(clicks * c.r.uni(0.08, 0.15)), orders, orders_rub: round2(orders * byCode.get(c.code).price * 1.9 * (mp === 'OZON' ? 0.95 : 1)) };
  };
  for (const c of campaigns('WB', wbCodes, 42)) {
    t.wb_adverts.push({ advert_id: c.id, name: c.name, status: c.end === todayYm ? 9 : 11 });
    for (const ym of monthsBetween(c.start, c.end)) {
      const m = adMetrics(c, ym, 'WB');
      const parts = c.second ? [[c.code, 0.8], [c.second, 0.2]] : [[c.code, 1]];
      for (const [code, k] of parts) {
        t.ads_wb.push({ ...cubeMonth(ym), Маркетплейс: 'Wildberries', 'ID рекламной кампании': c.id, Код: code,
          views: Math.round(m.views * k), clicks: Math.round(m.clicks * k), cart: Math.round(m.cart * k), cost: round2(m.cost * k), orders: Math.round(m.orders * k), orders_rub: round2(m.orders_rub * k) });
        const nm = nmOf.get(code);
        const a = nmAds.get(`${ym}|${nm}`) || { cost: 0, orders_rub: 0 };
        a.cost += m.cost * k; a.orders_rub += m.orders_rub * k; nmAds.set(`${ym}|${nm}`, a);
      }
    }
  }
  for (const [k, a] of nmAds) t.wb_ads_nm_month.push({ ym: k.slice(0, 7), nm_id: k.slice(8), cost: round2(a.cost), orders_rub: round2(a.orders_rub) });
  for (const c of campaigns('OZON', ozCodes, 30)) {
    for (const ym of monthsBetween(c.start, c.end)) {
      const m = adMetrics(c, ym, 'OZON');
      t.oz_ads_campaign.push({ ym, camp: c.id, title: c.name.replace(/ (AGC|&)$/, ''), ...m });
      // Ozon campaigns reached the cube only in July 2026.
      if (ym >= '2026-07') t.ads_wb.push({ ...cubeMonth(ym), Маркетплейс: 'OZON', 'ID рекламной кампании': c.id, Код: c.code, ...m });
    }
  }

  // ---- our finished-goods stock (last snapshot) ----
  const lastQty = new Map();
  for (const b of book) if (b.ym >= ymAdd(todayYm, -3)) lastQty.set(b.s.code, (lastQty.get(b.s.code) || 0) + b.qty / 3);
  t.our_stock = [...lastQty].map(([code, q]) => {
    const r = rng(hash32('our-stock', code));
    const stock = r.chance(0.07) ? 0 : Math.round(q * r.uni(0.4, 3.5));
    return { Код: code, stock, free: Math.round(stock * r.uni(0.6, 0.95)) };
  });

  // ---- plans ----
  t.plan_op = [];
  for (const p of PARTNERS) {
    const r = rng(hash32('plan', p.name));
    for (const ym of monthsBetween('2025-01', '2026-12')) {
      const years = (Number(ym.slice(0, 4)) - 2025) + (Number(ym.slice(5, 7)) - 7) / 12;
      const plan = p.size * (1 + p.growth * 1.1) ** years * (p.mp && ym < '2026-01' ? 0.78 : 1) * r.uni(1.0, 1.12);
      // The Ozon plan is split between two managers.
      const managers = p.mp === 'OZON' ? [[MANAGERS[p.div], 0.6], [OZON_SECOND_MANAGER, 0.4]] : [[MANAGERS[p.div], 1]];
      for (const [manager, k] of managers) {
        t.plan_op.push({
          'Месяц отчетного периода': `${ym}-01`, 'Статья бюджетов': 'План продаж по клиентам', Подразделение: p.div,
          'Аналитика 1': manager, 'Аналитика 2': null, 'Аналитика 3': null, 'Аналитика 4': p.name, plan: round2(plan * k),
        });
      }
    }
  }
  const catBase = new Map(); // `${div}|${motiv}` → monthly revenue in H1 2026
  for (const b of book) {
    if (b.ym < '2026-01' || b.ym > '2026-06') continue;
    const k = `${b.p.div}|${b.s.motiv}`;
    catBase.set(k, (catBase.get(k) || 0) + b.rev / 6);
  }
  for (const [k, base] of catBase) {
    const [div, motiv] = k.split('|');
    const r = rng(hash32('cat-plan', k));
    for (const ym of monthsBetween('2026-01', '2026-12')) {
      const m = Number(ym.slice(5, 7));
      t.plan_op.push({
        'Месяц отчетного периода': `${ym}-01`, 'Статья бюджетов': 'План продаж по подразделениям', Подразделение: div,
        'Аналитика 1': motiv, 'Аналитика 2': null, 'Аналитика 3': null, 'Аналитика 4': null,
        plan: round2(base * (1 + 0.015 * (m - 3)) * r.uni(1.0, 1.15)),
      });
    }
  }

  // ---- references ----
  const segment = (s) => (s.price > 450 ? 'Премиум' : s.price > 200 ? 'Мидл' : 'Масс');
  t.nomen = skus.map((s) => ({
    code: s.code, name: s.name, brand: s.brand, subbrand: s.subbrand, bdir: BDIR[s.channel], tgroup: s.group,
    g1: s.motiv, g2: s.group, segment: segment(s), stage: s.stage,
  }));
  const refs = new Map(skus.map((s) => [s.code, {
    tm: s.tm, mark: s.brand, fund: BDIR[s.channel], motiv: s.motiv, segment: segment(s), stage: s.stage, mgroup: MGROUP[s.motiv] || 'Прочее',
  }]));

  // ---- list 101: the WB cards the marketplace team manages by hand ----
  const wb2026 = new Map();
  for (const b of mpBook('WB')) if (b.ym >= '2026-01') wb2026.set(b.s.code, (wb2026.get(b.s.code) || 0) + b.rev);
  const top = [...wb2026].sort((a, b) => b[1] - a[1]).map(([code]) => code);
  const r101 = rng(hash32('list101'));
  const list101 = [];
  for (let pos = 1; pos <= 101; pos++) {
    if (pos === 57 || pos === 88) { // empty slots
      list101.push({ pos: String(pos), nm_id: '', art: '', brand: '', name: '', status: '', old_nm_id: '', old_art: '', old_name: '' });
      continue;
    }
    const code = top[pos - 1]; const s = byCode.get(code); const nm = nmOf.get(code);
    const updated = r101.chance(0.09);
    const old = updated && top[101 + (pos % 30)] ? byCode.get(top[101 + (pos % 30)]) : null;
    list101.push({
      pos: String(pos), nm_id: nm, art: `${nm.slice(-5)}-NR`, brand: s.tm, name: s.name, status: updated ? 'обновили' : 'без изменений',
      old_nm_id: old ? nmOf.get(old.code) : '-', old_art: old ? `${nmOf.get(old.code).slice(-5)}-NR` : '-', old_name: old ? old.name : '-',
    });
  }

  // ---- profitability files (finance department), rub without VAT ----
  const LINES = {
    // share of revenue by channel: [marketplaces, other clients]
    vyp: [0.034, 0.034], comm: [0.205, 0.045], acq: [0.013, 0], logi: [0.075, 0.022], stor: [0.022, 0.006],
    pack: [0.004, 0.003], fines: [0.003, 0.0005], mpother: [0.011, 0], trade: [0.008, 0.032], listing: [0, 0.006],
    transport: [0.004, 0.005], dz: [0.001, 0.004], stgp: [0.006, 0.006], dept: [0.026, 0.024],
  };
  const rows = [];
  for (const b of book) {
    if (b.ym > profitLast) continue;
    const r = rng(hash32('profit', b.p.name, b.s.code, b.ym));
    const mpCh = b.p.mp ? 0 : 1;
    const preCommission = b.p.mp && b.ym < '2026-01'; // commission already netted in revenue
    const row = {
      ym: b.ym, division: b.p.div, client: b.p.name, code: b.s.code, name: b.s.name, fund: b.s.tm,
      channel: b.p.mp || 'OTHER', rev: round2(b.rev * r.uni(0.995, 1.005)), qty: b.qty, cogs: round2((b.rev - b.gp) * 0.92),
    };
    for (const [k, shares] of Object.entries(LINES)) {
      const share = k === 'comm' && preCommission ? 0.01 : shares[mpCh];
      row[k] = round2(row.rev * share * r.lognorm(0.12));
    }
    row.roy = LICENSED.has(b.s.brand) ? round2(row.rev * 0.06) : 0;
    rows.push(row);
  }
  const files = [2024, 2025, 2026].map((year) => ({
    year, name: `Доходность ${year}.xlsx`, mtime: ms(year === 2026 ? iso(ms(`${ymAdd(profitLast, 1)}-01`) + 9 * DAY) : `${year + 1}-02-15`),
    last_month: year === 2026 ? profitLast : `${year}-12`,
  }));
  const profit = { rows, files, warnings: [] };

  // ---- freshness ----
  t.freshness = [{ sales_max: lastDay, mp_max: lastDay, ads_max: lastDay, stock_max: today, today }];
  t.dwh_freshness = [
    ['wb_stock', today], ['oz_stock', today], ['wb_search', `${prevYm}-${daysInMonth(prevYm)}`],
    ['wb_funnel', lastDay], ['oz_ads', lastDay], ['wb_ads', lastDay],
  ].map(([src, dmax]) => ({ src, dmax, loaded: today }));

  return { t, profit, refs, list101, warnings: [] };
}
