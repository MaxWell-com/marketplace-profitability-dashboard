// Demo source: synthetic inputs for build(), no infrastructure required.
//
// DEMO_TODAY=YYYY-MM-DD pins the demo calendar. It defaults to a fixed date in 2026 because the
// dashboard's year selectors and plan pages are built for 2025–2026.
import { buildInputs } from '../demo/model.js';

const TODAY = process.env.DEMO_TODAY || '2026-11-18';
if (!/^2026-\d{2}-\d{2}$/.test(TODAY)) throw new Error(`DEMO_TODAY="${TODAY}" must be a YYYY-MM-DD date in 2026`);

export default {
  async loadInputs(log) {
    log(`Demo data for ${TODAY}: generating cube, DWH and finance inputs`);
    return buildInputs(TODAY);
  },
};
