// Live source: OLAP cube and DWH tables (src/etl/queries) plus the finance department's Excel files
// (profitability by month, product reference, list 101) from PEO_DIR.
import { extractAll } from '../etl/sources.js';
import { loadProfit, loadRefs, loadList101 } from '../etl/excel.js';

export default {
  async loadInputs(log) {
    const warnings = [];
    log('Extract: cube, DWH, finance files');
    // Required: the cube, the DWH and the profitability files. The product reference and list 101
    // complement them: the report builds without them, and the gap shows up in /api/ops/signals.
    const optional = async (label, fn, fallback) => {
      try { return await fn(); } catch (e) { warnings.push(`${label}: ${e.message}`); return fallback; }
    };
    const [t, profit, refs, list101] = await Promise.all([
      extractAll(log),
      loadProfit(log),
      optional('Справочник ПЭО «Номенклатура.xlsx»', loadRefs, new Map()),
      optional('Список 101', loadList101, []),
    ]);
    warnings.push(...profit.warnings);
    return { t, profit, refs, list101, warnings };
  },
};
