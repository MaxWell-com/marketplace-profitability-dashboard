// Files of the finance department (ПЭО) from the PEO_DIR folder (a shared network folder; mounted into
// the container):
//
//   «Доходность ГГГГ*.xlsx»          - E-comm rows with the cascade measures (profitability pages, ВП1-ВП4);
//   «Номенклатура.xlsx»              - trade mark, motivation category and group by product code;
//   «101 и ТМ отчеты квартал.xlsx»   - list 101 (sheet «101 new», right-hand "after" part).
//
// Profitability files are matched by a year mask, not an exact name (a file may be called e.g.
// «Доходность 2026 (правки).xlsx»). The finance department revises past months, so a file is re-read in
// full as soon as its size or modification time changes; otherwise the parsed copy is taken from the cache
// (in memory and in CACHE_DIR, if that folder is writable).
import fs from 'node:fs';
import path from 'node:path';
import { openXlsx, parseRow, colLetters, excelDate } from './xlsxReader.js';
import { LINES, OUTSIDE, IGNORED, channel } from './cascade.js';

const MASK = /^Доходность (\d{4}).*\.xlsx$/i;
const DIMS = ['Дата', 'Подразделение', 'Контрагент', '(рит) вид фонда', 'Код', 'Клиент', 'Номенклатура'];
const SERVICE = new Set(['Месяц', 'Квартал', 'Год', 'Сцепка', 'Отсрочка', 'Сцепка %%', 'Сцепка е-сомм', 'Сцепка СКК']);
const CACHE_DIR = process.env.CACHE_DIR || path.join(process.cwd(), '.cache');
const VERSION = 1; // bump when parsing changes - the old cache is then re-read

export function peoDir() {
  const dir = process.env.PEO_DIR;
  if (!dir) throw new Error('Не задан PEO_DIR - папка ПЭО с файлами «Доходность», «Номенклатура.xlsx» и «101 и ТМ отчеты квартал.xlsx»');
  if (!fs.existsSync(dir)) throw new Error(`Папка ПЭО недоступна: ${dir}`);
  return dir;
}

const memCache = new Map();
function cacheGet(key, sig) {
  const m = memCache.get(key);
  if (m && m.sig === sig) return m.value;
  try {
    const d = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, key + '.json'), 'utf8'));
    if (d.sig === sig) { memCache.set(key, d); return d.value; }
  } catch { /* no cache */ }
  return null;
}
function cachePut(key, sig, value) {
  memCache.set(key, { sig, value });
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, key + '.json'), JSON.stringify({ sig, value }));
  } catch { /* the on-disk cache is optional */ }
}
const sigOf = (st) => `${VERSION}|${st.size}|${st.mtimeMs}`;

/** The source folder should hold only the report's workbooks - anything else is reported as a warning. */
function foreignFiles(dir) {
  return fs.readdirSync(dir)
    .filter((n) => !n.startsWith('~$') && !MASK.test(n) && n !== 'Номенклатура.xlsx' && n !== '101 и ТМ отчеты квартал.xlsx')
    .map((n) => `В папке ПЭО посторонний файл «${n}» - отчет его не читает, проверьте и уберите`);
}

/** The most recent profitability file for each year. */
function findProfitFiles(dir) {
  const found = new Map();
  for (const name of fs.readdirSync(dir)) {
    const m = MASK.exec(name);
    if (!m || name.startsWith('~$')) continue;
    const p = path.join(dir, name), st = fs.statSync(p), y = Number(m[1]);
    if (!found.has(y) || st.mtimeMs > found.get(y).st.mtimeMs) found.set(y, { name, path: p, st });
  }
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([year, f]) => ({ year, ...f }));
}

const toNum = (v) => { if (v === '' || v == null) return 0; const n = Number(String(v).replace(',', '.')); return isFinite(n) ? n : 0; };

/** Parses one file: E-comm rows with the cascade measures. */
async function parseProfitFile(f) {
  const wb = await openXlsx(f.path);
  const ss = await wb.sharedStrings();
  const known = new Set([...LINES, ...OUTSIDE].flatMap((l) => l[2]).concat(IGNORED));
  let head = null, idx = null, divRe = null;
  const ecomm = new Set();
  ss.forEach((s, i) => { if (s.startsWith('E-comm')) ecomm.add(String(i)); });
  const rows = [], warnings = [];
  await wb.eachRow(`Доходность ${f.year}`, (xml) => {
    if (!head) {
      head = parseRow(xml, ss).map((c) => (c.trim() !== c && known.has(c.trim()) ? c.trim() : c));
      const unknown = head.filter((c) => c.trim() && !known.has(c) && !DIMS.includes(c) && !SERVICE.has(c));
      if (unknown.length) warnings.push(`Доходность ${f.year}: колонки вне описания каскада: ${unknown.join(', ')}`);
      const col = (n) => head.indexOf(n);
      idx = { date: col('Дата'), div: col('Подразделение'), client: col('Клиент'), code: col('Код'), name: col('Номенклатура'), fund: col('(рит) вид фонда'),
        meas: LINES.map(([id, , cols]) => [id, cols.map(col).filter((i) => i >= 0)]) };
      if (idx.div < 0) throw new Error(`${f.name}: нет колонки «Подразделение»`);
      divRe = new RegExp(`<c r="${colLetters(idx.div)}\\d+"[^>]*t="s"[^>]*><v>(\\d+)</v>`);
      return true;
    }
    if (!xml) return true;
    // fast pre-filter: the division is a shared string; if it is not E-comm, skip parsing the row
    const m = divRe.exec(xml);
    if (m && !ecomm.has(m[1])) return true;
    const r = parseRow(xml, ss);
    const div = r[idx.div] || '';
    if (!div.startsWith('E-comm')) return true;
    const d = r[idx.date] || '';
    const o = { ym: (/^\d+(\.\d+)?$/.test(d) ? excelDate(d) : d).slice(0, 7), division: div, client: (r[idx.client] || '').trim(),
      code: (r[idx.code] || '').trim(), name: (r[idx.name] || '').trim(), fund: (r[idx.fund] || '').trim() };
    for (const [id, cols] of idx.meas) o[id] = cols.reduce((s, i) => s + toNum(r[i]), 0);
    o.channel = channel(o.client);
    rows.push(o);
    return true;
  });
  const lastMonth = rows.filter((r) => r.rev !== 0).reduce((a, r) => (r.ym > a ? r.ym : a), '') || null;
  return { rows, warnings, lastMonth };
}

