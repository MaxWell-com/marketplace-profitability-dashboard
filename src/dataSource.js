// Data source selection — the single place in the app where it happens.
//
//   DATA_SOURCE=demo (default) — synthetic order book for the fictional manufacturer NORD,
//                                no infrastructure required (src/demo);
//   DATA_SOURCE=olap           — live OLAP cube (SSAS Tabular, DAX over HTTP-XMLA),
//                                configured via environment variables (see .env.example).
//
// Both sources implement one interface (src/sources/*.js). Every method returns raw rows in the
// shape of a cube response; the dashboard normalises them itself (mart.normalize / weekAxis):
//   calendar()                       → period slicer values (year, month, week)
//   kpi(f)                           → one row: the four measures for the current slice
//   weeks(f)                         → measures by week fragment (year, week number, week start)
//   sku(f)                           → measures by SKU with its attributes (mart.SKU_ATTRS)
//   partners(f)                      → measures by division × partner
//   detailTop(f, topN)               → top-N division × partner × brand × sub-brand × SKU by deficit
//   skuByMonth(f, codes)             → measures by SKU × year × month for the listed SKU codes
//   slicerNomenclature(f)            → SKU attributes with demand in the period (filter lists)
//   slicerPartners(f)                → division × partner with demand in the period
//   lastUpdate()                     → Date of the last data refresh, or null
//   today()                          → the source's "today" (the demo can be pinned to a date)
// The source module is loaded lazily: in demo mode the cube client is never imported.
const SOURCES = {
  demo: () => import('./sources/demo.js'),
  olap: () => import('./sources/olap.js'),
};

export const DATA_SOURCE = (process.env.DATA_SOURCE || 'demo').trim().toLowerCase();
if (!SOURCES[DATA_SOURCE]) {
  throw new Error(`DATA_SOURCE="${DATA_SOURCE}" is not supported; allowed: ${Object.keys(SOURCES).join(', ')}`);
}

let loading = null;
/** The data source selected by DATA_SOURCE. */
export function getSource() {
  loading ??= SOURCES[DATA_SOURCE]().then((m) => m.default);
  return loading;
}
