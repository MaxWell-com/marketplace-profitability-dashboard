// OLAP cube client (SSAS Tabular) - shared with another dashboard with unchanged logic: the same
// transport and the same concurrency limit, so both applications put the same load on the cube.
//
// TRANSPORT. msmdpump.dll is XMLA (SOAP) over HTTP with Basic auth.
// Native ADOMD.NET is not needed here (and would not work anyway: on non-Windows platforms
// ADOMD.NET Core cannot use the SSAS TCP transport, and there is no reason to pull .NET into the
// container). A POST plus rowset-XML parsing is enough - the parser is below, no extra dependencies.
//
// Settings via env: OLAP_URL, OLAP_USER, OLAP_PASS, OLAP_CATALOG, OLAP_TIMEOUT_MS, OLAP_MAX_RESPONSE_MB.
// The password comes only from the environment (deployment secrets or a local env file).
// Without OLAP_PASS the snapshot build fails with a clear error.
const URL_ = process.env.OLAP_URL || '';
const USER = process.env.OLAP_USER || '';
const PASS = process.env.OLAP_PASS || '';
const CATALOG = process.env.OLAP_CATALOG || '';
// The report's extracts are larger than ad-hoc queries (monthly ads and sales are large row sets)
const TIMEOUT = Number(process.env.OLAP_TIMEOUT_MS) || 300_000;
// Cube response size limit. A response far beyond the report's normal size means the query has
// cross-multiplied tables (this can happen after relationships change in the model), and a string that
// large crashes the whole Node process - instead we abort the read and only the snapshot build fails.
const MAX_BYTES = (Number(process.env.OLAP_MAX_RESPONSE_MB) || 400) * 1024 * 1024;
const NO_PASS = 'Не заданы параметры OLAP-куба: OLAP_URL, OLAP_USER, OLAP_PASS, OLAP_CATALOG (см. .env.example)';
const NS_ROWSET = 'urn:schemas-microsoft-com:xml-analysis:rowset';
function envelope(statement, catalog) {
    return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <Execute xmlns="urn:schemas-microsoft-com:xml-analysis">
      <Command><Statement><![CDATA[${statement}]]></Statement></Command>
      <Properties>
        <PropertyList>
          <Catalog>${catalog}</Catalog>
          <Format>Tabular</Format>
          <Content>SchemaData</Content>
        </PropertyList>
      </Properties>
    </Execute>
  </soap:Body>
</soap:Envelope>`;
}
const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&');
/**
 * Parses an XMLA response. The format is flat, so a full XML parser is overkill,
 * but there are two SSAS subtleties that are easy to get wrong:
 *
 *  1. A cell's TAG name is the column name with special characters XML-escaped:
 *     `Спр - Календарь[Год]` → `<Спр_x0020_-_x0020_Календарь_x005B_Год_x005D_>`.
 *     So tags contain Cyrillic - a `\w`-based regex will not match them
 *     (in JS `\w` = [A-Za-z0-9_]). The human-readable name is in the schema, in sql:field.
 *  2. The value type comes either from the schema (`type="xsd:long"` for table columns)
 *     or from the cell itself (`xsi:type="xsd:double"` for measures) - both are handled.
 */
function parseRowset(xml) {
    const fault = xml.match(/<(?:\w+:)?Fault[\s\S]*?<\/(?:\w+:)?Fault>/);
    if (fault) {
        const desc = fault[0].match(/Description="([^"]*)"/)?.[1]
            ?? fault[0].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        throw new Error(`OLAP XMLA Fault: ${unescapeXml(desc).slice(0, 500)}`);
    }
    // Schema: name="C0" … sql:field="Спр - Номенклатура[Код]" … type="xsd:double"
    const nameByTag = new Map();
    const typeByTag = new Map();
    const schemaRe = /<xsd:element[^>]*\sname="([^"]+)"[^>]*>/g;
    for (let m; (m = schemaRe.exec(xml));) {
        const tag = m[1];
        const field = m[0].match(/sql:field="([^"]*)"/)?.[1];
        const type = m[0].match(/type="([^"]*)"/)?.[1];
        if (field)
            nameByTag.set(tag, unescapeXml(field));
        if (type)
            typeByTag.set(tag, type);
    }
    const NUM_TYPE = /int|long|short|decimal|double|float/i;
    // Columns are taken FROM THE SCHEMA, not from the first row: NULL cells
    // (e.g. a measure of another fact that is empty on this row) are simply
    // absent from <row>, so deriving columns from rows could lose them entirely.
    const columns = Array.from(nameByTag.values());
    const rows = [];
    const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
    const cellRe = /<([^\s/>]+)([^>]*)>([\s\S]*?)<\/\1>/g;
    for (let rm; (rm = rowRe.exec(xml));) {
        const row = {};
        for (const c of columns)
            row[c] = null;
        for (let cm; (cm = cellRe.exec(rm[1]));) {
            const tag = cm[1];
            const name = nameByTag.get(tag) ?? tag;
            const raw = unescapeXml(cm[3]);
            const type = cm[2].match(/xsi:type="([^"]*)"/)?.[1] ?? typeByTag.get(tag) ?? '';
            row[name] = NUM_TYPE.test(type) ? Number(raw) : raw;
            if (!columns.includes(name))
                columns.push(name);
        }
        rows.push(row);
    }
    return { columns, rows };
}
// ⚠️ CONCURRENCY LIMIT. msmdpump/IIS answers "HTTP 503 Service Unavailable"
// when a single page fires a dozen queries at once (e.g. a page that builds many
// slices simultaneously). Keep at most OLAP_MAX_PARALLEL queries in flight and
// retry a 503 once after a pause - by then the cube has usually freed up.
const MAX_PARALLEL = Number(process.env.OLAP_MAX_PARALLEL) || 3;
let running = 0;
const waiting = [];
async function acquire() {
    if (running < MAX_PARALLEL) {
        running++;
        return;
    }
    await new Promise(resolve => waiting.push(resolve));
    running++;
}
function release() {
    running--;
    waiting.shift()?.();
}
/** Response body as text, at most MAX_BYTES. */
async function readLimited(res, ctrl) {
    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
        size += chunk.length;
        if (size > MAX_BYTES) {
            ctrl.abort();
            throw new Error(`OLAP: ответ куба больше ${MAX_BYTES / 1048576} МБ (OLAP_MAX_RESPONSE_MB) - запрос, скорее всего, перемножил таблицы; проверьте связи в модели куба`);
        }
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}
async function post(statement, catalog) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
    try {
        const res = await fetch(URL_, {
            method: 'POST',
            signal: ctrl.signal,
            headers: {
                'Content-Type': 'text/xml; charset="utf-8"',
                SOAPAction: '"urn:schemas-microsoft-com:xml-analysis:Execute"',
                Authorization: `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`,
            },
            body: envelope(statement, catalog),
        });
        const text = await readLimited(res, ctrl);
        if (!res.ok)
            throw new Error(`OLAP HTTP ${res.status}: ${text.slice(0, 300)}`);
        return text;
    }
    finally {
        clearTimeout(timer);
    }
}
/** Runs a DAX query against the cube. Returns rows as "column name → value" objects. */
export async function dax(statement, catalog = CATALOG) {
    if (!URL_ || !USER || !PASS || !CATALOG)
        throw new Error(NO_PASS);
    await acquire();
    try {
        try {
            return parseRowset(await post(statement, catalog)).rows;
        }
        catch (e) {
            if (!/HTTP 50[0-9]/.test(String(e?.message)))
                throw e;
            await new Promise(r => setTimeout(r, 1500));
            return parseRowset(await post(statement, catalog)).rows;
        }
    }
    finally {
        release();
    }
}
/** Escapes a DAX string literal (double quotes are doubled). */
export const daxStr = (s) => `"${String(s).replace(/"/g, '""')}"`;
/** A literal list for filters: {"a","b"} - for TREATAS/IN. */
export const daxList = (values) => `{${values.map(daxStr).join(',')}}`;
/** Short column name: 'Спр - Номенклатура[Код]' → 'Код'; '[# Выручка]' → '# Выручка'. */
export function shortName(col) {
    const m = col.match(/\[([^\]]+)\]\s*$/);
    return m ? m[1] : col;
}
/** Whether the cube is reachable (for the "data from cube" badge and graceful degradation of sections). */
export async function olapHealth() {
    try {
        await dax('EVALUATE ROW("ok", 1)');
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: String(e?.message ?? e).slice(0, 200) };
    }
}