/** E-comm rows of all profitability files, plus a description of the files. */
export async function loadProfit(log) {
  const dir = peoDir();
  const files = findProfitFiles(dir);
  if (!files.length) throw new Error(`В папке ПЭО нет файлов «Доходность ГГГГ*.xlsx»: ${dir}`);
  const rows = [], info = [], warnings = [...foreignFiles(dir)];
  for (const f of files) {
    const sig = sigOf(f.st);
    let parsed = cacheGet(`profit-${f.year}`, sig);
    if (!parsed) {
      const t0 = Date.now();
      parsed = await parseProfitFile(f);
      cachePut(`profit-${f.year}`, sig, parsed);
      log(`  Доходность ${f.year}: ${f.name} -> ${parsed.rows.length} строк E-comm за ${((Date.now() - t0) / 1000).toFixed(1)} с`);
    }
    rows.push(...parsed.rows);
    warnings.push(...parsed.warnings);
    info.push({ year: f.year, name: f.name, mtime: f.st.mtimeMs, last_month: parsed.lastMonth });
  }
  return { rows, files: info, warnings };
}

/** Sheet rows with a header row -> array of "column -> value" objects (header cells are trimmed). */
function records(rows) {
  const head = rows[0].map((c) => String(c).trim());
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

/** Finance reference file «Номенклатура.xlsx»: code -> trade mark, motivation category, motivation group. */
export async function loadRefs() {
  const p = path.join(peoDir(), 'Номенклатура.xlsx');
  const sig = sigOf(fs.statSync(p));
  const cached = cacheGet('refs-motiv', sig);
  if (cached) return new Map(cached);
  const wb = await openXlsx(p);
  const nm = records(await wb.readSheet('Номенклатура вся'));
  const fund = records(await wb.readSheet('Вид фонда'));
  const grp = new Map();
  for (const r of fund) if (r['вид фонда'] !== '' && !grp.has(r['вид фонда'])) grp.set(r['вид фонда'], r['Группа аналитики для мотивации']);
  const out = new Map();
  for (const r of nm) {
    const code = String(r['Код'] ?? '').trim();
    if (r['Код'] === '' || out.has(code)) continue;
    out.set(code, { tm: r['Торговая марка'], mark: r['Марка (бренд)'], fund: r['вид фонда'], motiv: r['(рит) Аналитика для мотивации (Общая)'],
      segment: r['Аналитический сегмент'], stage: r['Этап развития'], mgroup: grp.get(r['вид фонда']) ?? '' });
  }
  cachePut('refs-motiv', sig, [...out.entries()]);
  return out;
}

/**
 * List 101 (WB cards for monthly advertising control, as in the previous report).
 * Sheet «101 new»: "before" on the left, "after" on the right, with a separator column between them
 * («Слева Было - Справа Стало», which also holds the status: unchanged / updated). The current list is the right part.
 */
export async function loadList101() {
  const p = path.join(peoDir(), '101 и ТМ отчеты квартал.xlsx');
  const wb = await openXlsx(p);
  const rows = await wb.readSheet('101 new', { maxEmpty: 50 });
  const head = rows[0].map((c) => String(c).trim());
  const mid = head.indexOf('Слева Было - Справа Стало');
  if (mid < 0) throw new Error('В листе «101 new» нет колонки «Слева Было - Справа Стало»');
  const txt = (v) => (v == null || String(v).trim() === '-' ? '' : String(v).trim());
  const out = [];
  for (const r of rows.slice(1)) {
    if (!r.slice(0, mid + 5).some((v) => v !== '' && v != null)) continue;
    const nw = r.slice(mid + 1, mid + 5), old = r.slice(0, 4);
    out.push({ pos: out.length + 1, nm_id: txt(nw[0]), art: txt(nw[1]), brand: txt(nw[2]), name: txt(nw[3]),
      status: txt(r[mid]), old_nm_id: txt(old[0]), old_art: txt(old[1]), old_name: txt(old[3]) });
  }
  return out;
}
