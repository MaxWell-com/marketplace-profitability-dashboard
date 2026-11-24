// Streaming xlsx reader with no external dependencies.
//
// The yearly profitability workbooks are very large (the unpacked sheet XML is far bigger still), so
// a sheet is never loaded into memory whole: its zip entry is inflated as a stream and split into
// <row> elements on the fly. Cached cell values (<v>) are used and formulas are not recalculated -
// the same as the former xlsx_fast.py, which was verified against openpyxl.
//
// Supports what the finance files actually use: zip (including zip64), deflate/stored,
// shared strings, inline strings, numbers. Column A of the profitability sheet is a date (Excel serial).
import fs from 'node:fs';
import zlib from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';

// ---------------------------------------------------------------- zip
async function readAt(fh, pos, len) {
  const buf = Buffer.alloc(len);
  await fh.read(buf, 0, len, pos);
  return buf;
}

async function centralDirectory(file) {
  const fh = await fs.promises.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const tailLen = Math.min(size, 65557);
    const tail = await readAt(fh, size - tailLen, tailLen);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error(`${file}: не zip-архив (нет конца центрального каталога)`);
    let count = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
    if (cdOff === 0xffffffff || count === 0xffff) {
      // zip64: the locator before the EOCD points to the zip64 EOCD record
      const loc = e - 20;
      const z64off = Number(tail.readBigUInt64LE(loc + 8));
      const z = await readAt(fh, z64off, 56);
      count = Number(z.readBigUInt64LE(32)); cdSize = Number(z.readBigUInt64LE(40)); cdOff = Number(z.readBigUInt64LE(48));
    }
    const cd = await readAt(fh, cdOff, cdSize);
    const entries = new Map();
    for (let p = 0, n = 0; n < count && p < cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      let comp = cd.readUInt32LE(p + 20), uncomp = cd.readUInt32LE(p + 24);
      const nameLen = cd.readUInt16LE(p + 28), extraLen = cd.readUInt16LE(p + 30), commentLen = cd.readUInt16LE(p + 32);
      let off = cd.readUInt32LE(p + 42);
      const name = cd.toString('utf8', p + 46, p + 46 + nameLen);
      // zip64 extra field: values come in the order uncomp, comp, offset - only those equal to 0xFFFFFFFF
      let x = p + 46 + nameLen;
      const xEnd = x + extraLen;
      while (x + 4 <= xEnd) {
        const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
        if (id === 0x0001) {
          let q = x + 4;
          if (uncomp === 0xffffffff) { uncomp = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (comp === 0xffffffff) { comp = Number(cd.readBigUInt64LE(q)); q += 8; }
          if (off === 0xffffffff) { off = Number(cd.readBigUInt64LE(q)); }
        }
        x += 4 + len;
      }
      entries.set(name, { method, comp, uncomp, off });
      p += 46 + nameLen + extraLen + commentLen;
    }
    // each entry's data starts after its local file header
    for (const ent of entries.values()) {
      const h = await readAt(fh, ent.off, 30);
      ent.data = ent.off + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
    }
    return entries;
  } finally {
    await fh.close();
  }
}

// ---------------------------------------------------------------- xml
const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
export const unescapeXml = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e) => (
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e])));

function parseSharedStrings(xml) {
  const out = [];
  let p = 0;
  for (;;) {
    const a = xml.indexOf('<si', p);
    if (a < 0) break;
    const b = xml.indexOf('</si>', a);
    let si = xml.slice(xml.indexOf('>', a) + 1, b);
    if (si.indexOf('<rPh') >= 0) si = si.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
    let txt = '';
    const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
    for (let m; (m = re.exec(si));) txt += m[1];
    out.push(unescapeXml(txt));
    p = b + 5;
  }
  return out;
}

