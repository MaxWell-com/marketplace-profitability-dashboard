// E-comm dashboard (single-page UI). Data: /data/*.json snapshots served by the server (built by src/etl/build.js).
(async function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const LS = { get(k, d) { try { return JSON.parse(localStorage.getItem('ecomm.' + k)) ?? d; } catch (e) { return d; } },
               set(k, v) { try { localStorage.setItem('ecomm.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } } };

  // ------------------------------------------------------------ formatting
  const nf1 = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf0 = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const F = {
    mln: v => v == null || !isFinite(v) ? '—' : nf1.format(v / 1e6),
    mlnU: v => v == null || !isFinite(v) ? '—' : nf1.format(v / 1e6) + ' млн',
    rub: v => v == null || !isFinite(v) ? '—' : nf0.format(v),
    rubU: v => v == null || !isFinite(v) ? '—' : nf0.format(v) + ' ₽',
    int: v => v == null || !isFinite(v) ? '—' : nf0.format(v),
    pct: v => v == null || !isFinite(v) ? '—' : nf1.format(v * 100) + '%',
    pp: v => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + nf1.format(v * 100) + ' п.п.',
    dpct: v => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + nf1.format(v * 100) + '%',
    axisM: v => nf0.format(v / 1e6),
    axisP: v => nf0.format(v * 100) + '%',
  };
  const MON = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  const MONF = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  const ml = ym => MON[+ym.slice(5) - 1] + ' ' + ym.slice(2, 4);
  const mlf = ym => MONF[+ym.slice(5) - 1] + ' ' + ym.slice(0, 4);
  const shiftY = (ym, d) => (+ym.slice(0, 4) + d) + ym.slice(4);
  const cls = v => v > 0 ? 'pos' : v < 0 ? 'neg' : '';
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const div = (a, b) => b ? a / b : null;
  // Change vs a year ago. A percentage exists only when the base is > 0: no sales a year ago but sales now is "new"
  // (+Infinity, ranks above any growth when sorted descending); base 0 with no sales now, or base < 0 (returns exceeded
  // sales), is a dash. div() does not work here: div(a, 0) - 1 gives -1, i.e. a false -100%.
  const yoy = (cur, prev) => prev > 0 ? cur / prev - 1 : !prev && cur > 0 ? Infinity : null;
  const yoyHtml = (cur, prev) => {
    const d = yoy(cur, prev);
    if (d === Infinity) return '<span class="muted" title="Год назад продаж не было">новое</span>';
    if (d == null) return `<span class="muted"${prev < 0 ? ' title="Год назад возвраты больше продаж: процент не считается"' : ''}>—</span>`;
    return `<span class="${cls(d)}">${F.dpct(d)}</span>`;
  };
  const cap =s => s ? s[0].toUpperCase() + s.slice(1) : s;

  const CH = { OZON: { label: 'OZON', color: 'var(--ozon)' }, WB: { label: 'Wildberries', color: 'var(--wb)' }, OTHER: { label: 'Прочие клиенты', color: 'var(--other)' } };
  const CHS = ['OZON', 'WB', 'OTHER'];

  // ------------------------------------------------------------ data
  const names = ['meta', 'profit', 'sales', 'ads', 'stock', 'plan', 'codes', 'list101'];
  const D = {};
  await Promise.all(names.map(async n => { D[n] = await (await fetch('/data/' + n + '.json')).json(); }));

  const P = D.profit, SL = D.sales, A = D.ads, ST = D.stock, PL = D.plan, M = D.meta, L1 = D.list101;
  const CODE = D.codes.codes, CA = D.codes.attrs; // [name, tm, bdir, tgroup, motiv, mgroup, segment]
  const codeTm = i => CA[i] ? CA[i][1] : '(без марки)';
  const LEVELS = M.cascade.levels, OUTSIDE = M.cascade.outside.map(o => o.id);
  const today = M.today;
  const curYm = today.slice(0, 7);
  const profitLast = P.files.map(f => f.last_month).sort().pop();
  // months after the last finance file are estimates (src/etl/estimate.js); once a month appears in the file, the estimate is replaced
  const EST = new Set(P.est_months || []);
  const profitEnd = P.months.slice().sort().pop();
  const mlE = ym => ml(ym) + (EST.has(ym) ? '*' : '');
  const mlfE = ym => mlf(ym) + (EST.has(ym) ? ' (оценка)' : '');
  function estNote(ms) {
    const e = ms.filter(x => EST.has(x));
    if (!e.length) return;
    callout(`<b>${e.map(mlf).join(', ')} — оценка, файла ПЭО за ${e.length > 1 ? 'эти месяцы' : 'этот месяц'} еще нет.</b> Выручка, штуки и себестоимость — 1С (куб); комиссия, эквайринг, логистика, хранение, штрафы и прочие расходы OZON и WB — начисления маркетплейсов (куб, без НДС); остальные статьи — средний процент от выручки клиента за ${P.est_basis[e[0]].map(mlf).join(' – ')} по файлу ПЭО.${e.includes(curYm) ? ` ${cap(MONF[+curYm.slice(5) - 1])} неполный.` : ''} Когда месяц появится в файле, оценка заменится цифрами ПЭО. На графиках и в таблицах такие месяцы помечены «*».`, 'info');
  }

  // ------------------------------------------------------------ state
  const S = Object.assign({
    page: 'overview', fp: {},
    pY: +profitLast.slice(0, 4), pM1: 1, pM2: +profitLast.slice(5),
    oY: +curYm.slice(0, 4), oM1: 1, oM2: +curYm.slice(5),
    lY: +curYm.slice(0, 4), lM1: Math.max(1, +curYm.slice(5) - 2), lM2: +curYm.slice(5),
    salesSrc: '1c', adsMp: 'WB', stockMp: 'WB', q: '',
  }, LS.get('state', {}));
  if (!S.fp || typeof S.fp !== 'object') S.fp = {};
  const save = () => LS.set('state', S);
  const range = (y, m1, m2) => { const a = []; for (let m = m1; m <= m2; m++) a.push(`${y}-${String(m).padStart(2, '0')}`); return a; };
  const pMonths = () => range(S.pY, S.pM1, Math.min(S.pM2, S.pY === +profitEnd.slice(0, 4) ? +profitEnd.slice(5) : 12));
  const oMonths = () => range(S.oY, S.oM1, Math.min(S.oM2, S.oY === +curYm.slice(0, 4) ? +curYm.slice(5) : 12));
  const periodLabel = ms => ms.length ? (ms.length === 1 ? mlf(ms[0]) : `${ml(ms[0])} – ${ml(ms[ms.length - 1])}`) : '—';
  function prevYm(ym) { let y = +ym.slice(0, 4), m = +ym.slice(5) - 1; if (!m) { y--; m = 12; } return `${y}-${String(m).padStart(2, '0')}`; }
  const back = (ym, n) => { for (let i = 0; i < n; i++) ym = prevYm(ym); return ym; };
  const daysIn = ym => ym === curYm ? +today.slice(8) : new Date(+ym.slice(0, 4), +ym.slice(5), 0).getDate();

  // ------------------------------------------------------------ slicers: separate state for each page
  const PROD = ['tm', 'mgroup', 'motiv', 'bdir'];
  const DIML = { ch: 'Канал', client: 'Клиент', tm: 'Марка', mgroup: 'Группа мотивации', motiv: 'Категория мотивации', bdir: 'Направление' };
  const AI = { tm: 0, motiv: 1, mgroup: 2, bdir: 3 };      // P.attrs / SL.attrs
  const CI = { tm: 1, bdir: 2, motiv: 4, mgroup: 5 };      // CA
  const NOV = '(не указано)';
  const FP = () => (S.fp[S.page] = S.fp[S.page] || {});
  const fv = k => { const a = FP()[k]; return a && a.length ? new Set(a) : null; };
  function flt(opt = {}) {
    if (opt.all) return { ch: null, client: null, dims: [] };
    const g = k => (opt.skip || []).includes(k) ? null : fv(k);
    return { ch: g('ch'), client: g('client'), dims: PROD.map(k => [k, g(k)]).filter(x => x[1]) };
  }
  const tupV = (t, k) => t[AI[k]] || NOV;
  const codeV = (i, k) => (CA[i] && CA[i][CI[k]]) || (k === 'tm' ? '(без марки)' : NOV);
  const tupOk = (f, t) => f.dims.every(([k, s]) => s.has(tupV(t, k)));
  const codeOk = (f, i) => f.dims.every(([k, s]) => s.has(codeV(i, k)));
  const chList = () => { const s = fv('ch'); return s ? CHS.filter(c => s.has(c)) : CHS; };
  function scopeLabel(keys = ['client', ...PROD]) {
    const c = fv('ch'), parts = [c ? [...c].map(x => CH[x].label).join(', ') : 'весь E-comm'];
    keys.forEach(k => { const s = fv(k); if (s) parts.push(s.size <= 2 ? [...s].join(', ') : `${DIML[k]}: ${s.size}`); });
    return parts.join(' · ');
  }

  // ------------------------------------------------------------ cascade
  function levels(d) {
    let cur = d.rev || 0;
    LEVELS.forEach(l => { cur -= l.items.reduce((s, i) => s + (d[i] || 0), 0); d[l.id] = cur; });
    return d;
  }
  const zeroP = () => Object.fromEntries(P.measures.map(m => [m, 0]));
  function profitRows(months, opt, cb) {
    const set = new Set(months), f = flt(opt), okA = P.attrs.map(t => tupOk(f, t));
    for (const r of P.rows) {
      const ym = P.months[r[0]]; if (!set.has(ym) || !okA[r[2]]) continue;
      const c = P.clients[r[1]];
      if (f.ch && !f.ch.has(c.channel)) continue;
      if (f.client && !f.client.has(c.name)) continue;
      cb(r, ym, c, P.attrs[r[2]]);
    }
  }
  function profitSum(months, opt = {}) {
    const out = zeroP();
    profitRows(months, opt, r => { for (let i = 0; i < P.measures.length; i++) out[P.measures[i]] += r[3 + i]; });
    return levels(out);
  }
  function profitBy(months, keyFn, opt = {}) {
    const map = new Map();
    profitRows(months, opt, (r, ym, c, t) => {
      const k = keyFn({ ym, client: c, tm: t[0], t });
      let o = map.get(k); if (!o) { o = zeroP(); map.set(k, o); }
      for (let i = 0; i < P.measures.length; i++) o[P.measures[i]] += r[3 + i];
    });
    map.forEach(levels);
    return map;
  }

  // ------------------------------------------------------------ 1C sales
  function salesBy(months, keyFn, opt = {}) {
    const set = new Set(months), map = new Map(), f = flt(opt), okA = SL.attrs.map(t => tupOk(f, t));
    for (const r of SL.rows) {
      const ym = SL.months[r[0]]; if (!set.has(ym) || !okA[r[2]]) continue;
      const p = SL.partners[r[1]];
      if (f.ch && !f.ch.has(p.channel)) continue;
      if (f.client && !f.client.has(p.name)) continue;
      const t = SL.attrs[r[2]], k = keyFn({ ym, p, tm: t[0], t });
      const o = map.get(k) || { rev: 0, qty: 0 }; o.rev += r[3]; o.qty += r[4]; map.set(k, o);
    }
    return map;
  }
  // Russian VAT rate for a date (YYYY-MM or YYYY-MM-DD): 20% through the end of 2025, 22% from 01.01.2026.
  // In the cube, revenue from marketplace reports is VAT-inclusive only; net revenue is obtained by dividing by the rate.
  const VAT = d => d < '2026' ? 1.2 : 1.22;
  const sum = (map, f = 'rev') => [...map.values()].reduce((s, o) => s + o[f], 0);
  function dailySum(src, chs, from, to, net = false) {
    const dd = SL.daily; let v = 0;
    dd.days.forEach((d, i) => {
      if (d < from || d > to) return;
      if (src === 'mp') { const k = net ? VAT(d) : 1; if (chs.includes('OZON')) v += dd.mp.OZON[i] / k; if (chs.includes('WB')) v += dd.mp.Wildberries[i] / k; }
      else chs.forEach(c => { v += dd.c1[c][i]; });
    });
    return v;
  }
  function mpMonthly(net = false) {
    const out = { OZON: {}, WB: {} };
    SL.daily.days.forEach((d, i) => { const m = d.slice(0, 7), k = net ? VAT(d) : 1; out.OZON[m] = (out.OZON[m] || 0) + SL.daily.mp.OZON[i] / k; out.WB[m] = (out.WB[m] || 0) + SL.daily.mp.Wildberries[i] / k; });
    return out;
  }
  // Like-for-like sales for year-over-year comparison: OZON and WB from marketplace reports excl. VAT
  // (their 2025 revenue is kept in a different 1C database), other clients from 1C
  const mpLastDay = SL.daily.days.filter((d, i) => SL.daily.mp.OZON[i] || SL.daily.mp.Wildberries[i]).pop() || today;
  function compSales(c, from, to) {
    const dd = SL.daily; let v = 0;
    dd.days.forEach((d, i) => {
      if (d < from || d > to) return;
      if (c === 'OTHER') v += dd.c1.OTHER[i];
      else v += (c === 'OZON' ? dd.mp.OZON[i] : dd.mp.Wildberries[i]) / VAT(d);
    });
    return v;
  }
  function mtdComp(c, from = curYm + '-01') {
    const to = c === 'OTHER' ? today : (mpLastDay < today ? mpLastDay : today);
    return { cur: compSales(c, from, to), py: compSales(c, shiftY(from, -1), shiftY(to, -1)), to };
  }

  // ------------------------------------------------------------ list 101
  const L1T = L1.targets, L1ix = Object.fromEntries(L1.cols.map((c, i) => [c, i]));
  const L1by = new Map(); L1.rows.forEach(r => L1by.set(r[0] + '|' + r[1], r));
  const l1g = (ym, nm, k) => { const r = L1by.get(ym + '|' + nm); return r ? r[L1ix[k]] : null; };
  const l1turn = (ym, nm) => { const s = l1g(ym, nm, 'avg_stock'), q = l1g(ym, nm, 'qty'); return s == null ? null : q > 0 ? s / (q / daysIn(ym)) : null; };
  const l1posBad = (ym, nm) => (l1g(ym, nm, 'pos') || 0) > L1T.pos;
  const l1turnBad = (ym, nm) => (l1turn(ym, nm) || 0) > L1T.turnover;

  // ------------------------------------------------------------ sortable table
  function table(host, cfg) {
    const st = { key: cfg.sort || null, dir: cfg.dir || -1 };
    const sorted = () => {
      const rows = cfg.rows.slice();
      if (st.key) {
        const col = cfg.cols.find(c => c.key === st.key);
        const v = r => col.sortVal ? col.sortVal(r) : r[st.key];
        rows.sort((a, b) => { const x = v(a), y = v(b); return (x == null) - (y == null) || (typeof x === 'string' ? x.localeCompare(y) : (x - y)) * st.dir; });
      }
      return rows;
    };
    function draw() {
      let rows = sorted();
      if (cfg.limit) rows = rows.slice(0, cfg.limit);
      const head = cfg.cols.map(c => `<th class="${c.txt ? 'txt' : ''} ${c.sort !== false ? 'sortable' : ''} ${st.key === c.key ? 'sorted' : ''}" data-k="${c.key}" title="${esc(c.title || '')}">${c.label}${st.key === c.key ? (st.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('');
      const cell = (c, r) => { const v = c.html ? c.html(r) : (c.fmt ? c.fmt(r[c.key], r) : esc(r[c.key])); return `<td class="${c.txt ? 'name' : ''} ${c.cls ? c.cls(r) : ''}">${v}</td>`; };
      const body = rows.map((r, i) => `<tr class="${cfg.rowCls ? cfg.rowCls(r) : ''} ${cfg.onClick ? 'click' : ''}" data-i="${i}" ${cfg.onClick ? 'tabindex="0"' : ''}>${cfg.cols.map(c => cell(c, r)).join('')}</tr>`).join('');
      const tot = cfg.total ? `<tr class="tot">${cfg.cols.map(c => cell(c, cfg.total)).join('')}</tr>` : '';
      const grp = cfg.cols.some(c => c.group) ? '<tr class="grp">' + cfg.cols.reduce((a, c) => { const g = c.group || ''; if (a.length && a[a.length - 1].g === g) a[a.length - 1].n++; else a.push({ g, n: 1 }); return a; }, []).map(x => `<th colspan="${x.n}" class="${x.g ? 'g' : ''}">${esc(x.g)}</th>`).join('') + '</tr>' : '';
      host.innerHTML = `<div class="scroll" style="max-height:${cfg.maxH || 560}px"><table class="${grp ? 'has-grp' : ''}"><thead>${grp}<tr>${head}</tr></thead><tbody>${body || `<tr><td colspan="${cfg.cols.length}" class="muted" style="text-align:center;padding:18px">Нет данных для выбранных срезов</td></tr>`}${tot}</tbody></table></div>`
        + (cfg.limit && cfg.rows.length > cfg.limit ? `<div class="hint" style="margin-top:6px">Показаны первые ${cfg.limit} из ${cfg.rows.length}</div>` : '');
      host.querySelectorAll('th.sortable').forEach(th => th.onclick = () => { const k = th.dataset.k; st.dir = st.key === k ? -st.dir : -1; st.key = k; draw(); });
      if (cfg.onClick) host.querySelectorAll('tbody tr.click').forEach(tr => { const go = () => cfg.onClick(rows[+tr.dataset.i]); tr.onclick = go; tr.onkeydown = e => { if (e.key === 'Enter') go(); }; });
    }
    host._export = () => {
      const rows = sorted();
      if (cfg.total) rows.push(cfg.total);
      return [cfg.cols.map(c => ({ v: (c.group ? c.group + ' ' : '') + htmlText(c.label) }))].concat(rows.map(r => cfg.cols.map(c => expCell(c, r))));
    };
    draw();
  }
  // ------------------------------------------------------------ Excel export
  const htmlText = h => { const d = document.createElement('div'); d.innerHTML = String(h ?? ''); return d.textContent.trim(); };
  function txtVal(s) {
    s = String(s ?? '').replace(/[  ]/g, ' ').trim();
    if (!s || s === '—') return null;
    const m = s.match(/^([+−-]?)\s*(\d[\d ]*(?:,\d+)?)\s*(%|п\.п\.)?\s*(млн|дн|шт|₽|тыс)?$/);
    if (!m) return { v: s };
    const n = (m[1] && m[1] !== '+' ? -1 : 1) * parseFloat(m[2].replace(/ /g, '').replace(',', '.'));
    return m[3] === '%' ? { v: n / 100, z: 'p' } : { v: n, z: m[2].includes(',') ? 'm' : 'i' };
  }
  function expCell(c, r) {
    const raw = r[c.key];
    if (!c.html && typeof raw === 'number') {
      if (c.fmt === F.mln) return { v: raw / 1e6, z: 'm' };
      if (c.fmt === F.pct) return { v: raw, z: 'p' };
      if (c.fmt === F.int || c.fmt === F.rub) return { v: raw, z: 'i' };
    }
    return txtVal(htmlText(c.html ? c.html(r) : c.fmt ? c.fmt(raw, r) : raw));
  }
  function domRows(t) { return [...t.querySelectorAll('tr:not(.grp)')].map((tr, i) => [...tr.children].map(td => i === 0 ? { v: td.textContent.replace(/[↑↓]/g, '').trim() } : txtVal(td.textContent))); }
  // Panel header -> card strip: title and a «?» with the explanation on the left, buttons on the right.
  // An explanation containing a colour legend (.pill) stays visible: the table cannot be read without it.
  function cardify() {
    $('#page').querySelectorAll('.panel').forEach(p => {
      const h2 = p.querySelector(':scope > h2, :scope > .ph > h2'); if (!h2) return;
      let ph = p.querySelector(':scope > .ph');
      if (!ph) { ph = document.createElement('div'); ph.className = 'ph'; h2.replaceWith(ph); ph.appendChild(h2); }
      const ht = document.createElement('div'); ht.className = 'ht'; const hr = document.createElement('div'); hr.className = 'hr';
      [...ph.children].forEach(c => { if (c !== h2) hr.appendChild(c); });
      ht.appendChild(h2); ph.append(ht, hr);
      const hint = ph.nextElementSibling;
      if (hint && hint.matches('p.hint') && !hint.querySelector('.pill')) {
        const q = document.createElement('button'); q.type = 'button'; q.className = 'qm'; q.textContent = '?'; q.setAttribute('aria-label', 'Пояснение: ' + hint.textContent);
        const html = hint.innerHTML;
        q.onmouseenter = e => Charts.showTip(html, e); q.onmousemove = e => Charts.showTip(html, e); q.onmouseleave = () => Charts.hideTip();
        q.onfocus = () => { const r = q.getBoundingClientRect(); Charts.showTip(html, { clientX: r.right, clientY: r.bottom }); }; q.onblur = () => Charts.hideTip();
        ht.appendChild(q); hint.remove();
      }
    });
  }
  function addExports() {
    const page = $('#page-title').textContent;
    $('#page').querySelectorAll('.panel').forEach(p => {
      const ts = [...p.querySelectorAll('table')];
      if (!ts.length || p.querySelector('.xl-btn')) return;
      let ph = p.querySelector(':scope > .ph');
      const h2 = p.querySelector('h2');
      if (!ph && h2) { ph = document.createElement('div'); ph.className = 'ph'; h2.replaceWith(ph); ph.appendChild(h2); }
      const b = document.createElement('button'); b.className = 'ghost xl-btn'; b.textContent = 'Excel'; b.title = 'Скачать таблицу в Excel';
      b.onclick = () => {
        const title = h2 ? h2.textContent.trim() : page;
        const sheets = ts.map((t, i) => { const h = t.closest('.scroll') && t.closest('.scroll').parentElement; return { name: ts.length > 1 ? `${title} ${i + 1}` : title, rows: h && h._export ? h._export() : domRows(t) }; });
        Xlsx.download(`E-comm ${page} - ${title} ${today}.xlsx`.replace(/[\\/:*?"<>|]/g, ' '), sheets);
      };
      ((ph && ph.querySelector('.hr')) || ph || p).appendChild(b);
    });
  }

  // ------------------------------------------------------------ filters
  function fgroup(label, row) { const w = document.createElement('div'); w.className = 'fgroup'; w.dataset.row = row; w.innerHTML = `<span class="flabel">${esc(label)}</span>`; return w; }
  function seg(label, opts, val, on, row = 'mode') {
    const b = opts.map(o => `<button type="button" data-v="${esc(o.v)}" class="${String(o.v) === String(val) ? 'active' : ''}">${o.dot ? `<span class="dot" style="background:${o.dot}"></span>` : ''}${esc(o.l)}</button>`).join('');
    const w = fgroup(label, row); w.insertAdjacentHTML('beforeend', `<div class="seg" role="group" aria-label="${esc(label)}">${b}</div>`);
    w.querySelector('.seg').onclick = e => { const x = e.target.closest('button'); if (x) on(x.dataset.v); };
    return w;
  }
  function sel(label, opts, val, on, width) {
    const w = fgroup(label, 'period');
    w.insertAdjacentHTML('beforeend', `<select aria-label="${esc(label)}" ${width ? `style="width:${width}px"` : ''}>${opts.map(o => `<option value="${esc(o.v)}" ${String(o.v) === String(val) ? 'selected' : ''}>${esc(o.l)}</option>`).join('')}</select>`);
    w.querySelector('select').onchange = e => on(e.target.value);
    return w;
  }
  // Filter panel laid out in rows: «Режим» (mode), «Срезы» (slicers), «Период» (period)
  function layoutFilters() {
    const f = $('#filters'), items = [...f.children];
    f.hidden = !items.length; if (!items.length) return;
    f.innerHTML = '';
    [['mode', 'Режим'], ['slice', 'Срезы'], ['period', 'Период']].forEach(([k, t]) => {
      const its = items.filter(e => (e.dataset.row || 'slice') === k); if (!its.length) return;
      const r = document.createElement('div'); r.className = 'frow';
      r.innerHTML = `<div class="flabel-row">${t}</div><div class="fctl"><div class="fline"></div></div>`;
      its.forEach(e => r.querySelector('.fline').appendChild(e)); f.appendChild(r);
    });
  }
  function period(kind) {
    const ys = kind === 'p' ? [...new Set(P.months.map(m => +m.slice(0, 4)))].sort() : [2025, 2026];
    const Y = kind + 'Y', M1 = kind + 'M1', M2 = kind + 'M2';
    const frag = document.createDocumentFragment();
    frag.append(sel('Год', ys.map(y => ({ v: y, l: y })), S[Y], v => { S[Y] = +v; set(); }));
    const mo = MONF.map((m, i) => ({ v: i + 1, l: m }));
    frag.append(sel('С', mo, S[M1], v => { S[M1] = +v; if (S[M2] < S[M1]) S[M2] = S[M1]; set(); }));
    frag.append(sel('по', mo, S[M2], v => { S[M2] = +v; if (S[M1] > S[M2]) S[M1] = S[M2]; set(); }));
    return frag;
  }
  // Drop-down list with multiple selection. An empty selection means all values.
  // The selection is applied with the «Применить» (apply) button or a click outside the list; Esc cancels.
  let MS_OPEN = null;
  document.addEventListener('mousedown', e => { if (MS_OPEN && !MS_OPEN.el.contains(e.target)) MS_OPEN.commit(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && MS_OPEN) MS_OPEN.cancel(); });
  function multi(key, label, opts) {
    const fp = FP(), was = (fp[key] || []).filter(v => opts.some(o => o.v === v));
    const cur = new Set(was);
    const w = document.createElement('div'); w.className = 'ms';
    w.innerHTML = `<button type="button" class="ms-btn${cur.size ? ' on' : ''}" aria-haspopup="listbox" aria-expanded="false"><span class="ms-t"></span><span class="ms-a" aria-hidden="true">▾</span></button>
      <div class="ms-pop" hidden>${opts.length > 8 ? '<input type="search" class="ms-q" placeholder="Поиск">' : ''}
        <div class="ms-acts"><button type="button" data-a="all">Выбрать все</button><button type="button" data-a="none">Очистить</button></div>
        <div class="ms-list" role="listbox" aria-multiselectable="true" aria-label="${esc(label)}">${opts.map((o, i) => `<label class="ms-o"><input type="checkbox" data-i="${i}"${cur.has(o.v) ? ' checked' : ''}>${o.dot ? `<span class="dot" style="background:${o.dot}"></span>` : ''}<span>${esc(o.l)}</span></label>`).join('') || '<div class="muted" style="padding:6px">Нет значений</div>'}</div>
        <div class="ms-f"><button type="button" class="ms-ok">Применить</button></div></div>`;
    const btn = w.querySelector('.ms-btn'), pop = w.querySelector('.ms-pop'), boxes = [...w.querySelectorAll('.ms-list input')];
    const text = () => { const sel_ = opts.filter(o => cur.has(o.v)); return !sel_.length || sel_.length === opts.length ? 'Все' : sel_.length === 1 ? sel_[0].l : `${sel_[0].l} и еще ${sel_.length - 1}`; };
    const upd = () => { w.querySelector('.ms-t').textContent = text(); btn.title = opts.filter(o => cur.has(o.v)).map(o => o.l).join(', '); };
    upd();
    const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); MS_OPEN = null; };
    const norm = a => JSON.stringify(a.slice().sort());
    const commit = () => {
      close();
      const v = cur.size === opts.length ? [] : opts.filter(o => cur.has(o.v)).map(o => o.v);
      if (norm(v) !== norm(was)) { FP()[key] = v; set(); }
    };
    const cancel = () => { cur.clear(); was.forEach(v => cur.add(v)); boxes.forEach(b => { b.checked = cur.has(opts[+b.dataset.i].v); }); upd(); close(); };
    btn.onclick = () => {
      if (!pop.hidden) { commit(); return; }
      if (MS_OPEN) MS_OPEN.commit();
      pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); MS_OPEN = { el: w, commit, cancel };
      pop.style.left = '0'; pop.style.right = 'auto';
      if (pop.getBoundingClientRect().right > window.innerWidth - 8) { pop.style.left = 'auto'; pop.style.right = '0'; }
      const q = w.querySelector('.ms-q'); if (q) q.focus();
    };
    boxes.forEach(b => b.onchange = () => { const v = opts[+b.dataset.i].v; if (b.checked) cur.add(v); else cur.delete(v); upd(); });
    const q = w.querySelector('.ms-q');
    if (q) q.oninput = () => { const s = q.value.trim().toLowerCase(); boxes.forEach(b => { b.parentElement.style.display = !s || opts[+b.dataset.i].l.toLowerCase().includes(s) ? '' : 'none'; }); };
    w.querySelector('.ms-acts').onclick = e => {
      const a = e.target.closest('button'); if (!a) return;
      boxes.forEach(b => { if (b.parentElement.style.display === 'none') return; b.checked = a.dataset.a === 'all'; const v = opts[+b.dataset.i].v; if (b.checked) cur.add(v); else cur.delete(v); });
      upd();
    };
    w.querySelector('.ms-ok').onclick = commit;
    const g = fgroup(label, 'slice'); g.appendChild(w);
    return g;
  }
  // Button slicer for short lists (2-4 options): a single value or «Все» (all). Stored as [] or [value].
  function segF(key, label, opts, allLabel = 'Все', onSet) {
    if ((FP()[key] || []).length > 1) FP()[key] = FP()[key].slice(0, 1);
    const cur = (FP()[key] || [])[0], ok = opts.some(o => o.v === cur);
    return seg(label, [{ v: '', l: allLabel }].concat(opts), ok ? cur : '', v => { FP()[key] = v ? [v] : []; if (onSet) onSet(v); set(); }, 'slice');
  }
  // Channel: changing the channel resets the client filter
  const chSeg = (list = CHS) => segF('ch', 'Канал', chOpts(list), 'Весь E-comm', () => { FP().client = []; });
  const optsOf = arr => [...new Set(arr)].sort((a, b) => (a === NOV) - (b === NOV) || String(a).localeCompare(String(b), 'ru')).map(v => ({ v, l: v }));
  const chOpts = (list = CHS) => list.map(c => ({ v: c, l: CH[c].label, dot: CH[c].color }));
  // product-attribute slicers: vals are attribute tuples (tuples) or code indices (codes)
  function prodSlicers(f, vals, kind, dims = PROD) {
    dims.forEach(k => f.append(multi(k, DIML[k], optsOf(vals.map(v => kind === 'tuples' ? tupV(v, k) : codeV(v, k))))));
  }
  function resetBtn(f) {
    if (!Object.values(FP()).some(a => a && a.length)) return;
    const b = document.createElement('button'); b.className = 'ghost reset'; b.textContent = 'Сбросить срезы'; b.dataset.row = 'slice';
    b.onclick = () => { S.fp[S.page] = {}; set(); };
    f.append(b);
  }
  function set() { save(); render(); }

  // ------------------------------------------------------------ navigation
  const PAGES = [
    { sep: 'Доходность' },
    { id: 'overview', t: 'Обзор' },
    { id: 'profit', t: 'Каскад ВП' },
    { id: 'brands', t: 'Марки и товары' },
    { sep: 'Операционные данные' },
    { id: 'sales', t: 'Продажи' },
    { id: 'ads', t: 'Реклама' },
    { id: 'list101', t: 'Список 101' },
    { id: 'stock', t: 'Наличие на МП' },
    { id: 'plan', t: 'План-факт' },
    { sep: 'Служебные' },
    { id: 'data', t: 'О данных' },
  ];
  function nav() {
    $('#nav').innerHTML = PAGES.map((p, i) => p.sep ? (i ? '<i class="navsplit" aria-hidden="true"></i>' : '') : `<a href="#${p.id}" class="${S.page === p.id ? 'active' : ''}" ${S.page === p.id ? 'aria-current="page"' : ''}>${p.t}</a>`).join('');
    $('#asof').textContent = today.split('-').reverse().join('.');
  }
  window.addEventListener('hashchange', () => { S.page = location.hash.slice(1) || 'overview'; set(); });
  if (location.hash) S.page = location.hash.slice(1);

  function head(title, sub) { $('#page-title').textContent = title; $('#page-sub').innerHTML = sub || ''; }
  function panel(html, cls) { const d = document.createElement('div'); d.className = 'panel ' + (cls || ''); d.innerHTML = html; $('#page').appendChild(d); return d; }
  function kpis(items) {
    const d = document.createElement('div'); d.className = 'kpis';
    d.innerHTML = items.map(k => `<div class="kpi"><div class="l">${k.l}</div><div class="v">${k.v}${k.u ? `<small>${k.u}</small>` : ''}</div>${k.s ? `<div class="s">${k.s}</div>` : ''}</div>`).join('<i class="kpi-sep" aria-hidden="true"></i>');
    $('#page').appendChild(d);
  }
  function callout(html, kind) { const d = document.createElement('div'); d.className = 'callout ' + (kind || ''); d.innerHTML = html; $('#page').appendChild(d); }

  // ============================================================ OVERVIEW
  function pageOverview() {
    head('Обзор E-comm', '');
    const y = +curYm.slice(0, 4), m = +curYm.slice(5);
    const mtd = CHS.map(c => mtdComp(c)), mtdCur = mtd.reduce((s, o) => s + o.cur, 0), mtdPy = mtd.reduce((s, o) => s + o.py, 0);
    const ytd = CHS.map(c => mtdComp(c, `${y}-01-01`)), ytdCur = ytd.reduce((s, o) => s + o.cur, 0), ytdPy = ytd.reduce((s, o) => s + o.py, 0);
    const lastP = profitSum([profitLast], { all: true }), prevP = profitSum([prevYm(profitLast)], { all: true });
    const ytdP = profitSum(range(+profitLast.slice(0, 4), 1, +profitLast.slice(5)), { all: true });
    const opMs = range(y, 1, +profitLast.slice(5));
    const opPlan = PL.op.filter(r => opMs.includes(r[0])).reduce((s, r) => s + r[4], 0);
    const opFact = sum(salesBy(opMs, () => 1, { all: true }));
    kpis([
      { l: `Продажи, ${MONF[m - 1]}`, v: F.mln(mtdCur), u: 'млн', s: `к тем же дням ${y - 1}: ${yoyHtml(mtdCur, mtdPy)}` },
      { l: `Продажи с начала ${y}`, v: F.mln(ytdCur), u: 'млн', s: `к ${y - 1}: ${yoyHtml(ytdCur, ytdPy)}` },
      { l: `ВП4, ${mlf(profitLast)}`, v: F.pct(div(lastP.vp4, lastP.rev)), u: F.mln(lastP.vp4) + ' млн', s: `${mlf(prevYm(profitLast))}: ${F.pct(div(prevP.vp4, prevP.rev))}` },
      { l: `ВП4 с начала ${profitLast.slice(0, 4)}`, v: F.pct(div(ytdP.vp4, ytdP.rev)), u: F.mln(ytdP.vp4) + ' млн', s: `выручка ${F.mln(ytdP.rev)} млн` },
      { l: `Опер-план, ${periodLabel(opMs)}`, v: F.pct(div(opFact, opPlan)), s: `факт ${F.mln(opFact)} из ${F.mln(opPlan)} млн` },
    ].concat(EST.has(profitEnd) ? [(e => ({ l: `ВП4, ${mlf(profitEnd)}, предварительно`, v: F.pct(div(e.vp4, e.rev)), u: F.mln(e.vp4) + ' млн', s: `выручка ${F.mln(e.rev)} млн${profitEnd === curYm ? ', месяц не закончен' : ''}` }))(profitSum([profitEnd], { all: true }))] : []));
    const sig = signals();
    panel(`<h2>Сигналы</h2><div class="signals">${sig.map(s => `<div class="callout ${s.k}"><span class="pic" aria-hidden="true">${{ bad: '✕', warn: '!', good: '✓' }[s.k]}</span><div>${s.t}</div></div>`).join('')}</div>`);
    const g = document.createElement('div'); g.className = 'grid2e'; $('#page').appendChild(g);
    const p1 = document.createElement('div'); p1.className = 'panel'; g.appendChild(p1);
    p1.innerHTML = '<h2>Продажи по месяцам, млн ₽</h2><p class="hint">Текущий месяц не закончен.</p><div class="c"></div>';
    const ms = SL.months.slice().sort().filter(x => x >= '2025-01' && x <= curYm);
    const mpm = mpMonthly(), othCh = salesBy(ms, r => r.ym + '|' + r.p.channel, { all: true });
    const val = (c, x) => c === 'OTHER' ? (othCh.get(x + '|OTHER') || { rev: null }).rev : (mpm[c][x] != null ? mpm[c][x] / VAT(x) : null);
    Charts.line(p1.querySelector('.c'), { labels: ms.map(ml), tipLabels: ms.map(mlf), yFmt: F.axisM, tipFmt: F.rubU,
      series: CHS.map(c => ({ name: CH[c].label, color: CH[c].color, values: ms.map(x => val(c, x)) })) });
    const p2 = document.createElement('div'); p2.className = 'panel'; g.appendChild(p2);
    p2.innerHTML = '<h2>ВП4 по месяцам, % выручки</h2><p class="hint">* — предварительная оценка.</p><div class="c"></div>';
    const pm = P.months.slice().sort().filter(x => x >= '2025-01');
    const byc = profitBy(pm, r => r.ym + '|' + r.client.channel, { all: true });
    Charts.line(p2.querySelector('.c'), { labels: pm.map(mlE), tipLabels: pm.map(mlfE), yFmt: F.axisP, tipFmt: F.pct, zero: true,
      series: CHS.map(c => ({ name: CH[c].label, color: CH[c].color, values: pm.map(x => { const o = byc.get(x + '|' + c); return o && o.rev ? o.vp4 / o.rev : null; }) })) });
  }
  // Large 1C rows with almost no units (e.g. a commission agent's preliminary report posted as a single row)
  function lumpRows(ym) {
    const out = {};
    SL.sku.forEach(r => { if (SL.months[r[0]] !== ym || r[3] < 1e6 || r[4] > 5) return; const o = out[r[1]] || { rev: 0, names: new Set() }; o.rev += r[3]; o.names.add(CA[r[2]] ? CA[r[2]][0] : CODE[r[2]]); out[r[1]] = o; });
    return out;
  }
  function lumpNote(ym) {
    const l = lumpRows(ym), ks = Object.keys(l);
    if (!ks.length) return '';
    return ks.map(c => `<b>${CH[c].label}, ${mlf(ym)}: ${F.rubU(l[c].rev)} выручки 1С лежат в строках почти без штук</b> (${esc([...l[c].names].slice(0, 3).join(', '))}). Похоже на предварительный документ без разбивки по товарам: по маркам и товарам этот месяц неполный.`).join('<br>');
  }
  // Signals for managers: at most 12; bad (red) first, then neutral (yellow), then good (green)
  function signals() {
    const out = [], y = +curYm.slice(0, 4), mi = +curYm.slice(5) - 1, lastFull = prevYm(curYm), lfName = MONF[+lastFull.slice(5) - 1];
    const lvl = (v, lo, hi) => v == null || !isFinite(v) ? 'warn' : v <= lo ? 'bad' : v >= hi ? 'good' : 'warn';
    const dm = d => d.split('-').reverse().slice(0, 2).join('.');
    const b3 = [1, 2, 3].map(i => back(lastFull, i));
    // 1-3. current-month sales vs the same days of last year
    CHS.forEach(c => {
      const o = mtdComp(c); if (!o.py) return;
      const d = o.cur / o.py - 1;
      out.push({ k: lvl(d, -0.1, 0.1), t: `<b>${CH[c].label}: продажи за ${MONF[mi]} ${F.rubU(o.cur)}, ${F.dpct(d)} к тем же дням ${y - 1}</b> (по ${dm(o.to)}; год назад ${F.rubU(o.py)}).` });
    });
    // 4. GP4 of the last closed month vs the year-to-date average
    const ytdMs = range(+profitLast.slice(0, 4), 1, +profitLast.slice(5) - 1);
    if (ytdMs.length) {
      const a = profitSum([profitLast], { all: true }), b = profitSum(ytdMs, { all: true });
      const pa = div(a.vp4, a.rev), pb = div(b.vp4, b.rev), d = pa - pb;
      let t = `<b>ВП4 за ${MONF[+profitLast.slice(5) - 1]} ${F.pct(pa)}</b> — ${d >= 0 ? 'выше' : 'ниже'} среднего за ${periodLabel(ytdMs)} (${F.pct(pb)}) на ${nf1.format(Math.abs(d * 100))} п.п.`;
      const bc = profitBy([profitLast], r => r.client.channel, { all: true }), by = profitBy(ytdMs, r => r.client.channel, { all: true });
      const chs = CHS.filter(c => bc.get(c) && by.get(c) && bc.get(c).rev && by.get(c).rev);
      t += ` По каналам: ${chs.map(c => `${CH[c].label} ${F.pct(bc.get(c).vp4 / bc.get(c).rev)} (${F.pp(bc.get(c).vp4 / bc.get(c).rev - by.get(c).vp4 / by.get(c).rev)})`).join(', ')}.`;
      const shO = div((bc.get('OTHER') || {}).rev, a.rev), shOy = div((by.get('OTHER') || {}).rev, b.rev);
      if (shO != null && shOy != null && Math.abs(shO - shOy) >= 0.05) t += ` Доля прочих клиентов в выручке ${F.pct(shO)} против ${F.pct(shOy)} в среднем; у них ВП4 выше, поэтому общая ВП4 ${shO < shOy ? 'снижается' : 'растет'} за счет структуры продаж.`;
      if (EST.has(profitEnd)) { const e = profitSum([profitEnd], { all: true }); t += ` Предварительно за ${MONF[+profitEnd.slice(5) - 1]}: ${F.pct(div(e.vp4, e.rev))}.`; }
      out.push({ k: lvl(d, -0.01, 0.01), t });
    }
    // 5-7. availability on the marketplaces and in our own warehouse
    const lastRev = new Map(); SL.sku.forEach(r => { if (SL.months[r[0]] === lastFull) lastRev.set(r[1] + '|' + r[2], (lastRev.get(r[1] + '|' + r[2]) || 0) + r[3]); });
    const revOf = r => lastRev.get(r[0] + '|' + r[1]) || 0;
    const nm = r => CA[r[1]] ? CA[r[1]][0] : CODE[r[1]];
    const top = l => l.slice().sort((a, b) => revOf(b) - revOf(a)).slice(0, 3).map(r => `${esc(nm(r))} (${r[0] === 'WB' ? 'WB' : 'OZON'})`).join('; ');
    const byMp = l => ['WB', 'OZON'].map(mp => `${mp} ${l.filter(r => r[0] === mp).length}`).join(', ');
    const sold = ST.items.filter(r => r[3] > 0);
    const ship = sold.filter(r => r[2] === 0 && r[6] > 0), none = sold.filter(r => r[2] === 0 && !(r[6] > 0)), short = sold.filter(r => r[2] > 0 && r[4] != null && r[4] < 7);
    if (ship.length) out.push({ k: 'bad', t: `<b>Нет на складах маркетплейсов, но есть на нашем складе — позиций с продажами: ${ship.length}</b> (${byMp(ship)}). Можно отгрузить; их продажи за ${lfName}: ${F.rubU(ship.reduce((s, r) => s + revOf(r), 0))}. Крупнейшие: ${top(ship)}.` });
    if (none.length) out.push({ k: 'bad', t: `<b>Нет ни на маркетплейсах, ни на нашем складе — позиций с продажами: ${none.length}</b> (${byMp(none)}). Нужен выпуск или закупка. Крупнейшие: ${top(none)}.` });
    if (short.length) out.push({ k: 'warn', t: `<b>У ${short.length} позиций запас на маркетплейсах меньше недели</b> (${byMp(short)}); на нашем складе есть ${short.filter(r => r[6] > 0).length} из них.` });
    if (!ship.length && !none.length && !short.length) out.push({ k: 'good', t: '<b>Все продающиеся позиции есть на складах маркетплейсов с запасом больше недели.</b>' });
    // 8. ad cost share (ДРР) for last month vs the average of the three months before it
    const ci = k => A.cols.indexOf(k);
    const drr = (mp, ms) => { const s_ = new Set(ms); let c = 0, o = 0; A.camp_rows.forEach(r => { if (A.camps[r[1]].mp !== mp || !s_.has(A.months[r[0]])) return; c += r[2 + ci('cost')]; o += r[2 + ci('orders_rub')]; }); return div(c, o); };
    const ds = ['WB', 'OZON'].map(mp => ({ mp, a: drr(mp, [lastFull]), b: drr(mp, b3) })).filter(x => x.a != null && x.b != null);
    if (ds.length) {
      const hi = Math.max(...ds.map(x => x.a - x.b)), lo = Math.min(...ds.map(x => x.a - x.b));
      out.push({ k: hi >= 0.01 ? 'bad' : lo <= -0.01 ? 'good' : 'warn', t: `<b>ДРР за ${lfName}: ${ds.map(x => `${x.mp === 'WB' ? 'Wildberries' : 'OZON'} ${F.pct(x.a)} (${F.pp(x.a - x.b)})`).join(', ')}</b> — изменение к среднему за ${periodLabel(b3.slice().reverse())}.` });
    }
    // 9. list 101
    const li = L1.items.filter(i => i.nm);
    if (li.length && L1.rows.some(r => r[0] === lastFull)) {
      const pb = li.filter(i => l1posBad(lastFull, i.nm)), tb = li.filter(i => l1turnBad(lastFull, i.nm)), nb = new Set([...pb, ...tb]).size;
      out.push({ k: nb === 0 ? 'good' : nb / li.length > 0.25 ? 'bad' : 'warn', t: `<b>Список 101, ${lfName}: ${nb} из ${li.length} карточек вне цели</b> — средняя позиция хуже ${L1T.pos}: ${pb.length}, оборачиваемость больше ${L1T.turnover} дней: ${tb.length}.` });
    }
    // 10-11. brands: last month vs the average of the three months before it
    const bm = salesBy([lastFull, ...b3], r => r.tm + '|' + (r.ym === lastFull ? 'c' : 'b'), { all: true });
    const tms = [...new Set([...bm.keys()].map(k => k.split('|')[0]))].map(tm => { const c = (bm.get(tm + '|c') || { rev: 0 }).rev, b = (bm.get(tm + '|b') || { rev: 0 }).rev / 3; return { tm, c, b, d: b ? c / b - 1 : null }; })
      .filter(x => x.b >= 1e6 && x.d != null && x.tm !== '(без марки)');
    const lst = l => l.map(x => `${esc(x.tm)} ${F.dpct(x.d)} (${F.rubU(x.c)})`).join(', ');
    const up = tms.filter(x => x.d >= 0.15).sort((a, b) => b.d - a.d).slice(0, 3), dn = tms.filter(x => x.d <= -0.15).sort((a, b) => a.d - b.d).slice(0, 3);
    if (dn.length) out.push({ k: 'bad', t: `<b>Падают марки:</b> ${lst(dn)} — продажи за ${lfName} к среднему за три предыдущих месяца.` });
    if (up.length) out.push({ k: 'good', t: `<b>Растут марки:</b> ${lst(up)} — продажи за ${lfName} к среднему за три предыдущих месяца.` });
    // 12. plan by incentive category for last month
    const cp = new Map(), cf = new Map();
    PL.cat_plan.forEach(r => { if (r[0] === lastFull) cp.set(r[2], (cp.get(r[2]) || 0) + r[3]); });
    PL.cat_fact.forEach(r => { if (r[0] === lastFull) cf.set(r[2], (cf.get(r[2]) || 0) + r[3]); });
    if (cp.size) {
      const pt = [...cp.values()].reduce((s, v) => s + v, 0), ft = [...cf.values()].reduce((s, v) => s + v, 0), pf = div(ft, pt);
      const lag = [...cp.entries()].filter(([, p]) => p >= 5e5).map(([k, p]) => ({ k, p, f: cf.get(k) || 0 })).filter(x => x.f / x.p < 0.9).sort((a, b) => (a.f - a.p) - (b.f - b.p)).slice(0, 3);
      out.push({ k: lvl(pf - 1, -0.1, 0), t: `<b>План по категориям мотивации за ${lfName} выполнен на ${F.pct(pf)}</b> (факт ${F.rubU(ft)} из ${F.rubU(pt)}).${lag.length ? ` Больше всего отстают: ${lag.map(x => `${esc(x.k)} ${F.pct(x.f / x.p)}`).join(', ')}.` : ''}` });
    }
    const ord = { bad: 0, warn: 1, good: 2 };
    return out.sort((a, b) => ord[a.k] - ord[b.k]).slice(0, 12);
  }

  // ============================================================ GROSS PROFIT CASCADE
  function pageProfit() {
    const ms = pMonths(), msPy = ms.map(x => shiftY(x, -1));
    const f = $('#filters');
    f.append(chSeg());
    const cs = fv('ch');
    f.append(multi('client', 'Клиент', optsOf(P.clients.filter(c => !cs || cs.has(c.channel)).map(c => c.name))));
    prodSlicers(f, P.attrs, 'tuples');
    f.append(period('p'));
    resetBtn(f);
    head('Каскад валовой прибыли', `${periodLabel(ms)} · ${scopeLabel()}. Только файлы «Доходность» ПЭО: выручка и все статьи затрат. Формулы уровней одинаковые для всех каналов, без зашитых ставок.`);
    const d = profitSum(ms), dp = profitSum(msPy);
    estNote(ms);
    kpis([
      { l: 'Выручка', v: F.mln(d.rev), u: 'млн', s: `${F.int(d.qty)} шт · год назад ${F.mln(dp.rev)} млн` },
      { l: 'ВП1', v: F.pct(div(d.vp1, d.rev)), u: F.mln(d.vp1) + ' млн', s: `год назад ${F.pct(div(dp.vp1, dp.rev))}` },
      { l: 'ВП3', v: F.pct(div(d.vp3, d.rev)), u: F.mln(d.vp3) + ' млн', s: `год назад ${F.pct(div(dp.vp3, dp.rev))} · ${F.mln(dp.vp3)} млн` },
      { l: 'ВП4', v: F.pct(div(d.vp4, d.rev)), u: F.mln(d.vp4) + ' млн', s: `год назад ${F.pct(div(dp.vp4, dp.rev))} · ${F.mln(dp.vp4)} млн` },
    ]);
    const g = document.createElement('div'); g.className = 'grid2'; $('#page').appendChild(g);
    const pw = document.createElement('div'); pw.className = 'panel'; g.appendChild(pw);
    pw.innerHTML = '<h2>От выручки до ВП4</h2><p class="hint">Серые столбцы — вычитаемые статьи, темные — уровни ВП. Подпись над уровнем — % выручки.</p><div class="c"></div>';
    const grp = ids => ids.reduce((s, i) => s + (d[i] || 0), 0);
    Charts.waterfall(pw.querySelector('.c'), { fmt: F.mlnU, tipFmt: F.rubU, pctOf: d.rev, height: 420, steps: [
      { label: 'Выручка', value: d.rev, kind: 'start' }, { label: 'С/с', value: d.cogs, kind: 'minus' }, { label: 'ВП1', value: d.vp1, kind: 'level' },
      { label: 'Выпуск', value: d.vyp, kind: 'minus' }, { label: 'ВП2', value: d.vp2, kind: 'level' },
      { label: 'Комиссия, логистика', value: grp(['comm', 'acq', 'logi']), kind: 'minus' }, { label: 'ВП3.1', value: d.vp31, kind: 'level' },
      { label: 'Хранение, прочие МП', value: grp(['stor', 'pack', 'fines', 'mpother']), kind: 'minus' }, { label: 'ВП3.2', value: d.vp32, kind: 'level' },
      { label: 'Наши расходы', value: grp(['roy', 'trade', 'listing', 'transport', 'dz', 'stgp']), kind: 'minus' }, { label: 'ВП3', value: d.vp3, kind: 'level' },
      { label: 'Отдел продаж', value: d.dept, kind: 'minus' }, { label: 'ВП4', value: d.vp4, kind: 'level' }] });
    const pt = document.createElement('div'); pt.className = 'panel'; g.appendChild(pt);
    pt.innerHTML = '<div class="ph"><h2>Расшифровка каскада</h2><span class="hint">тот же период год назад — справа</span></div><div class="c"></div>';
    cascadeTable(pt.querySelector('.c'), d, dp);
    // monthly trend
    const pm = document.createElement('div'); pm.className = 'panel'; $('#page').appendChild(pm);
    pm.innerHTML = `<h2>Динамика по месяцам</h2><p class="hint">Уровни ВП в % выручки. Пунктир — тот же месяц прошлого года.</p><div class="g2 grid2e"><div class="c1"></div><div class="c2"></div></div><div class="t" style="margin-top:12px"></div>`;
    const yms = range(S.pY, 1, S.pY === +profitEnd.slice(0, 4) ? +profitEnd.slice(5) : 12);
    const by = profitBy(yms, r => r.ym), byPy = profitBy(yms.map(x => shiftY(x, -1)), r => shiftY(r.ym, 1));
    const pctS = (map, k) => yms.map(x => { const o = map.get(x); return o && o.rev ? o[k] / o.rev : null; });
    if (yms.some(x => EST.has(x))) pm.querySelector('.hint').textContent += ' * — оценка, файла ПЭО за месяц еще нет.';
    Charts.line(pm.querySelector('.c1'), { labels: yms.map(mlE), tipLabels: yms.map(mlfE), yFmt: F.axisP, tipFmt: F.pct, height: 200,
      series: [{ name: `ВП3 ${S.pY}`, color: 'var(--now)', values: pctS(by, 'vp3') }, { name: `ВП3 ${S.pY - 1}`, color: 'var(--prev)', dash: true, values: pctS(byPy, 'vp3') }] });
    Charts.line(pm.querySelector('.c2'), { labels: yms.map(mlE), tipLabels: yms.map(mlfE), yFmt: F.axisP, tipFmt: F.pct, height: 200,
      series: [{ name: `ВП4 ${S.pY}`, color: 'var(--now)', values: pctS(by, 'vp4') }, { name: `ВП4 ${S.pY - 1}`, color: 'var(--prev)', dash: true, values: pctS(byPy, 'vp4') }] });
    const rowsDef = [['rev', 'Выручка, ₽', 'm'], ['vp1', 'ВП1', 'p'], ['vp2', 'ВП2', 'p'], ['vp31', 'ВП3.1', 'p'], ['vp32', 'ВП3.2', 'p'], ['vp3', 'ВП3', 'p'], ['vp4', 'ВП4', 'p'], ['vp4', 'ВП4, ₽', 'm']];
    const cols = [{ key: 'n', label: '', txt: true, sort: false }].concat(yms.map(x => ({ key: x, label: mlE(x), sort: false })));
    table(pm.querySelector('.t'), { cols, rows: rowsDef.map(([k, n, t]) => Object.assign({ n }, Object.fromEntries(yms.map(x => { const o = by.get(x); return [x, o ? (t === 'm' ? F.rub(o[k]) : F.pct(div(o[k], o.rev))) : '—']; })))), rowCls: r => r.n.startsWith('ВП4') ? 'lvl' : '' });
    // clients
    const chs = chList();
    if (!(chs.length === 1 && chs[0] !== 'OTHER')) {
      const pc = document.createElement('div'); pc.className = 'panel'; $('#page').appendChild(pc);
      pc.innerHTML = '<h2>По клиентам</h2><p class="hint">Щелчок по строке — показать каскад клиента.</p><div class="c"></div>';
      const bc = profitBy(ms, r => r.client.name, { skip: ['client'] });
      const rows = [...bc.entries()].map(([k, o]) => ({ ...o, k, dpt: P.clients.find(c => c.name === k).dept })).filter(r => Math.abs(r.rev) > 1000 || Math.abs(r.vp4) > 1000);
      table(pc.querySelector('.c'), { sort: 'rev', rows, onClick: r => { FP().client = [r.k]; set(); }, rowCls: r => fv('client') && fv('client').has(r.k) ? 'lvl' : '', cols: [
        { key: 'k', label: 'Клиент', txt: true }, { key: 'dpt', label: 'Подразделение', txt: true },
        { key: 'rev', label: 'Выручка, ₽', fmt: F.rub }, { key: 'vp1p', label: 'ВП1', sortVal: r => div(r.vp1, r.rev), html: r => F.pct(div(r.vp1, r.rev)) },
        { key: 'comm', label: 'Комиссия и ретро', fmt: F.rub }, { key: 'vp3', label: 'ВП3, ₽', fmt: F.rub }, { key: 'vp3p', label: 'ВП3', sortVal: r => div(r.vp3, r.rev), html: r => F.pct(div(r.vp3, r.rev)) },
        { key: 'vp4', label: 'ВП4, ₽', fmt: F.rub }, { key: 'vp4p', label: 'ВП4', sortVal: r => div(r.vp4, r.rev), html: r => F.pct(div(r.vp4, r.rev)) }] });
    }
  }
  function cascadeTable(host, d, dp) {
    const L = Object.fromEntries(M.cascade.lines.concat(M.cascade.outside).map(l => [l.id, l.label]));
    const rows = [];
    const line = (id, kind) => rows.push({ id, kind, n: kind === 'lvl' ? LEVELS.find(l => l.id === id)?.label || id : L[id] });
    line('rev', 'top'); line('qty', 'qty');
    LEVELS.forEach(l => { l.items.forEach(i => line(i, 'det')); line(l.id, 'lvl'); });
    const vis = rows.filter(r => r.kind !== 'det' || d[r.id] || dp[r.id]);
    const body = vis.map(r => {
      const v = d[r.id], vp = dp[r.id];
      if (r.kind === 'qty') return `<tr class="det"><td>${r.n}</td><td>${F.int(v)}</td><td></td><td></td><td>${F.int(vp)}</td><td></td></tr>`;
      const sign = r.kind === 'det' ? '− ' : '';
      return `<tr class="${r.kind === 'lvl' ? 'lvl' : r.kind === 'det' ? 'det' : 'lvl'}" title="${esc((M.cascade.columns[r.id] || []).join(' + '))}"><td>${sign}${r.n}</td><td>${F.rub(v)}</td><td>${F.pct(div(v, d.rev))}</td><td>${F.rub(div(v, d.qty))}</td><td>${F.rub(vp)}</td><td>${F.pct(div(vp, dp.rev))}</td></tr>`;
    }).join('');
    host.innerHTML = `<div class="scroll" style="max-height:780px"><table><thead><tr><th class="txt">Статья</th><th>₽</th><th>% выр.</th><th>₽/шт</th><th>Год назад</th><th>% выр.</th></tr></thead><tbody>${body}
      </tbody></table></div><p class="hint" style="margin-top:6px">Наведите на строку — подсказка покажет колонки файла, из которых она собрана.</p>`;
  }

  // ============================================================ BRANDS AND PRODUCTS
  function pageBrands() {
    const ms = pMonths(), msPy = ms.map(x => shiftY(x, -1));
    const f = $('#filters');
    f.append(chSeg());
    prodSlicers(f, P.attrs, 'tuples');
    f.append(period('p'));
    resetBtn(f);
    head('Марки и товары', `${periodLabel(ms)} · ${scopeLabel(PROD)}. Марка — «Торговая марка» из справочника ПЭО «Номенклатура.xlsx».`);
    estNote(ms);
    const cur = profitBy(ms, r => r.tm, { skip: ['tm'] }), prev = profitBy(msPy, r => r.tm, { skip: ['tm'] });
    const tot = profitSum(ms, { skip: ['tm'] }), tmS = fv('tm');
    const rows = [...cur.entries()].map(([b, o]) => { const p = prev.get(b) || {}; return { b, ...o, share: div(o.rev, tot.rev), prevRev: p.rev || 0, prevVp3: p.vp3 || 0, dRev: p.rev ? o.rev / p.rev - 1 : null }; })
      .filter(r => Math.abs(r.rev) > 1000);
    const g = document.createElement('div'); g.className = 'grid2e'; $('#page').appendChild(g);
    const top = (k, title) => { const p = document.createElement('div'); p.className = 'panel'; g.appendChild(p); p.innerHTML = `<h2>${title}</h2><div class="c"></div>`;
      Charts.hbars(p.querySelector('.c'), { name: title, fmt: F.mlnU, tipFmt: F.rubU, items: rows.slice().sort((a, b) => b[k] - a[k]).slice(0, 20).map(r => ({ label: r.b, value: r[k], color: tmS && tmS.has(r.b) ? 'var(--level)' : 'var(--now)', sub: `<div class="tr"><span>ВП3</span><b>${F.pct(div(r.vp3, r.rev))}</b></div>` })) }); };
    top('rev', 'ТОП-20 марок по выручке'); top('vp3', 'ТОП-20 марок по ВП3');
    const pb = panel('<h2>Все марки</h2><p class="hint">Щелчок по строке — отбор товаров этой марки ниже.</p><div class="c"></div>');
    table(pb.querySelector('.c'), { sort: 'rev', rows, maxH: 420, onClick: r => { FP().tm = tmS && tmS.size === 1 && tmS.has(r.b) ? [] : [r.b]; set(); }, rowCls: r => tmS && tmS.has(r.b) ? 'lvl' : '', cols: [
      { key: 'b', label: 'Марка', txt: true }, { key: 'rev', label: 'Выручка, ₽', fmt: F.rub }, { key: 'share', label: 'Доля', fmt: F.pct },
      { key: 'dRev', label: 'Выручка к году назад', html: r => `<span class="${cls(r.dRev)}">${F.dpct(r.dRev)}</span>` },
      { key: 'vp1p', label: 'ВП1', sortVal: r => div(r.vp1, r.rev), html: r => F.pct(div(r.vp1, r.rev)) },
      { key: 'vp3', label: 'ВП3, ₽', fmt: F.rub }, { key: 'vp3p', label: 'ВП3', sortVal: r => div(r.vp3, r.rev), html: r => F.pct(div(r.vp3, r.rev)) },
      { key: 'prevVp3', label: 'ВП3 год назад, ₽', fmt: F.rub },
      { key: 'vp4', label: 'ВП4, ₽', fmt: F.rub }, { key: 'vp4p', label: 'ВП4', sortVal: r => div(r.vp4, r.rev), html: r => F.pct(div(r.vp4, r.rev)) }] });
    // products
    const set_ = new Set(ms), agg = new Map(), fl = flt(), chs = new Set(chList());
    for (const r of P.sku) {
      if (!set_.has(P.months[r[0]]) || !chs.has(r[1]) || !codeOk(fl, r[2])) continue;
      const o = agg.get(r[2]) || { rev: 0, qty: 0, vp1: 0, vp2: 0, vp31: 0, vp32: 0, vp3: 0, vp4: 0 };
      ['rev', 'qty', 'vp1', 'vp2', 'vp31', 'vp32', 'vp3', 'vp4'].forEach((k, i) => o[k] += r[3 + i]); agg.set(r[2], o);
    }
    const q = (S.q || '').toLowerCase();
    const srows = [...agg.entries()].map(([i, o]) => ({ code: CODE[i], name: CA[i] ? CA[i][0] : CODE[i], tm: codeTm(i), ...o }))
      .filter(r => !q || r.name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
    const ps = panel(`<div class="ph"><h2>Товары${tmS ? ': ' + esc([...tmS].join(', ')) : ''}</h2><input type="search" placeholder="Поиск по названию или коду" value="${esc(S.q || '')}"></div><p class="hint">Уровни ВП по товару посчитаны тем же каскадом. Строки затрат без товара (по марке или клиенту) в товарах не видны, поэтому сумма по товарам меньше итога.</p><div class="c"></div>`);
    ps.querySelector('input').oninput = e => { S.q = e.target.value; save(); clearTimeout(window._qt); window._qt = setTimeout(render, 250); };
    table(ps.querySelector('.c'), { sort: 'rev', rows: srows, limit: 300, cols: [
      { key: 'code', label: 'Код', txt: false }, { key: 'name', label: 'Наименование', txt: true }, { key: 'tm', label: 'Марка', txt: true },
      { key: 'rev', label: 'Выручка, ₽', fmt: F.rub }, { key: 'qty', label: 'Шт', fmt: F.int }, { key: 'price', label: '₽/шт', sortVal: r => div(r.rev, r.qty), html: r => F.rub(div(r.rev, r.qty)) },
      { key: 'vp1p', label: 'ВП1', sortVal: r => div(r.vp1, r.rev), html: r => F.pct(div(r.vp1, r.rev)) },
      { key: 'vp3', label: 'ВП3, ₽', fmt: F.rub }, { key: 'vp3p', label: 'ВП3', sortVal: r => div(r.vp3, r.rev), html: r => F.pct(div(r.vp3, r.rev)) },
      { key: 'vp4p', label: 'ВП4', sortVal: r => div(r.vp4, r.rev), html: r => F.pct(div(r.vp4, r.rev)) }] });
  }

  // ============================================================ SALES
  function pageSales() {
    const ms = oMonths(), msPy = ms.map(x => shiftY(x, -1));
    if (!['1c', 'mp', 'mpnet'].includes(S.salesSrc)) S.salesSrc = '1c';
    const mpSrc = S.salesSrc !== '1c', net = S.salesSrc === 'mpnet';
    const f = $('#filters');
    f.append(seg('Источник', [{ v: '1c', l: '1С, без НДС' }, { v: 'mp', l: 'Отчеты МП' }, { v: 'mpnet', l: 'Отчеты МП, без НДС' }], S.salesSrc, v => { S.salesSrc = v; set(); }));
    f.append(chSeg(mpSrc ? ['OZON', 'WB'] : CHS));
    if (!mpSrc) {
      const cs = fv('ch');
      f.append(multi('client', 'Клиент', optsOf(SL.partners.filter(p => !cs || cs.has(p.channel)).map(p => p.name))));
      prodSlicers(f, SL.attrs, 'tuples');
    }
    f.append(period('o'));
    resetBtn(f);
    head('Продажи', mpSrc ? `Отчеты маркетплейсов: продажи покупателям OZON и WB ${net ? 'без НДС (НДС 20% до 2026 года, 22% с 2026 года)' : 'с НДС'}, по дате операции.`
      + ' Срезы по клиентам и товарам в этом режиме не применяются.' : `1С: отгрузки подразделений E-comm без НДС, по дате документа · ${scopeLabel()}.`);
    // in «Отчеты МП» (marketplace reports) mode only the OZON and WB channels apply
    const mpChs = (l => l.length ? l : ['OZON', 'WB'])(chList().filter(c => c !== 'OTHER'));
    const chs = mpSrc ? mpChs : chList();
    const fl = flt(), narrow = !mpSrc && (fl.client || fl.dims.length);
    const last = ms[ms.length - 1], isCur = last === curYm;
    let cur, py, mtd, mtdPy;
    if (mpSrc) {
      const mp = mpMonthly(net); cur = ms.reduce((s, x) => s + mpChs.reduce((t, c) => t + (mp[c][x] || 0), 0), 0); py = msPy.reduce((s, x) => s + mpChs.reduce((t, c) => t + (mp[c][x] || 0), 0), 0);
      mtd = dailySum('mp', mpChs, curYm + '-01', today, net); mtdPy = dailySum('mp', mpChs, shiftY(curYm, -1) + '-01', shiftY(today, -1), net);
    } else {
      cur = sum(salesBy(ms, () => 1)); py = sum(salesBy(msPy, () => 1));
      if (narrow) { mtd = sum(salesBy([curYm], () => 1)); mtdPy = null; }
      else { mtd = dailySum('1c', chs, curYm + '-01', today); mtdPy = dailySum('1c', chs, shiftY(curYm, -1) + '-01', shiftY(today, -1)); }
    }
    if (!mpSrc && ms.some(x => x >= '2026-01') && msPy.some(x => x < '2026-01') && chs.some(c => c !== 'OTHER')) callout('<b>1С на стыке 2025 и 2026 года.</b> С января 2026 выручка OZON и WB в 1С учитывается полностью (как в файлах ПЭО), в 2025 — в другой базе. Для сравнения год к году по маркетплейсам переключите источник на «Отчеты МП».');
    if (!mpSrc && ms.includes(curYm)) { const ln = lumpNote(curYm); if (ln) callout(ln, 'bad'); }
    kpis([
      { l: `Выручка, ${periodLabel(ms)}`, v: F.mln(cur), u: 'млн', s: `год назад ${F.mln(py)} млн · ${yoyHtml(cur, py)}${isCur ? ` · ${MONF[+curYm.slice(5) - 1]} неполный` : ''}` },
      { l: `${cap(MONF[+curYm.slice(5) - 1])}, на ${+today.slice(8)} число`, v: F.mln(mtd), u: 'млн', s: mtdPy != null ? `к тем же дням год назад: ${yoyHtml(mtd, mtdPy)}` : 'с начала месяца' },
      { l: 'В среднем за день', v: F.mln(div(mtd, +today.slice(8))), u: 'млн', s: mtdPy != null ? `год назад ${F.mln(div(mtdPy, +today.slice(8)))} млн в день` : '' },
    ].concat(mpSrc ? [] : [{ l: 'Штук', v: F.int(sum(salesBy(ms, () => 1), 'qty')), s: `год назад ${F.int(sum(salesBy(msPy, () => 1), 'qty'))}` }]));
    // by month
    const pm = panel('<h2>По месяцам</h2><p class="hint">График — млн ₽, таблица — ₽. Пунктир — тот же месяц прошлого года (сумма выбранных каналов).</p><div class="c"></div><div class="t" style="margin-top:12px"></div>');
    const yms = range(S.oY, 1, S.oY === +curYm.slice(0, 4) ? +curYm.slice(5) : 12);
    let series, tblRows;
    if (mpSrc) {
      const md = mpMonthly(net);
      series = mpChs.map(c => ({ name: CH[c].label, color: CH[c].color, values: yms.map(x => md[c][x] ?? null) }))
        .concat([{ name: `Итого ${S.oY - 1}`, color: 'var(--prev)', dash: true, values: yms.map(x => mpChs.reduce((s, c) => s + (md[c][shiftY(x, -1)] || 0), 0)) }]);
      tblRows = mpChs.map(c => ({ n: CH[c].label, v: yms.map(x => md[c][x] || 0), p: yms.map(x => md[c][shiftY(x, -1)] || 0) }));
    } else {
      const bm = salesBy(yms, r => r.ym + '|' + r.p.channel), bp = salesBy(yms.map(x => shiftY(x, -1)), r => shiftY(r.ym, 1) + '|' + r.p.channel);
      series = chs.map(c => ({ name: CH[c].label, color: CH[c].color, values: yms.map(x => (bm.get(x + '|' + c) || { rev: null }).rev) }))
        .concat([{ name: `Итого ${S.oY - 1}`, color: 'var(--prev)', dash: true, values: yms.map(x => chs.reduce((s, c) => s + (bp.get(x + '|' + c) || { rev: 0 }).rev, 0)) }]);
      tblRows = chs.map(c => ({ n: CH[c].label, v: yms.map(x => (bm.get(x + '|' + c) || { rev: 0 }).rev), p: yms.map(x => (bp.get(x + '|' + c) || { rev: 0 }).rev) }));
    }
    Charts.line(pm.querySelector('.c'), { labels: yms.map(ml), tipLabels: yms.map(mlf), yFmt: F.axisM, tipFmt: F.rubU, series });
    const rws = [];
    tblRows.forEach(r => { rws.push({ n: r.n, ...Object.fromEntries(yms.map((x, i) => [x, F.rub(r.v[i])])) }); rws.push({ n: 'к году назад', sub: 1, ...Object.fromEntries(yms.map((x, i) => [x, `${yoyHtml(r.v[i], r.p[i])}`])) }); });
    table(pm.querySelector('.t'), { rows: rws, rowCls: r => r.sub ? 'det' : 'lvl', cols: [{ key: 'n', label: '', txt: true, sort: false }].concat(yms.map(x => ({ key: x, label: ml(x), sort: false, html: r => r[x] }))) });
    if (!mpSrc) {
      const g = document.createElement('div'); g.className = 'grid2e'; $('#page').appendChild(g);
      const pb = document.createElement('div'); pb.className = 'panel'; g.appendChild(pb); pb.innerHTML = '<h2>По маркам</h2><p class="hint">Выбранный период к тому же периоду год назад. Щелчок по строке — отбор по марке.</p><div class="c"></div>';
      const tmS = fv('tm'), bc = salesBy(ms, r => r.tm, { skip: ['tm'] }), bp = salesBy(msPy, r => r.tm, { skip: ['tm'] }), tot = sum(bc);
      table(pb.querySelector('.c'), { sort: 'rev', maxH: 460, rows: [...bc.entries()].map(([b, o]) => ({ b, ...o, sh: div(o.rev, tot), py: (bp.get(b) || { rev: 0 }).rev })).filter(r => Math.abs(r.rev) > 1000),
        onClick: r => { FP().tm = tmS && tmS.size === 1 && tmS.has(r.b) ? [] : [r.b]; set(); }, rowCls: r => tmS && tmS.has(r.b) ? 'lvl' : '', cols: [
          { key: 'b', label: 'Марка', txt: true }, { key: 'rev', label: '₽', fmt: F.rub }, { key: 'sh', label: 'Доля', fmt: F.pct },
          { key: 'py', label: 'Год назад', fmt: F.rub }, { key: 'd', label: 'Δ', sortVal: r => yoy(r.rev, r.py), html: r => yoyHtml(r.rev, r.py) },
          { key: 'qty', label: 'Шт', fmt: F.int }] });
      const pc = document.createElement('div'); pc.className = 'panel'; g.appendChild(pc); pc.innerHTML = '<h2>По клиентам</h2><p class="hint">Партнеры 1С подразделений E-comm. Щелчок по строке — отбор по клиенту.</p><div class="c"></div>';
      const clS = fv('client'), cc = salesBy(ms, r => r.p.name, { skip: ['client'] }), cp = salesBy(msPy, r => r.p.name, { skip: ['client'] });
      table(pc.querySelector('.c'), { sort: 'rev', maxH: 460, rows: [...cc.entries()].map(([k, o]) => { const p = SL.partners.find(x => x.name === k); return { k, dept: p.dept, ...o, py: (cp.get(k) || { rev: 0 }).rev }; }).filter(r => Math.abs(r.rev) > 1000),
        onClick: r => { FP().client = clS && clS.size === 1 && clS.has(r.k) ? [] : [r.k]; set(); }, rowCls: r => clS && clS.has(r.k) ? 'lvl' : '',
        cols: [{ key: 'k', label: 'Клиент', txt: true }, { key: 'dept', label: 'Подразделение', txt: true }, { key: 'rev', label: '₽', fmt: F.rub }, { key: 'py', label: 'Год назад', fmt: F.rub },
          { key: 'd', label: 'Δ', sortVal: r => yoy(r.rev, r.py), html: r => yoyHtml(r.rev, r.py) }] });
    }
    mpCosts(ms, mpChs, chList().some(c => c !== 'OTHER'));
  }
  function mpCosts(ms, mpChs, show) {
    if (!show) return;
    const p = panel(`<h2>Удержания маркетплейсов по отчетам МП</h2><p class="hint">Начисления OZON и WB по статьям в % от выручки по отчетам маркетплейсов (суммы с НДС).</p><div class="c"></div>`);
    const set_ = new Set(ms), mps = mpChs.map(c => c === 'WB' ? 'Wildberries' : 'OZON');
    const agg = {}; let rev = 0;
    SL.mp_articles.forEach(r => {
      if (!set_.has(r[0]) || !mps.includes(r[1])) return;
      if (r[4] === 'Выручка') { rev += r[6]; return; }
      const k = r[4]; agg[k] = agg[k] || { n: k, no: r[3], v: 0, mapped: 0 }; agg[k].v += -r[6]; agg[k].mapped += -r[7];
    });
    const rows = Object.values(agg).filter(r => Math.abs(r.v) >= 1000).sort((a, b) => a.no - b.no);
    const totC = rows.reduce((s, r) => s + r.v, 0);
    table(p.querySelector('.c'), { rows, total: { n: 'Всего удержаний', v: totC, mapped: rows.reduce((s, r) => s + r.mapped, 0) }, cols: [
      { key: 'n', label: 'Статья', txt: true, sort: false }, { key: 'v', label: '₽', fmt: F.rub, sort: false },
      { key: 'p', label: '% выручки МП', sort: false, html: r => F.pct(div(r.v, rev)) },
      { key: 'mapped', label: 'Привязано к товару', sort: false, html: r => F.pct(div(r.mapped, r.v)) }] });
  }

  // ============================================================ ADVERTISING
  function pageAds() {
    const ms = oMonths(), msPy = ms.map(x => shiftY(x, -1)), mp = S.adsMp;
    const f = $('#filters');
    f.append(seg('Площадка', [{ v: 'WB', l: 'Wildberries', dot: CH.WB.color }, { v: 'OZON', l: 'OZON', dot: CH.OZON.color }], mp, v => { S.adsMp = v; set(); }));
    prodSlicers(f, [...new Set(A.rows.filter(r => r[1] === mp).map(r => r[2]))], 'codes', ['tm', 'mgroup', 'motiv']);
    if (mp === 'WB') f.append(segF('who', 'Исполнитель', [{ v: 'агентство', l: 'Агентство' }, { v: 'Ирина', l: 'Ирина' }, { v: 'Павел', l: 'Павел' }]));
    f.append(period('o'));
    resetBtn(f);
    head('Реклама', mp === 'WB' ? 'Рекламные кампании WB (по товарам и кампаниям). ДРР = затраты / заказы с рекламы, одинаково для всех лет.' : 'OZON: итоги и кампании за весь период — статистика кампаний, по товарам и маркам — только с июля 2026.');
    const C = A.cols;
    const zero = () => Object.fromEntries(C.map(k => [k, 0]));
    const fl = flt(), prodOn = fl.dims.length > 0, whoS = mp === 'WB' ? fv('who') : null;
    // totals: WB from product rows; OZON from campaigns (no product filter) or from product rows (with a filter)
    const useCamps = mp === 'OZON' && !prodOn, byWho = !!whoS;
    function tot(months) {
      const set_ = new Set(months), o = zero();
      if (useCamps || byWho) A.camp_rows.forEach(r => { const c = A.camps[r[1]]; if (c.mp !== mp || !set_.has(A.months[r[0]])) return; if (byWho && !whoS.has(c.who)) return; C.forEach((k, i) => o[k] += r[2 + i]); });
      else A.rows.forEach(r => { if (r[1] !== mp || !set_.has(A.months[r[0]]) || !codeOk(fl, r[2])) return; C.forEach((k, i) => o[k] += r[3 + i]); });
      return o;
    }
    const t = tot(ms), tp = tot(msPy);
    const mpRev = mpMonthly()[mp], rev = ms.reduce((s, x) => s + (mpRev[x] || 0), 0);
    if (mp === 'OZON' && prodOn && ms.some(x => x < '2026-07')) callout('<b>OZON по товарам — только с июля 2026.</b> До июля итоги без отбора по товарам берутся из статистики кампаний.');
    if (prodOn && byWho) callout('Отбор по исполнителю и по товарам одновременно не поддержан: показаны данные по исполнителю.');
    kpis([
      { l: 'Затраты на рекламу', v: F.mln(t.cost), u: 'млн', s: `год назад ${F.mln(tp.cost)} млн` },
      { l: 'Заказы с рекламы', v: F.mln(t.orders_rub), u: 'млн', s: `${F.int(t.orders)} шт` },
      { l: 'ДРР', v: F.pct(div(t.cost, t.orders_rub)), s: `год назад ${F.pct(div(tp.cost, tp.orders_rub))} · затраты / заказы с рекламы` },
      { l: 'CTR', v: F.pct(div(t.clicks, t.views)), s: `CPC ${F.rub(div(t.cost, t.clicks))} ₽ · ${F.int(t.clicks)} кликов` },
      { l: 'Реклама к продажам МП', v: prodOn || byWho ? '—' : F.pct(div(t.cost, rev)), s: prodOn || byWho ? 'только для всей площадки' : `затраты / выручка по отчетам МП ${F.mln(rev)} млн` },
    ]);
    const g = document.createElement('div'); g.className = 'grid2e'; $('#page').appendChild(g);
    const yms = range(S.oY, 1, S.oY === +curYm.slice(0, 4) ? +curYm.slice(5) : 12);
    const per = yms.map(x => tot([x])), perPy = yms.map(x => tot([shiftY(x, -1)]));
    const p1 = document.createElement('div'); p1.className = 'panel'; g.appendChild(p1); p1.innerHTML = '<h2>Затраты по месяцам, млн ₽</h2><div class="c"></div>';
    Charts.bars(p1.querySelector('.c'), { labels: yms.map(ml), tipLabels: yms.map(mlf), yFmt: F.axisM, tipFmt: F.rubU, height: 210,
      series: [{ name: String(S.oY), color: CH[mp].color, values: per.map(o => o.cost) }, { name: String(S.oY - 1), color: 'var(--prev)', values: perPy.map(o => o.cost || null) }] });
    const p2 = document.createElement('div'); p2.className = 'panel'; g.appendChild(p2); p2.innerHTML = '<h2>ДРР по месяцам</h2><div class="c"></div>';
    Charts.line(p2.querySelector('.c'), { labels: yms.map(ml), tipLabels: yms.map(mlf), yFmt: F.axisP, tipFmt: F.pct, height: 210,
      series: [{ name: String(S.oY), color: CH[mp].color, values: per.map(o => div(o.cost, o.orders_rub)) }, { name: String(S.oY - 1), color: 'var(--prev)', dash: true, values: perPy.map(o => div(o.cost, o.orders_rub)) }] });
    // by brand
    const set_ = new Set(ms), bm = new Map(), flB = flt({ skip: ['tm'] }), tmS = fv('tm');
    A.rows.forEach(r => { if (r[1] !== mp || !set_.has(A.months[r[0]]) || !codeOk(flB, r[2])) return; const b = codeTm(r[2]); const o = bm.get(b) || zero(); C.forEach((k, i) => o[k] += r[3 + i]); bm.set(b, o); });
    const totCost = [...bm.values()].reduce((s, o) => s + o.cost, 0);
    const pb = panel(`<h2>По маркам</h2><p class="hint">Щелчок по строке — отбор по марке.${mp === 'OZON' ? ' OZON — только месяцы с июля 2026.' : ''}</p><div class="c"></div>`);
    table(pb.querySelector('.c'), { sort: 'cost', maxH: 420, rows: [...bm.entries()].map(([b, o]) => ({ b, ...o, sh: div(o.cost, totCost) })).filter(r => r.cost > 0 || r.orders_rub > 0),
      onClick: r => { FP().tm = tmS && tmS.size === 1 && tmS.has(r.b) ? [] : [r.b]; set(); }, rowCls: r => tmS && tmS.has(r.b) ? 'lvl' : '', cols: [
        { key: 'b', label: 'Марка', txt: true }, { key: 'cost', label: 'Затраты, ₽', fmt: F.rub }, { key: 'sh', label: 'Доля затрат', fmt: F.pct },
        { key: 'orders_rub', label: 'Заказы, ₽', fmt: F.rub }, { key: 'drr', label: 'ДРР', sortVal: r => div(r.cost, r.orders_rub), html: r => F.pct(div(r.cost, r.orders_rub)) },
        { key: 'views', label: 'Показы', fmt: F.int }, { key: 'clicks', label: 'Клики', fmt: F.int }, { key: 'ctr', label: 'CTR', sortVal: r => div(r.clicks, r.views), html: r => F.pct(div(r.clicks, r.views)) }] });
    // campaigns and campaign owners
    const cm = new Map();
    A.camp_rows.forEach(r => { const c = A.camps[r[1]]; if (c.mp !== mp || !set_.has(A.months[r[0]])) return; if (byWho && !whoS.has(c.who)) return; const o = cm.get(r[1]) || zero(); C.forEach((k, i) => o[k] += r[2 + i]); cm.set(r[1], o); });
    if (mp === 'WB') {
      const wm = new Map(); cm.forEach((o, k) => { const w = A.camps[k].who; const x = wm.get(w) || zero(); C.forEach(c => x[c] += o[c]); wm.set(w, x); });
      const pw = panel('<h2>По исполнителям</h2><p class="hint">Исполнитель — по окончанию названия кампании: «AGC» — агентство, «&amp;» — Ирина, остальное — Павел. Щелчок по строке — отбор.</p><div class="c"></div>');
      table(pw.querySelector('.c'), { sort: 'cost', rows: [...wm.entries()].map(([w, o]) => ({ w, ...o })), onClick: r => { FP().who = whoS && whoS.size === 1 && whoS.has(r.w) ? [] : [r.w]; set(); }, cols: [
        { key: 'w', label: 'Исполнитель', txt: true }, { key: 'cost', label: 'Затраты, ₽', fmt: F.rub }, { key: 'orders_rub', label: 'Заказы, ₽', fmt: F.rub },
        { key: 'drr', label: 'ДРР', sortVal: r => div(r.cost, r.orders_rub), html: r => F.pct(div(r.cost, r.orders_rub)) }, { key: 'clicks', label: 'Клики', fmt: F.int }] });
    }
    const pc = panel(`<h2>Кампании</h2><p class="hint">Товар — товар 1С с наибольшими затратами в кампании, «(еще N)» — сколько еще товаров с затратами.${mp === 'OZON' ? ' OZON: товар известен для кампаний с июля 2026.' : ''}</p><div class="c"></div>`);
    // a campaign's advertised product: brand, name and 1C code
    const campRow = ([k, o]) => { const c = A.camps[k], i = c.code, at = i != null ? CA[i] : null;
      return { id: c.id, name: c.name || '—', who: c.who, mark: at ? at[7] || '—' : '—', pname: i != null ? (at ? at[0] : CODE[i]) + (c.more ? ` (еще ${c.more})` : '') : '—', pcode: i != null ? CODE[i] : '—', ...o }; };
    table(pc.querySelector('.c'), { sort: 'cost', limit: 200, maxH: 460, rows: [...cm.entries()].map(campRow).filter(r => r.cost > 0),
      cols: [{ key: 'id', label: 'ID' }, { key: 'name', label: 'Кампания', txt: true },
        { key: 'mark', label: 'Марка', txt: true }, { key: 'pname', label: 'Наименование товара', txt: true }, { key: 'pcode', label: 'Код' }].concat(mp === 'WB' ? [{ key: 'who', label: 'Исполнитель', txt: true }] : []).concat([
        { key: 'cost', label: 'Затраты, ₽', fmt: F.rub }, { key: 'orders_rub', label: 'Заказы, ₽', fmt: F.rub },
        { key: 'drr', label: 'ДРР', sortVal: r => div(r.cost, r.orders_rub), html: r => F.pct(div(r.cost, r.orders_rub)) },
        { key: 'clicks', label: 'Клики', fmt: F.int }, { key: 'ctr', label: 'CTR', sortVal: r => div(r.clicks, r.views), html: r => F.pct(div(r.clicks, r.views)) }]) });
  }

  // ============================================================ LIST 101
  function pageList101() {
    const T = L1T, y = S.lY;
    const ms = range(y, S.lM1, Math.min(S.lM2, y === +curYm.slice(0, 4) ? +curYm.slice(5) : 12));
    const items = L1.items.filter(it => it.nm), codes = items.filter(it => it.code != null).map(it => it.code);
    const lastM = ms[ms.length - 1];
    // source of actuals: 1C (sales to RVB/WB by the card's 1C code), or marketplace reports incl. or excl. VAT (default, as in the legacy report)
    if (!['1c', 'mp', 'mpnet'].includes(S.l101Src)) S.l101Src = 'mpnet';
    const src = S.l101Src;
    const c1 = new Map(); if (src === '1c') SL.sku.forEach(r => { if (r[1] === 'WB') { const k = SL.months[r[0]] + '|' + r[2]; c1.set(k, (c1.get(k) || 0) + r[3]); } });
    const factOf = (ym, it) => { if (src === '1c') return it.code != null ? (c1.get(ym + '|' + it.code) ?? null) : null; const v = l1g(ym, it.nm, 'rev'); return v == null ? null : src === 'mp' ? v * VAT(ym) : v; };
    // 1C before 2026 records WB revenue net of the marketplace commission, from 2026 in full; the two are not comparable
    const ncY = x => src === '1c' && shiftY(x, -1) < '2026-01';
    const NC_WHY = 'В 1С до 2026 года продажи WB записаны за вычетом комиссии маркетплейса, с января 2026 — полностью. Поэтому сравнивать 2026 год с 2025 по данным 1С нельзя: рост будет ложным. Для сравнения с прошлым годом выберите источник «Отчеты МП».';
    const NC = `<span class="muted" title="${esc(NC_WHY)}">несопоставимо</span>`;
    const f = $('#filters');
    f.append(seg('Источник', [{ v: '1c', l: '1С, без НДС' }, { v: 'mp', l: 'Отчеты МП' }, { v: 'mpnet', l: 'Отчеты МП, без НДС' }], src, v => { S.l101Src = v; set(); }));
    prodSlicers(f, codes, 'codes', ['tm', 'mgroup', 'motiv']);
    f.append(segF('dev', 'Отклонение', [{ v: 'pos', l: `Позиция > ${T.pos}` }, { v: 'turn', l: `Оборачиваемость > ${T.turnover} дн` }, { v: 'ok', l: 'В цели' }]));
    f.append(segF('st', 'В списке', [{ v: 'same', l: 'Без изменений' }, { v: 'new', l: 'Новые' }]));
    f.append(period('l'));
    resetBtn(f);
    head('Список 101', `Карточки WB из списка ПЭО «101 и ТМ отчеты квартал.xlsx». Цели: средняя позиция до ${T.pos}, оборачиваемость до ${T.turnover} дней. Отклонение — по ${mlf(lastM)}.`);
    const fl = flt(), devS = fv('dev'), stS = fv('st');
    const tmOf = it => it.code != null ? codeTm(it.code) : it.brand || '(без марки)';
    const devOf = it => { const a = []; if (l1posBad(lastM, it.nm)) a.push('pos'); if (l1turnBad(lastM, it.nm)) a.push('turn'); return a.length ? a : ['ok']; };
    const all = items.filter(it => it.code == null ? !fl.dims.length : codeOk(fl, it.code));
    const rows = all.filter(it => (!devS || devOf(it).some(v => devS.has(v))) && (!stS || stS.has(it.status === 'обновили' ? 'new' : 'same'))).map(it => {
      const o = { n: it.pos, nm: it.nm, art: it.art, name: it.code != null && CA[it.code] ? CA[it.code][0] : it.name, tm: tmOf(it), it };
      ms.forEach(x => {
        const py = shiftY(x, -1);
        o['f' + x] = factOf(x, it); o['p' + x] = ncY(x) ? null : factOf(py, it);
        o['y' + x] = yoy(o['f' + x], o['p' + x]); o['d' + x] = div(l1g(x, it.nm, 'ad_cost'), l1g(x, it.nm, 'ad_orders_rub'));
        o['s' + x] = l1g(x, it.nm, 'pos'); o['a' + x] = l1g(x, it.nm, 'avg_stock'); o['t' + x] = l1turn(x, it.nm);
      });
      return o;
    });
    const sumM = (list, k) => list.reduce((s, x) => s + rows.reduce((t, r) => t + (l1g(x, r.nm, k) || 0), 0), 0);
    const sumF = list => list.reduce((s, x) => s + rows.reduce((t, r) => t + (factOf(x, r.it) || 0), 0), 0);
    const fact = sumF(ms), factPy = ms.some(ncY) ? null : sumF(ms.map(x => shiftY(x, -1)));
    const srcTxt = { '1c': 'продажи 1С клиенту РВБ (WB) без НДС по коду 1С карточки', mp: 'выручка WB по отчету реализации с НДС', mpnet: 'выручка WB по отчету реализации без НДС (НДС 20% до 2026 года, 22% с 2026 года)' }[src];
    const nPos = rows.filter(r => l1posBad(lastM, r.nm)).length, nTurn = rows.filter(r => l1turnBad(lastM, r.nm)).length;
    const nZero = rows.filter(r => { const it = ST.items.find(i => i[0] === 'WB' && i[1] === r.it.code); return it && it[2] === 0 && it[3] > 0; }).length;
    if (ms.includes(curYm)) callout(`${cap(MONF[+curYm.slice(5) - 1])} не закончен: факт по ${today.split('-').reverse().join('.')}, оборачиваемость — по продажам этих дней.`, 'info');
    kpis([
      { l: `Факт WB, ${periodLabel(ms)}`, v: F.mln(fact), u: 'млн', s: factPy == null ? `год назад: ${NC}` : `год назад ${F.mln(factPy)} млн · ${yoyHtml(fact, factPy)}` },
      { l: 'ДРР', v: F.pct(div(sumM(ms, 'ad_cost'), sumM(ms, 'ad_orders_rub'))), s: 'затраты / заказы с рекламы' },
      { l: `Позиция хуже ${T.pos}, ${ml(lastM)}`, v: F.int(nPos), s: `из ${rows.length} карточек` },
      { l: `Оборачиваемость больше ${T.turnover} дн, ${ml(lastM)}`, v: F.int(nTurn), s: `из ${rows.length} карточек` },
      { l: 'Сейчас без остатка на WB', v: F.int(nZero), s: 'при продажах за последние 28 дней' },
    ]);
    const pt = panel(`<h2>Карточки по месяцам</h2><p class="hint">Факт — ${srcTxt}; г/г — к тому же месяцу прошлого года; ДРР — затраты на рекламу / заказы с рекламы по карточке (статистика рекламы WB); позиция — средняя в поиске WB (с 09.03.2026); средний остаток — среднее по дням остатка на складах WB (с 11.12.2025); оборачиваемость — средний остаток / продажи в день. Красным — вне цели. Строки — в порядке списка ПЭО.</p>${ms.some(ncY) ? `<p class="hint"><b>Почему «несопоставимо».</b> ${NC_WHY}</p>` : ''}<div class="c"></div>`);
    const red = (v, lim, fmt) => v == null ? '—' : v > lim ? `<span class="neg"><b>${fmt(v)}</b></span>` : fmt(v);
    const cols = [{ key: 'n', label: '№' }, { key: 'nm', label: 'ID WB' }, { key: 'art', label: 'Артикул', txt: true }, { key: 'name', label: 'Наименование', txt: true }, { key: 'tm', label: 'Марка', txt: true }];
    ms.forEach(x => {
      const gp = mlf(x);
      const nc = ncY(x);
      cols.push({ key: 'p' + x, group: gp, label: `Факт ${+x.slice(0, 4) - 1}`, ...(nc ? { html: () => NC } : { fmt: F.int }) }, { key: 'f' + x, group: gp, label: `Факт ${x.slice(0, 4)}`, fmt: F.int },
        { key: 'y' + x, group: gp, label: 'г/г', html: r => nc ? NC : yoyHtml(r['f' + x], r['p' + x]), sortVal: r => r['y' + x] },
        { key: 'd' + x, group: gp, label: 'ДРР', fmt: F.pct }, { key: 's' + x, group: gp, label: 'Позиция', html: r => red(r['s' + x], T.pos, v => nf1.format(v)), sortVal: r => r['s' + x] },
        { key: 'a' + x, group: gp, label: 'Ср. остаток', fmt: F.int }, { key: 't' + x, group: gp, label: 'Об-ть, дн', html: r => red(r['t' + x], T.turnover, F.int), sortVal: r => r['t' + x] });
    });
    const total = { n: '', nm: '', art: '', name: 'Итого', tm: '' };
    ms.forEach(x => {
      const py = shiftY(x, -1), s = k => rows.reduce((t, r) => t + (l1g(x, r.nm, k) || 0), 0);
      total['f' + x] = sumF([x]); total['p' + x] = ncY(x) ? null : sumF([py]); total['y' + x] = yoy(total['f' + x], total['p' + x]);
      total['d' + x] = div(s('ad_cost'), s('ad_orders_rub')); total['a' + x] = s('avg_stock'); total['t' + x] = s('qty') > 0 ? s('avg_stock') / (s('qty') / daysIn(x)) : null;
      const ps = rows.map(r => r['s' + x]).filter(v => v != null); total['s' + x] = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
    });
    table(pt.querySelector('.c'), { sort: 'n', dir: 1, rows, total, maxH: 720, cols });
    const ch = L1.items.filter(it => it.status === 'обновили');
    if (ch.length) {
      const pc = panel(`<h2>Изменения списка</h2><p class="hint">${ch.length} из ${L1.items.length} мест заменены. Слева — что было, справа — что стало.</p><div class="c"></div>`);
      table(pc.querySelector('.c'), { sort: 'n', dir: 1, maxH: 420, rows: ch.map(it => ({ n: it.pos, onm: it.old_nm || '—', oname: it.old_name || '—', nm: it.nm || '—', name: it.name || '(пустое место)' })), cols: [
        { key: 'n', label: '№' }, { key: 'onm', label: 'Было: ID WB' }, { key: 'oname', label: 'Было: наименование', txt: true },
        { key: 'nm', label: 'Стало: ID WB' }, { key: 'name', label: 'Стало: наименование', txt: true }] });
    }
  }

  // ============================================================ AVAILABILITY
  function pageStock() {
    const mp = S.stockMp;
    const f = $('#filters');
    f.append(seg('Площадка', [{ v: 'WB', l: 'Wildberries', dot: CH.WB.color }, { v: 'OZON', l: 'OZON', dot: CH.OZON.color }], mp, v => { S.stockMp = v; set(); }));
    prodSlicers(f, ST.items.filter(r => r[0] === mp).map(r => r[1]), 'codes', ['tm', 'mgroup', 'motiv']);
    f.append(multi('cover', 'Запас', [{ v: 'zero', l: 'Нет остатка' }, { v: 'lt7', l: 'Меньше 7 дней' }, { v: 'w2', l: '7–14 дней' }, { v: 'm3', l: '14–90 дней' }, { v: 'gt90', l: 'Больше 90 дней' }, { v: 'nosale', l: 'Нет продаж' }]));
    f.append(segF('our', 'Наш склад', [{ v: 'yes', l: 'Есть' }, { v: 'no', l: 'Нет' }]));
    resetBtn(f);
    head('Наличие на складах маркетплейсов', mp === 'WB' ? 'Остатки WB по дням (с 11.12.2025), заказы — воронка WB за 28 дней, позиция в поиске — аналитика WB (с 09.03.2026).' : 'Остатки OZON FBO по дням (с 08.02.2026), «доступно к продаже». Продажи в день — оценка OZON.');
    const lastM = prevYm(curYm), fl = flt(), covS = fv('cover'), ourS = fv('our');
    const rev = new Map(); SL.sku.forEach(r => { if (SL.months[r[0]] === lastM && r[1] === mp) rev.set(r[2], (rev.get(r[2]) || 0) + r[3]); });
    const posM = new Map(); ST.search.forEach(r => { if (r[0] === lastM) posM.set(r[1], r[2]); });
    const all = ST.items.filter(r => r[0] === mp && codeOk(fl, r[1])).map(r => ({ code: CODE[r[1]], name: CA[r[1]] ? CA[r[1]][0] : '', tm: codeTm(r[1]), stock: r[2], day: r[3], cover: r[4], in30: r[5], our: r[6], rev: rev.get(r[1]) || 0, pos: posM.get(r[1]) }));
    const covOf = r => !(r.day > 0) ? 'nosale' : r.stock === 0 ? 'zero' : r.cover < 7 ? 'lt7' : r.cover < 14 ? 'w2' : r.cover <= 90 ? 'm3' : 'gt90';
    const items = all.filter(r => (!covS || covS.has(covOf(r))) && (!ourS || ourS.has(r.our > 0 ? 'yes' : 'no')));
    const sold = all.filter(r => r.day > 0);
    const covers = sold.filter(r => r.stock > 0 && r.cover != null).map(r => r.cover).sort((a, b) => a - b);
    kpis([
      { l: 'Остаток сейчас', v: F.int(all.reduce((s, r) => s + r.stock, 0)), u: 'шт', s: `${all.filter(r => r.stock > 0).length} позиций с остатком` },
      { l: 'Нет остатка при продажах', v: F.int(sold.filter(r => r.stock === 0).length), s: `из них есть на нашем складе: ${sold.filter(r => r.stock === 0 && r.our > 0).length}` },
      { l: 'Запас меньше 7 дней', v: F.int(sold.filter(r => r.stock > 0 && r.cover != null && r.cover < 7).length), s: 'остаток / продажи в день' },
      { l: 'Медиана запаса', v: covers.length ? F.int(covers[Math.floor(covers.length / 2)]) : '—', u: 'дн', s: 'по продающимся позициям с остатком' },
      { l: 'Выручка без остатка', v: F.mln(sold.filter(r => r.stock === 0).reduce((s, r) => s + r.rev, 0)), u: 'млн', s: `продажи этих позиций за ${MONF[+lastM.slice(5) - 1]}` },
    ]);
    const ser = ST.series[mp];
    const ps = panel('<h2>Остаток на складах маркетплейса, тыс. шт</h2><p class="hint">Все позиции площадки. Дни без загрузки данных показаны разрывом линии.</p><div class="c"></div>');
    Charts.line(ps.querySelector('.c'), { labels: ser.days.map(d => d.slice(8) + '.' + d.slice(5, 7)), tipLabels: ser.days.map(d => d.split('-').reverse().join('.')), yFmt: v => nf0.format(v / 1000), tipFmt: v => F.int(v) + ' шт', height: 190, series: [{ name: 'Остаток', color: CH[mp].color, values: ser.stock.map(v => v || null) }] });
    const pt = panel(`<h2>Позиции</h2><p class="hint">Сортировка по выручке за ${mlf(lastM)}. «Наш склад» — остаток на складах № 1, 2а, 2б, 2в суммарно на ${(M.our_stock_date || '').split('-').reverse().join('.')}; у позиций без остатка на МП: <span class="pill warn">есть у нас — не отгружено</span> <span class="pill bad">нет и у нас</span>. Запас: <span class="pill bad">меньше 7 дней</span> <span class="pill warn">7–14</span> <span class="pill ok">14–90</span> <span class="pill info">больше 90</span></p><div class="c"></div>`);
    const coverPill = r => !(r.day > 0) ? '<span class="muted">нет продаж</span>' : r.stock === 0 ? '<span class="pill bad">нет остатка</span>' : r.cover == null ? '—' : `<span class="pill ${r.cover < 7 ? 'bad' : r.cover < 14 ? 'warn' : r.cover <= 90 ? 'ok' : 'info'}">${F.int(r.cover)} дн</span>`;
    table(pt.querySelector('.c'), { sort: 'rev', rows: items, limit: 400, cols: [
      { key: 'code', label: 'Код' }, { key: 'name', label: 'Наименование', txt: true }, { key: 'tm', label: 'Марка', txt: true },
      { key: 'rev', label: 'Выручка, ₽', fmt: F.rub }, { key: 'stock', label: 'Остаток на МП, шт', fmt: F.int },
      { key: 'our', label: 'Наш склад, шт', title: 'Склад № 1 + 2а + 2б + 2в', html: r => r.stock === 0 && r.day > 0 ? `<span class="pill ${r.our > 0 ? 'warn' : 'bad'}">${F.int(r.our)}</span>` : F.int(r.our) },
      { key: 'day', label: 'Продажи в день', fmt: v => nf1.format(v) }, { key: 'cover', label: 'Запас', html: coverPill },
      { key: 'in30', label: 'Дней с наличием, 30 дн', fmt: F.pct }].concat(mp === 'WB' ? [{ key: 'pos', label: `Позиция в поиске, ${MON[+lastM.slice(5) - 1]}`, fmt: v => v == null ? '—' : nf1.format(v) }] : []) });
    // share of in-stock days by brand and month
    const mm = new Map(), mset = new Set();
    ST.monthly.forEach(r => { if (r[1] !== mp || !codeOk(fl, r[2])) return; const tm = codeTm(r[2]); const k = tm + '|' + r[0]; mset.add(r[0]); const o = mm.get(k) || { d: 0, i: 0 }; o.d += r[3]; o.i += r[4]; mm.set(k, o); });
    const mlist = [...mset].sort(), tms = [...new Set([...mm.keys()].map(k => k.split('|')[0]))];
    const brev = new Map(); all.forEach(r => brev.set(r.tm, (brev.get(r.tm) || 0) + r.rev));
    const ph = panel('<h2>Доля дней с наличием по маркам</h2><p class="hint">Среднее по позициям марки: дни с остатком больше нуля / дни месяца с данными. Марки — по выручке за прошлый месяц.</p><div class="c"></div>');
    const heat = v => v == null ? '' : `background: color-mix(in srgb, var(--crit) ${Math.round((1 - v) * 70)}%, transparent)`;
    const hrows = tms.map(tm => ({ tm, rev: brev.get(tm) || 0, ...Object.fromEntries(mlist.map(m => { const o = mm.get(tm + '|' + m); return [m, o && o.d ? o.i / o.d : null]; })) }));
    table(ph.querySelector('.c'), { sort: 'rev', rows: hrows, limit: 60, maxH: 520, cols: [{ key: 'tm', label: 'Марка', txt: true }, { key: 'rev', label: 'Выручка, ₽', fmt: F.rub }]
      .concat(mlist.map(m => ({ key: m, label: ml(m), html: r => `<span style="display:inline-block;padding:1px 6px;border-radius:4px;${heat(r[m])}">${F.pct(r[m])}</span>` }))) });
  }

  // ============================================================ PLAN VS ACTUAL
  function pagePlan() {
    const ms = oMonths().filter(x => x >= '2026-01');
    const f = $('#filters');
    const depts = optsOf(PL.op.map(r => r[1]).concat(PL.cat_plan.map(r => r[1])).filter(Boolean));
    f.append(segF('dept', 'Подразделение', depts));
    f.append(multi('mgr', 'Менеджер', optsOf(PL.op.map(r => r[3]).filter(Boolean))));
    f.append(multi('client', 'Клиент', optsOf(PL.op.map(r => r[2] || '(без клиента)'))));
    f.append(multi('mgroup', 'Группа мотивации', optsOf(PL.cat_plan.map(r => PL.cat_group[r[2]] || NOV))));
    f.append(multi('motiv', 'Категория мотивации', optsOf(PL.cat_plan.map(r => r[2]))));
    f.append(period('o'));
    resetBtn(f);
    head('План-факт', 'План — бюджет «План Факт»: операционный план по клиентам и менеджерам и план по категориям мотивации. Факт — продажи 1С без НДС.');
    const set_ = new Set(ms), dS = fv('dept'), mS = fv('mgr'), cS = fv('client'), gS = fv('mgroup'), kS = fv('motiv');
    const dOk = d => !dS || dS.has(d);
    const opOk = r => dOk(r[1]) && (!mS || mS.has(r[3])) && (!cS || cS.has(r[2] || '(без клиента)'));
    const catOk = r => dOk(r[1]) && (!gS || gS.has(PL.cat_group[r[2]] || NOV)) && (!kS || kS.has(r[2]));
    const opMs = ms.filter(x => PL.op.some(r => r[0] === x));
    const fact = salesBy(opMs, r => r.p.name, { all: true });
    const plan = new Map(), mgr = new Map();
    PL.op.forEach(r => { if (!set_.has(r[0]) || !opOk(r)) return; const k = r[2] || '(без клиента)'; plan.set(k, (plan.get(k) || 0) + r[4]); const s = mgr.get(k) || new Set(); if (r[3]) s.add(r[3]); mgr.set(k, s); });
    const deptOf = n => (SL.partners.find(p => p.name === n) || {}).dept || (PL.op.find(r => r[2] === n) || [])[1] || '';
    const keys = new Set([...plan.keys(), ...[...fact.keys()].filter(k => dOk(deptOf(k)) && (!cS || cS.has(k)) && (!mS || plan.has(k)))]);
    const rows = [...keys].map(k => ({ k, dept: deptOf(k), mgr: [...(mgr.get(k) || [])].join(', '), plan: plan.get(k) || 0, fact: (fact.get(k) || { rev: 0 }).rev })).filter(r => r.plan || Math.abs(r.fact) > 1000);
    const tp = rows.reduce((s, r) => s + r.plan, 0), tf = rows.reduce((s, r) => s + r.fact, 0);
    const cp = new Map(), cf = new Map();
    PL.cat_plan.forEach(r => { if (set_.has(r[0]) && catOk(r)) cp.set(r[2], (cp.get(r[2]) || 0) + r[3]); });
    PL.cat_fact.forEach(r => { if (set_.has(r[0]) && catOk(r)) cf.set(r[2], (cf.get(r[2]) || 0) + r[3]); });
    const cpt = [...cp.values()].reduce((s, v) => s + v, 0), cft = [...cf.values()].reduce((s, v) => s + v, 0);
    kpis([
      { l: `Опер-план, ${periodLabel(opMs)}`, v: F.pct(div(tf, tp)), s: `факт ${F.mln(tf)} из ${F.mln(tp)} млн` },
      { l: `План по категориям, ${periodLabel(ms)}`, v: F.pct(div(cft, cpt)), s: `факт ${F.mln(cft)} из ${F.mln(cpt)} млн` },
    ]);
    const pc = panel(`<h2>Операционный план по клиентам</h2><p class="hint">${periodLabel(opMs)}. Менеджер — из плана; у OZON план разделен между двумя менеджерами, факт по менеджерам так не делится.</p><div class="c"></div>`);
    table(pc.querySelector('.c'), { sort: 'plan', rows, total: { k: 'Итого', plan: tp, fact: tf }, cols: [
      { key: 'k', label: 'Клиент', txt: true }, { key: 'dept', label: 'Подразделение', txt: true }, { key: 'mgr', label: 'Менеджер (план)', txt: true },
      { key: 'plan', label: 'План, ₽', fmt: F.rub }, { key: 'fact', label: 'Факт, ₽', fmt: F.rub },
      { key: 'pf', label: 'Выполнение', sortVal: r => div(r.fact, r.plan), html: r => r.plan ? `<span class="pill ${r.fact / r.plan >= 1 ? 'ok' : r.fact / r.plan >= 0.9 ? 'warn' : 'bad'}">${F.pct(r.fact / r.plan)}</span>` : '<span class="muted">нет плана</span>' }] });
    const yms = range(2026, 1, +curYm.slice(5));
    const pmn = panel('<h2>План и факт по месяцам, млн ₽</h2><div class="c"></div>');
    const factM = yms.map(x => { let v = 0; SL.rows.forEach(r => { if (SL.months[r[0]] !== x) return; const p = SL.partners[r[1]]; if (dOk(p.dept) && (!cS || cS.has(p.name))) v += r[3]; }); return v; });
    Charts.bars(pmn.querySelector('.c'), { labels: yms.map(ml), tipLabels: yms.map(mlf), yFmt: F.axisM, tipFmt: F.rubU, height: 210, series: [
      { name: 'Опер-план', color: 'var(--prev)', values: yms.map(x => PL.op.filter(r => r[0] === x && opOk(r)).reduce((s, r) => s + r[4], 0) || null) },
      { name: 'План по категориям', color: 'var(--other)', values: yms.map(x => PL.cat_plan.filter(r => r[0] === x && catOk(r)).reduce((s, r) => s + r[3], 0) || null) },
      { name: 'Факт 1С', color: 'var(--now)', values: factM }] });
    const keysC = new Set([...cp.keys(), ...cf.keys()]);
    const crow = [...keysC].map(k => ({ k, g: PL.cat_group[k] || '', plan: cp.get(k) || 0, fact: cf.get(k) || 0 })).filter(r => r.plan || Math.abs(r.fact) > 1000);
    const pcat = panel(`<h2>По категориям мотивации</h2><p class="hint">Категория товара — «(рит) Аналитика для мотивации (Общая)» из справочника ПЭО; группа — по виду фонда. Факт без категории — товары, которых нет в справочнике мотивации.</p><div class="c"></div>`);
    table(pcat.querySelector('.c'), { sort: 'plan', rows: crow, total: { k: 'Итого', plan: cpt, fact: cft }, maxH: 520, cols: [
      { key: 'g', label: 'Группа', txt: true }, { key: 'k', label: 'Категория', txt: true },
      { key: 'plan', label: 'План, ₽', fmt: F.rub }, { key: 'fact', label: 'Факт, ₽', fmt: F.rub },
      { key: 'pf', label: 'Выполнение', sortVal: r => div(r.fact, r.plan), html: r => r.plan ? `<span class="pill ${r.fact / r.plan >= 1 ? 'ok' : r.fact / r.plan >= 0.9 ? 'warn' : 'bad'}">${F.pct(r.fact / r.plan)}</span>` : '<span class="muted">нет плана</span>' }] });
  }

  // ============================================================ ABOUT THE DATA
  function pageData() {
    head('О данных', 'Откуда каждая цифра и насколько свежие данные.');
    panel(`<h2>Источники</h2><table><thead><tr><th class="txt">Источник</th><th class="txt">Граница данных</th></tr></thead><tbody>${M.sources.map(s => `<tr><td class="txt">${esc(s.label)}</td><td class="txt">${esc(s.detail)}</td></tr>`).join('')}</tbody></table>`);
    const cols = M.cascade.columns, L = M.cascade.lines.concat(M.cascade.outside);
    panel(`<h2>Каскад: какие колонки файла входят в статьи</h2><p class="hint">Одинаково для OZON, WB и прочих клиентов. Колонки, которых нет в каком-то году, считаются нулем. «ОПР 2024» и «Плановый ОПР 2025» не используются: это план, а в каскаде — факт.</p>
      <table><thead><tr><th class="txt">Статья</th><th class="txt">Колонки файла «Доходность»</th><th class="txt">Уровень</th></tr></thead><tbody>${L.map(l => `<tr class="${OUTSIDE.includes(l.id) ? 'out' : ''}"><td class="txt">${esc(l.label)}</td><td class="txt">${esc((cols[l.id] || []).join(' + '))}</td><td class="txt">${OUTSIDE.includes(l.id) ? 'не входит в каскад' : (LEVELS.find(v => v.items.includes(l.id)) || {}).label ? 'до ' + LEVELS.find(v => v.items.includes(l.id)).label : ''}</td></tr>`).join('')}</tbody></table>`);
    panel(`<h2>Файлы «Доходность»</h2><table><thead><tr><th class="txt">Год</th><th class="txt">Файл</th><th class="txt">Изменен</th><th class="txt">Последний месяц</th></tr></thead><tbody>${P.files.map(f => `<tr><td class="txt">${f.year}</td><td class="txt">${esc(f.name)}</td><td class="txt">${f.mtime.replace('T', ' ')}</td><td class="txt">${f.last_month ? mlf(f.last_month) : '—'}</td></tr>`).join('')}</tbody></table><p class="hint" style="margin-top:8px">Файлы ищутся по маске «Доходность ГГГГ*.xlsx» в папке ПЭО и перечитываются целиком при каждом изменении: ПЭО правит прошлые месяцы.</p>`);
    if (P.est_check && P.est_check.length) {
      const pe = panel(`<h2>Насколько точна оценка месяцев без файла</h2><p class="hint">Каждый закрытый месяц ${P.est_check[0][0].slice(0, 4)} года посчитан так же, как оценка (1С, начисления маркетплейсов, средние проценты остальных месяцев года), и сравнен с файлом ПЭО. Разница ВП4 в п.п. У прочих клиентов разница больше: ретро-бонусы и трейд приходят крупными суммами раз в квартал.</p><div class="c"></div>`);
      const chs = ['ALL', 'OZON', 'WB', 'OTHER'], lab = { ALL: 'Весь E-comm', OZON: 'OZON', WB: 'Wildberries', OTHER: 'Прочие клиенты' };
      const ems = [...new Set(P.est_check.map(r => r[0]))];
      const gv = (m, c) => P.est_check.find(r => r[0] === m && r[1] === c);
      table(pe.querySelector('.c'), { rows: chs.map(c => ({ n: lab[c], ...Object.fromEntries(ems.map(m => { const r = gv(m, c); return [m, r ? div(r[5], r[4]) - div(r[3], r[2]) : null]; })) })),
        cols: [{ key: 'n', label: 'ВП4: оценка − файл', txt: true, sort: false }].concat(ems.map(m => ({ key: m, label: ml(m), sort: false, html: r => `<span class="${cls(r[m])}">${F.pp(r[m])}</span>` }))) });
    }
    panel(`<h2>Журнал сборки</h2><pre style="font-size:11.5px;white-space:pre-wrap;color:var(--text-muted);margin:0">${esc(M.log.join('\n'))}</pre>`);
  }

  // ------------------------------------------------------------ render
  const RENDER = { overview: pageOverview, profit: pageProfit, brands: pageBrands, sales: pageSales, ads: pageAds, list101: pageList101, stock: pageStock, plan: pagePlan, data: pageData };
  function render() {
    if (!RENDER[S.page]) S.page = 'overview';
    MS_OPEN = null;
    nav(); $('#filters').innerHTML = ''; $('#page').innerHTML = ''; Charts.hideTip();
    try { RENDER[S.page](); layoutFilters(); cardify(); addExports(); } catch (e) { console.error(e); $('#page').innerHTML = `<div class="callout bad"><b>Ошибка страницы:</b> ${esc(e.message)}</div>`; }
  }
  let rt; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 200); });
  render();
})();
