// Service pages: placeholder while the snapshot is building, build error, and "access denied".
// They use the same design tokens and fonts as the dashboard itself,
// so the user does not think they have landed in a different application.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FONTS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'fonts.css');
let cachedFonts = null;
const fonts = () => (cachedFonts ??= fs.readFileSync(FONTS_PATH, 'utf-8'));

export function esc(value) {
  return String(value ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
}

function page(title, body, { refreshSec } = {}) {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refreshSec ? `<meta http-equiv="refresh" content="${refreshSec}">` : ''}
<title>${esc(title)}</title>
<style>
${fonts()}
  :root { color-scheme: light;
    --bg:#F6F3EF; --surface:#FFFFFF; --surface-2:#F8F5F1; --border:#E7E1D9; --border-strong:#CFC7BC;
    --text:#191614; --text-muted:#635C55; --text-subtle:#7A736B; --neg:#BC2417;
    --font-h:"Inter",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;
    --font-b:"Geist",system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.6 var(--font-b);
         display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; }
  .box { position:relative; overflow:hidden; max-width:620px; width:100%; padding:26px 28px;
         background:var(--surface); border:1px solid var(--border); border-radius:8px; box-shadow:0 1px 3px #14100C14; }
  .deco { position:absolute; inset:0; overflow:hidden; pointer-events:none; }
  .deco svg { position:absolute; top:-150px; right:-90px; width:520px; height:300px; opacity:.5; }
  .box > *:not(.deco) { position:relative; }
  h1 { margin:0 0 10px; font-family:var(--font-h); font-size:20px; font-weight:600; letter-spacing:-.3px; }
  p { margin:0 0 8px; color:var(--text-muted); font-size:13px; }
  .muted { font-size:12px; color:var(--text-subtle); }
  .steps { margin:14px 0 0; padding:0; list-style:none; display:flex; flex-direction:column; gap:6px; }
  .steps li { display:flex; gap:9px; align-items:flex-start; font-size:13px; color:var(--text-muted); }
  .steps li::before { content:""; flex:none; width:3px; align-self:stretch; border-radius:2px; background:var(--border-strong); }
  pre { white-space:pre-wrap; margin:14px 0 0; padding:11px 13px; background:var(--surface-2); border:1px solid var(--border);
        border-radius:6px; font:12px/1.5 Consolas,Menlo,monospace; color:var(--neg); }
</style></head><body><div class="box">
<div class="deco"><svg viewBox="0 0 520 300" preserveAspectRatio="xMaxYMin slice" aria-hidden="true">
<defs><linearGradient id="d0" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FF5C00"/><stop offset="1" stop-color="#FFB380"/></linearGradient>
<linearGradient id="d1" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#FFB380"/><stop offset="1" stop-color="#FFE7D4"/></linearGradient></defs>
<circle cx="400" cy="40" r="190" fill="none" stroke="url(#d0)" stroke-width="26" stroke-dasharray="697 497" opacity=".7" transform="rotate(-26 400 40)"/>
<circle cx="415" cy="48" r="255" fill="none" stroke="url(#d1)" stroke-width="20" stroke-dasharray="667 935" opacity=".5" transform="rotate(-42 415 48)"/>
</svg></div>
${body}</div></body></html>`;
}

/**
 * Placeholder shown during the first snapshot build (about a minute; longer after a container restart,
 * because the profitability files are re-read). The page is lightweight and reloads itself.
 * There is deliberately no progress bar: the real build progress is unknown.
 */
export function renderBuilding({ startedAt, elapsedSec }) {
  const started = startedAt ? new Date(startedAt).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' }) : null;
  return page('Отчет собирается', `
    <h1>Отчет собирается</h1>
    <p>Идет сборка данных. Обычно это занимает 1-2 минуты — страница обновится сама, закрывать ее не нужно.</p>
    <ul class="steps">
      <li>Продажи 1С, начисления и реклама маркетплейсов, план — из OLAP-куба.</li>
      <li>Остатки и позиции WB и Ozon — из DWH.</li>
      <li>Доходность, справочник номенклатуры и список 101 — из файлов ПЭО.</li>
    </ul>
    <p class="muted" style="margin-top:14px">${started ? `Сборка начата в ${esc(started)}` : 'Сборка запускается'}${
      elapsedSec ? `, прошло ${Math.round(elapsedSec)} с` : ''}. Страница обновляется каждые 10 секунд.</p>
  `, { refreshSec: 10 });
}

/** Build error: show the cause instead of a blank screen. */
export function renderError(message) {
  return page('Отчет недоступен', `
    <h1>Не удалось собрать отчет</h1>
    <p>Чаще всего это значит, что недоступен OLAP-куб, DWH или папка ПЭО с файлами «Доходность».
       Страница попробует обновиться сама через минуту.</p>
    <ul class="steps">
      <li>Проверьте параметры подключения к источникам (см. .env.example).</li>
      <li>Если ошибка держится дольше 10 минут — передайте администратору текст ниже.</li>
    </ul>
    <pre>${esc(message)}</pre>
  `, { refreshSec: 60 });
}

/** 403: the user is signed in but is not a member of a required group. */
export function renderForbidden(team, email) {
  return page('Нет доступа', `
    <h1>Нет доступа к отчету</h1>
    <p>Вы вошли${email ? ` как <b>${esc(email)}</b>` : ''}, но единый отчет E-comm открыт только участникам
       групп <b>${esc(team)}</b>.</p>
    <ul class="steps">
      <li>Запросите доступ у администратора, указав название отчета и свою почту.</li>
      <li>Если доступ выдали только что — выйдите и войдите снова, чтобы обновить группы.</li>
    </ul>
  `);
}
