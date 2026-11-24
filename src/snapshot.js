// Report data snapshot: load the inputs (cube and DWH tables, finance-team profitability files)
// and build the JSON served to the pages.
//
// The snapshot lives in process memory; the app has no database of its own. After a container
// restart it is rebuilt from scratch. Parsed profitability files are additionally cached in
// CACHE_DIR so that hundreds of megabytes of Excel are not re-read on every build.
import zlib from 'node:zlib';
import { getSource } from './dataSource.js';
import { build } from './etl/build.js';

let cache = null;
let inflight = null;

export const cachedSnapshot = () => cache;

/** The built snapshot; while a build is running the same promise is returned, so builds never run in parallel. */
export function getSnapshot() {
  if (!inflight) inflight = buildSnapshot().then((s) => { cache = s; return s; }).finally(() => { inflight = null; });
  return inflight;
}

async function buildSnapshot() {
  const t0 = Date.now();
  const lines = [];
  const log = (msg) => { lines.push(msg); console.log('[etl]', msg); };
  // The data source returns every input of build(): cube/DWH tables, the parsed profitability
  // files, the product reference and list 101, plus warnings about optional inputs it could not read.
  const source = await getSource();
  const { t, profit, refs, list101, warnings } = await source.loadInputs(log);
  for (const w of warnings) log(`  ${w}`);
  const { files, summary } = build({ t, profit, refs, list101, log });
  log(`Готово за ${((Date.now() - t0) / 1000).toFixed(0)} с`);
  files.meta.log = lines;
  const out = {};
  for (const [name, obj] of Object.entries(files)) {
    const json = JSON.stringify(obj);
    out[name] = { json, gz: zlib.gzipSync(json, { level: 6 }) };
  }
  return { at: Date.now(), buildMs: Date.now() - t0, files: out, meta: { ...summary, warnings, list101: list101.length, refs: refs.size } };
}
