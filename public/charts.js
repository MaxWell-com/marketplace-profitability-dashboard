// Plain-SVG charts: lines, grouped bars, horizontal bars, waterfall.
// Series colours are passed as CSS variables (var(--ozon)); text uses theme tokens.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const tip = () => document.getElementById('tip');
  // Brand, product and series names come from the data (1C ERP, finance files), so they go into HTML escaped only.
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function showTip(html, ev) {
    const t = tip(); t.innerHTML = html; t.style.opacity = 1;
    const w = t.offsetWidth, h = t.offsetHeight;
    let x = ev.clientX + 14, y = ev.clientY + 14;
    if (x + w > window.innerWidth - 8) x = ev.clientX - w - 14;
    if (y + h > window.innerHeight - 8) y = ev.clientY - h - 14;
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }
  function hideTip() { tip().style.opacity = 0; }

  function niceScale(min, max, ticks) {
    if (min === max) { max = min + 1; }
    const span = max - min, step0 = span / Math.max(ticks, 1);
    const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(step0))));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || 10 * mag;
    const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
    const out = []; for (let v = lo; v <= hi + step / 2; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function frame(host, height) {
    host.innerHTML = '';
    const W = Math.max(host.clientWidth || 600, 280), H = height || 240;
    const svg = el('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img' }, host);
    return { svg, W, H };
  }
  function legend(host, series) {
    if (series.length < 2) return;
    const d = document.createElement('div'); d.className = 'legend';
    d.innerHTML = series.map(s => `<span><i class="${s.dash ? 'dash' : ''}" style="background:${s.color}"></i>${esc(s.name)}</span>`).join('');
    host.prepend(d);
  }
  // left margin sized for the longest axis label (full numbers are longer than abbreviated ones)
  const axisL = (ticks, fmt) => Math.max(58, Math.max(...ticks.map(t => String(fmt(t)).length)) * 6.6 + 14);
  function yAxis(svg, ticks, y, x0, x1, fmt) {
    ticks.forEach(t => {
      el('line', { x1: x0, x2: x1, y1: y(t), y2: y(t), class: t === 0 ? 'axis' : 'grid-line' }, svg);
      const tx = el('text', { x: x0 - 6, y: y(t) + 4, 'text-anchor': 'end' }, svg); tx.textContent = fmt(t);
    });
  }
  function xLabels(svg, labels, xc, y0, every) {
    labels.forEach((l, i) => {
      if (i % every && i !== labels.length - 1) return;
      const t = el('text', { x: xc(i), y: y0 + 16, 'text-anchor': 'middle' }, svg); t.textContent = l;
    });
  }

  // Lines: {labels, series:[{name,color,values,dash}], yFmt, tipFmt, height, zero}
  function line(host, o) {
    const wrap = document.createElement('div'); host.innerHTML = ''; host.appendChild(wrap);
    const chart = document.createElement('div'); host.appendChild(chart);
    legend(host, o.series);
    const { svg, W, H } = frame(chart, o.height || 230);
    const R = 14, T = 10, B = 26;
    const all = o.series.flatMap(s => s.values.filter(v => v != null && isFinite(v)));
    if (!all.length) { chart.innerHTML = '<div class="empty">Нет данных</div>'; return; }
    let mn = Math.min(...all), mx = Math.max(...all);
    if (o.zero !== false) mn = Math.min(0, mn);
    const ticks = niceScale(mn, mx, 4), L = axisL(ticks, o.yFmt);
    const n = o.labels.length, xc = i => L + (n === 1 ? (W - L - R) / 2 : i * (W - L - R) / (n - 1));
    const y = v => T + (H - T - B) * (1 - (v - ticks[0]) / (ticks[ticks.length - 1] - ticks[0]));
    yAxis(svg, ticks, y, L, W - R, o.yFmt);
    xLabels(svg, o.labels, xc, H - B, Math.ceil(n / Math.floor((W - L) / 64)));
    o.series.forEach(s => {
      let d = '', pen = false;
      s.values.forEach((v, i) => {
        if (v == null || !isFinite(v)) { pen = false; return; }
        d += (pen ? 'L' : 'M') + xc(i).toFixed(1) + ',' + y(v).toFixed(1); pen = true;
      });
      el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': s.dash ? 1.5 : 2, 'stroke-dasharray': s.dash ? '4 3' : '', 'stroke-linejoin': 'round' }, svg);
      const lastI = s.values.map((v, i) => (v != null && isFinite(v) ? i : -1)).filter(i => i >= 0).pop();
      if (lastI != null && !s.dash) el('circle', { cx: xc(lastI), cy: y(s.values[lastI]), r: 3.5, fill: s.color, stroke: 'var(--surface-1)', 'stroke-width': 2 }, svg);
    });
    const cross = el('line', { y1: T, y2: H - B, class: 'axis', opacity: 0 }, svg);
    const hit = el('rect', { x: L, y: T, width: W - L - R, height: H - T - B, fill: 'transparent' }, svg);
    hit.addEventListener('mousemove', ev => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.round((ev.clientX - r.left - L) / ((W - L - R) / Math.max(n - 1, 1)))));
      cross.setAttribute('x1', xc(i)); cross.setAttribute('x2', xc(i)); cross.setAttribute('opacity', 1);
      const rows = o.series.map(s => `<div class="tr"><span><i style="background:${s.color}"></i>${esc(s.name)}</span><b>${s.values[i] == null ? '—' : (o.tipFmt || o.yFmt)(s.values[i])}</b></div>`).join('');
      showTip(`<b>${esc(o.tipLabels ? o.tipLabels[i] : o.labels[i])}</b>${rows}`, ev);
    });
    hit.addEventListener('mouseleave', () => { cross.setAttribute('opacity', 0); hideTip(); });
  }

  // Grouped bars: {labels, series:[{name,color,values}], yFmt, height}
  function bars(host, o) {
    host.innerHTML = '';
    const chart = document.createElement('div'); host.appendChild(chart);
    legend(host, o.series);
    const { svg, W, H } = frame(chart, o.height || 230);
    const R = 10, T = 10, B = 26;
    const all = o.series.flatMap(s => s.values.filter(v => v != null && isFinite(v)));
    if (!all.length) { chart.innerHTML = '<div class="empty">Нет данных</div>'; return; }
    const ticks = niceScale(Math.min(0, ...all), Math.max(0, ...all), 4), L = axisL(ticks, o.yFmt);
    const y = v => T + (H - T - B) * (1 - (v - ticks[0]) / (ticks[ticks.length - 1] - ticks[0]));
    yAxis(svg, ticks, y, L, W - R, o.yFmt);
    const n = o.labels.length, band = (W - L - R) / n, k = o.series.length;
    const bw = Math.max(2, Math.min(28, (band - 6) / k - 2));
    const xc = i => L + band * i + band / 2;
    xLabels(svg, o.labels, xc, H - B, Math.ceil(n / Math.floor((W - L) / 56)));
    o.series.forEach((s, j) => s.values.forEach((v, i) => {
      if (v == null || !isFinite(v)) return;
      const x = xc(i) - (k * (bw + 2)) / 2 + j * (bw + 2) + 1, y0 = y(0), y1 = y(v);
      const r = el('rect', { x, y: Math.min(y0, y1), width: bw, height: Math.max(1, Math.abs(y1 - y0)), fill: s.color, rx: 2 }, svg);
      r.addEventListener('mousemove', ev => showTip(`<b>${esc(o.tipLabels ? o.tipLabels[i] : o.labels[i])}</b><div class="tr"><span><i style="background:${s.color}"></i>${esc(s.name)}</span><b>${(o.tipFmt || o.yFmt)(v)}</b></div>`, ev));
      r.addEventListener('mouseleave', hideTip);
    }));
  }

  // Horizontal bars: {items:[{label,value,color,sub}], fmt, tipFmt}
  function hbars(host, o) {
    host.innerHTML = '';
    const items = o.items; if (!items.length) { host.innerHTML = '<div class="empty">Нет данных</div>'; return; }
    const rowH = 22, H = items.length * rowH + 8;
    const { svg, W } = frame(host, H);
    const L = Math.min(190, W * 0.38), R = 70;
    const mx = Math.max(...items.map(d => Math.abs(d.value)), 1);
    items.forEach((d, i) => {
      const yy = 4 + i * rowH, w = (W - L - R) * Math.abs(d.value) / mx;
      const t = el('text', { x: L - 8, y: yy + 14, 'text-anchor': 'end', class: 'lbl' }, svg);
      t.textContent = d.label.length > 28 ? d.label.slice(0, 27) + '…' : d.label;
      const r = el('rect', { x: L, y: yy + 4, width: Math.max(1, w), height: rowH - 9, fill: d.color || 'var(--now)', rx: 2 }, svg);
      const v = el('text', { x: L + w + 6, y: yy + 14, class: 'lbl' }, svg); v.textContent = o.fmt(d.value);
      r.addEventListener('mousemove', ev => showTip(`<b>${esc(d.label)}</b><div class="tr"><span>${esc(o.name)}</span><b>${(o.tipFmt || o.fmt)(d.value)}</b></div>${d.sub || ''}`, ev));
      r.addEventListener('mouseleave', hideTip);
    });
  }

  // Cascade waterfall: {steps:[{label,value,kind:'start'|'minus'|'level'}], fmt, tipFmt, pctOf}
  function waterfall(host, o) {
    host.innerHTML = '';
    const { svg, W, H } = frame(host, o.height || 260);
    const R = 10, T = 18;
    let run = 0; const segs = [];
    o.steps.forEach(s => {
      if (s.kind === 'start') { segs.push({ ...s, a: 0, b: s.value }); run = s.value; }
      else if (s.kind === 'minus') { segs.push({ ...s, a: run, b: run - s.value }); run -= s.value; }
      else { segs.push({ ...s, a: 0, b: s.value }); run = s.value; }
    });
    const vals = segs.flatMap(s => [s.a, s.b]);
    const ticks = niceScale(Math.min(0, ...vals), Math.max(...vals), 4), L = axisL(ticks, o.fmt);
    const n = segs.length, band = (W - L - R) / n, bw = Math.min(46, band - 6);
    // Labels under the bars wrap at word boundaries so that each line fits its column
    // (width is measured with the actual font); the bottom margin is sized for the longest label.
    const meas = el('text', { x: -9999, y: -9999 }, svg);
    const textW = (str, cls) => { meas.setAttribute('class', cls); meas.textContent = str; return meas.getComputedTextLength(); };
    const wrap = (label, cls) => {
      const out = []; let cur = '';
      label.split(' ').forEach(w => { const t = cur ? cur + ' ' + w : w; if (!cur || textW(t, cls) <= band - 8) cur = t; else { out.push(cur); cur = w; } });
      if (cur) out.push(cur);
      return out;
    };
    segs.forEach(s => { s.cls = s.kind === 'minus' ? '' : 'lbl-strong'; s.lines = wrap(s.label, s.cls); });
    // A single word wider than its column (narrow screen): first shrink the label font down to 9 px;
    // if that is still not enough, stagger adjacent labels on two vertical levels.
    const over = Math.max(...segs.flatMap(s => s.lines.map(ln => textW(ln, s.cls) / (band - 4))));
    meas.remove();
    const fs = over > 1 ? Math.max(9, 11 / over) : 11, stagger = over * fs / 11 > 1.02; // text width is proportional to the font size
    const nl = Math.max(...segs.map(s => s.lines.length)), lh = Math.round(fs * 1.2);
    const B = 14 + lh * nl * (stagger ? 2 : 1) + (stagger ? 6 : 0) + 4;
    const y = v => T + (H - T - B) * (1 - (v - ticks[0]) / (ticks[ticks.length - 1] - ticks[0]));
    yAxis(svg, ticks, y, L, W - R, o.fmt);
    segs.forEach((s, i) => {
      const x = L + band * i + (band - bw) / 2, top = Math.min(y(s.a), y(s.b)), h = Math.max(1, Math.abs(y(s.a) - y(s.b)));
      const fill = s.kind === 'minus' ? 'var(--deduct)' : (s.kind === 'start' ? 'var(--now)' : (s.value >= 0 ? 'var(--level)' : 'var(--crit)'));
      const r = el('rect', { x, y: top, width: bw, height: h, fill, rx: 2 }, svg);
      if (i < n - 1 && s.kind !== 'minus') {
        el('line', { x1: x + bw, x2: x + band, y1: y(s.b), y2: y(s.b), stroke: 'var(--baseline)', 'stroke-dasharray': '2 2' }, svg);
      } else if (i < n - 1) {
        el('line', { x1: x + bw, x2: x + band, y1: y(s.b), y2: y(s.b), stroke: 'var(--baseline)', 'stroke-dasharray': '2 2' }, svg);
      }
      const ty = H - B + 14 + (stagger && i % 2 ? lh * nl + 6 : 0);
      const t = el('text', { x: x + bw / 2, y: ty, 'text-anchor': 'middle', class: s.cls, style: `font-size:${fs}px` }, svg);
      s.lines.forEach((ln, j) => { el('tspan', { x: x + bw / 2, dy: j ? lh : 0 }, t).textContent = ln; });
      if (s.kind !== 'minus') {
        const v = el('text', { x: x + bw / 2, y: top - 5, 'text-anchor': 'middle', class: 'lbl' }, svg);
        v.textContent = o.pctOf ? Math.round(s.value / o.pctOf * 100) + '%' : '';
      }
      r.addEventListener('mousemove', ev => showTip(`<b>${s.label}</b><div class="tr"><span>${s.kind === 'minus' ? 'вычитается' : 'уровень'}</span><b>${(o.tipFmt || o.fmt)(s.value)}</b></div>${o.pctOf ? `<div class="tr"><span>% выручки</span><b>${(s.value / o.pctOf * 100).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</b></div>` : ''}`, ev));
      r.addEventListener('mouseleave', hideTip);
    });
  }

  window.Charts = { line, bars, hbars, waterfall, showTip, hideTip };
})();
