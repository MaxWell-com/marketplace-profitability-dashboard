// Standalone version of the report: a single HTML file with embedded data, styles, fonts and scripts.
// Opens without a server or network; the data is a snapshot taken at export time and never refreshes.
//
// Data is fetched from a running local server (npm run dev) rather than rebuilt.
//   node scripts/standalone.js                       -> server at http://localhost:$PORT (3000)
//   REPORT_URL=http://localhost:3077 node scripts/standalone.js
//
// Output (dist/ is not committed to git — it contains business figures):
//   dist/ecomm-report.html           full document: open with a double-click or send as a file
//   dist/ecomm-report.artifact.html  the same without doctype/head/body — for publishing as an Artifact
//                                    (the platform adds the document skeleton; Excel export
//                                    does not work there, so its buttons are hidden)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(ROOT, 'dist');
const BASE = process.env.REPORT_URL || `http://localhost:${process.env.PORT || 3000}`;
const NAMES = ['meta', 'profit', 'sales', 'ads', 'stock', 'plan', 'codes', 'list101'];
const TITLE = 'Единый отчет E-comm';

const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

const meta = await (await fetch(`${BASE}/api/meta`)).json().catch(() => null);
if (!meta?.ok) throw new Error(`Снимок на ${BASE} не готов: ${meta?.error ?? 'сервер не ответил'}. Запустите сервер и дождитесь сборки.`);

// Inside <script>, the text "</script>" would close the block. In JSON, "<" can only occur inside strings,
// where \u003c means the same thing.
const data = [];
for (const n of NAMES) {
  const res = await fetch(`${BASE}/data/${n}.json`);
  if (!res.ok) throw new Error(`/data/${n}.json: HTTP ${res.status}`);
  data.push(`<script type="application/json" id="data-${n}">${(await res.text()).replace(/</g, '\\u003c')}</script>`);
}

const FETCH = "await (await fetch('/data/' + n + '.json')).json()";
let app = read('app.js');
if (!app.includes(FETCH)) throw new Error('В public/app.js не найдена загрузка данных — обновите FETCH в scripts/standalone.js');
app = app.replace(FETCH, "JSON.parse(document.getElementById('data-' + n).textContent)");

const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script src='));
const scripts = (code) => `<script>\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>`;
const styles = (extra = '') => `<style>\n${read('fonts.css')}\n</style>\n<style>\n${read('app.css')}${extra}\n</style>`;
const tail = [...data, scripts(read('charts.js')), scripts(read('xlsx.js')), scripts(app)].join('\n');
const stamp = `<!-- Снимок ${meta.builtAt}, источник ${BASE} -->`;

const full = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
${stamp}
${styles()}
</head>
<body>${body}${tail}
</body>
</html>
`;
const artifact = `<title>${TITLE}</title>
${stamp}
${styles('\n.xl-btn { display: none !important; }')}
${body}${tail}
`;

fs.mkdirSync(OUT, { recursive: true });
for (const [file, text] of [['ecomm-report.html', full], ['ecomm-report.artifact.html', artifact]]) {
  fs.writeFileSync(path.join(OUT, file), text);
  console.log(`${path.join(OUT, file)}: ${(Buffer.byteLength(text) / 1048576).toFixed(1)} МБ`);
}
console.log(`Данные на ${meta.meta.today}, снимок собран ${meta.builtAt}`);