const colIdx = (letters) => { let n = 0; for (let i = 0; i < letters.length; i++) n = n * 26 + letters.charCodeAt(i) - 64; return n - 1; };
export const colLetters = (idx) => { let s = ''; for (let n = idx + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

const CELL_RE = /<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
const V_RE = /<v[^>]*>([\s\S]*?)<\/v>/;
const IS_RE = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/;

/** A single cell value as a string (as in xlsx_fast.py): shared and inline strings -> text, numbers -> their text. */
export function cellValue(attrs, inner, ss) {
  if (!inner) return '';
  if (attrs.includes('t="s"')) { const v = V_RE.exec(inner); return v ? ss[Number(v[1])] ?? '' : ''; }
  if (attrs.includes('t="inlineStr"')) { const v = IS_RE.exec(inner); return v ? unescapeXml(v[1]) : ''; }
  const v = V_RE.exec(inner);
  return v ? unescapeXml(v[1]) : '';
}

/** All cells of a row: an array indexed by column number (empty cells are ''). */
export function parseRow(rowXml, ss) {
  const out = [];
  CELL_RE.lastIndex = 0;
  for (let m; (m = CELL_RE.exec(rowXml));) out[colIdx(m[1])] = cellValue(m[2], m[3], ss);
  for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = '';
  return out;
}

/** Excel serial date -> YYYY-MM-DD. */
export function excelDate(v) {
  const n = Number(v);
  if (!v || !isFinite(n)) return v;
  return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000).toISOString().slice(0, 10);
}

// ---------------------------------------------------------------- workbook
// Active content inside a workbook: VBA macros, ActiveX, embedded OLE objects and files with
// executable extensions. The files come from a network folder edited by people, so such a
// workbook is rejected outright rather than silently skipped.
const ACTIVE = /(^|\/)vbaProject\.bin$|(^|\/)vbaData\.xml$|^xl\/activeX\/|^xl\/embeddings\/|^xl\/macrosheets\/|\.(exe|dll|com|scr|bat|cmd|ps1|vbs|vbe|js|jse|wsf|hta|msi|jar|lnk)$/i;

export async function openXlsx(file) {
  if (!/\.xlsx$/i.test(file)) throw new Error(`${file}: читаются только книги .xlsx (без макросов)`);
  const entries = await centralDirectory(file);
  const active = [...entries.keys()].filter((n) => ACTIVE.test(n));
  if (active.length) throw new Error(`${file}: в книге активное содержимое (макросы, ActiveX или встроенные объекты): ${active.slice(0, 5).join(', ')} - файл не читается`);
  const readEntry = async (name) => {
    const ent = entries.get(name);
    if (!ent) return null;
    const fh = await fs.promises.open(file, 'r');
    try {
      const raw = await readAt(fh, ent.data, ent.comp);
      return ent.method === 0 ? raw : zlib.inflateRawSync(raw);
    } finally { await fh.close(); }
  };
  const wb = (await readEntry('xl/workbook.xml')).toString('utf8');
  const rels = (await readEntry('xl/_rels/workbook.xml.rels')).toString('utf8');
  const relTarget = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = m[0].match(/\bId="([^"]+)"/)?.[1], target = m[0].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) relTarget.set(id, target);
  }
  const sheets = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unescapeXml(m[0].match(/\bname="([^"]*)"/)?.[1] ?? '').trim();
    const rid = m[0].match(/\br:id="([^"]+)"/)?.[1];
    let t = (relTarget.get(rid) || '').replace(/^\//, '');
    if (t && !t.startsWith('xl/')) t = 'xl/' + t;
    sheets.push({ name, path: t });
  }
  let ss = null;
  const sharedStrings = async () => {
    if (!ss) { const buf = await readEntry('xl/sharedStrings.xml'); ss = buf ? parseSharedStrings(buf.toString('utf8')) : []; }
    return ss;
  };

  /**
   * Streams the sheet's rows: onRow(rowXml, rowNo) for each <row>.
   * If onRow returns false, reading stops.
   */
  async function eachRow(sheetName, onRow) {
    const sh = sheets.find((s) => s.name === sheetName);
    if (!sh) throw new Error(`${file}: лист «${sheetName}» не найден, есть: ${sheets.map((s) => s.name).join(', ')}`);
    const ent = entries.get(sh.path);
    const src = fs.createReadStream(file, { start: ent.data, end: ent.data + ent.comp - 1, highWaterMark: 4 << 20 });
    const stream = ent.method === 0 ? src : src.pipe(zlib.createInflateRaw({ chunkSize: 4 << 20 }));
    const dec = new StringDecoder('utf8');
    let buf = '', rowNo = 0, stop = false;
    try {
      for await (const chunk of stream) {
        buf += dec.write(chunk);
        let p = 0;
        for (;;) {
          const a = buf.indexOf('<row', p);
          if (a < 0) break;
          const gt = buf.indexOf('>', a);
          if (gt < 0) { p = a; break; }
          if (buf[gt - 1] === '/') { // empty row <row .../>
            if (onRow('', rowNo++) === false) { stop = true; break; }
            p = gt + 1; continue;
          }
          const b = buf.indexOf('</row>', a);
          if (b < 0) { p = a; break; }
          if (onRow(buf.slice(a, b + 6), rowNo++) === false) { stop = true; break; }
          p = b + 6;
        }
        if (stop) break;
        buf = buf.slice(p);
      }
    } finally {
      src.destroy();
      if (stream !== src) stream.destroy();
    }
  }

  /** The whole sheet as an array of rows (for small reference sheets). */
  async function readSheet(sheetName, { maxEmpty = Infinity } = {}) {
    const s = await sharedStrings();
    const rows = [];
    let empty = 0;
    await eachRow(sheetName, (xml) => {
      const r = parseRow(xml, s);
      if (!r.some((v) => v !== '')) { if (++empty > maxEmpty) return false; } else empty = 0;
      rows.push(r);
      return true;
    });
    return rows;
  }

  return { sheets: sheets.map((s) => s.name), sharedStrings, eachRow, readSheet };
}
