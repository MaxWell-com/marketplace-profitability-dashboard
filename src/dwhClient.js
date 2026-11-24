// DWH client (MS SQL Server) - marketplace data the cube does not have:
// daily WB and Ozon stock, WB search positions and funnel, Ozon campaigns, WB campaign names (stg schema).
// Connects the same way as another internal dashboard: same server, no TLS certificate chain.
import sql from 'mssql';

export function dwhConfigured() {
  return !!(process.env.DWH_HOST && process.env.DWH_DB && process.env.DWH_USER && process.env.DWH_PASS);
}

function config() {
  return {
    server: process.env.DWH_HOST || '',
    port: Number(process.env.DWH_PORT) || 1433,
    database: process.env.DWH_DB || '',
    user: process.env.DWH_USER || '',
    password: process.env.DWH_PASS || '',
    options: { encrypt: false, trustServerCertificate: true, enableArithAbort: true },
    connectionTimeout: Number(process.env.DWH_TIMEOUT_MS) || 30000,
    requestTimeout: Number(process.env.DWH_TIMEOUT_MS) || 300000,
    pool: { max: 2, min: 0, idleTimeoutMillis: 10000 },
  };
}

// Dates arrive as Date objects (UTC midnight) - the report uses YYYY-MM-DD strings, as with the cube.
const norm = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);

/** Runs a query and returns rows as "column → value" objects. */
export async function query(text) {
  if (!dwhConfigured()) throw new Error('Не заданы DWH_HOST / DWH_DB / DWH_USER / DWH_PASS — подключение к DWH (см. .env.example)');
  const pool = new sql.ConnectionPool(config());
  try {
    await pool.connect();
    const res = await pool.request().query(text);
    return res.recordset.map((r) => {
      const o = {};
      for (const [k, v] of Object.entries(r)) o[k] = norm(v);
      return o;
    });
  } finally {
    try { await pool.close(); } catch { /* ignore */ }
  }
}
