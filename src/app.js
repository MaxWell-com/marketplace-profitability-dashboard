// Marketplace profitability dashboard — Express application.
//
// The server builds a data snapshot itself (src/snapshot.js → src/etl/build.js) from the inputs of
// the selected data source (src/dataSource.js: demo generator, or OLAP cube + DWH + finance files) and
// serves it to the single-page dashboard in public/ as /data/<name>.json. No client-side build.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { requireAuth, hasTeam } from './auth.js';
import { getSnapshot, cachedSnapshot } from './snapshot.js';
import { renderBuilding, renderError, renderForbidden } from './view.js';

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
// Comma-separated groups allowed to view the report; any one is enough. Empty (default) — open access.
const REQUIRED_TEAMS = (process.env.REQUIRED_TEAM || '').split(',').map((t) => t.trim()).filter(Boolean);
// Snapshot TTL. The cube is reprocessed once a day (early morning), while marketplace stock
// and the finance files change during the day, so the snapshot is refreshed more often.
const TTL_MS = Number(process.env.REPORT_TTL_MS) || 3 * 3600 * 1000;
// Token for the /api/ops/* service routes (the hosting platform polls them itself, without SSO).
const OPS_TOKEN = process.env.OPS_TOKEN || '';
const APP = 'marketplace-profitability-dashboard';

// Build state, for the placeholder page, /api/meta and the ops routes.
let building = null;
let buildStartedAt = null;
let lastBuildMs = null;
let lastError = null;

/** Starts a snapshot build in the background; never throws to the caller. */
export function buildInBackground() {
  if (building) return building;
  buildStartedAt = Date.now();
  building = getSnapshot()
    .then((snapshot) => { lastError = null; lastBuildMs = snapshot.buildMs; return snapshot; })
    .catch((err) => { lastError = String(err?.message ?? err); console.error('[report] снимок не собран:', err); return null; })
    .finally(() => { building = null; buildStartedAt = null; });
  return building;
}

/** The snapshot is stale and due for a rebuild (the old one is still served until the new one is ready). */
const isStale = (snapshot) => Date.now() - snapshot.at >= TTL_MS;

/** Rebuilds a missing or stale snapshot in the background (called by the server's timer). */
export function refreshIfStale() {
  const s = cachedSnapshot();
  if (!building && (!s || isStale(s))) buildInBackground();
}

export function createApp() {
    const app = express();
    app.disable('x-powered-by');
    app.use(express.json());

  // --- Service routes: no SSO, registered before requireAuth ------------------------------

  // Health check. Deployments are gated on it. Deliberately touches neither the cube nor the snapshot.
  app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

  function requireOpsToken(req, res, next) {
    if (!OPS_TOKEN) return res.status(503).json({ error: 'OPS_TOKEN не задан' });
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (token !== OPS_TOKEN) return res.status(401).json({ error: 'Неверный токен' });
    next();
  }

  // Platform ops contract: generatedAt, overall, jobs. kind: "pipeline" — the snapshot rebuilds itself
  // on TTL and there is no schedule to manage, hence no enabled/schedule/history fields.
  app.get('/api/ops/etl', requireOpsToken, (_req, res) => {
    const snapshot = cachedSnapshot();
    const stale = snapshot ? isStale(snapshot) : null;
    res.json({
      app: APP,
      generatedAt: new Date().toISOString(),
      overall: lastError ? 'critical' : !snapshot || stale ? 'warning' : 'ok',
      jobs: [{
        id: 'ecomm-snapshot',
        label: 'Снимок отчета: OLAP-куб, DWH, файлы ПЭО «Доходность»',
        kind: 'pipeline',
        running: !!building,
        lastRun: {
          startedAt: buildStartedAt ? new Date(buildStartedAt).toISOString() : null,
          finishedAt: snapshot ? new Date(snapshot.at).toISOString() : null,
          status: lastError ? 'error' : snapshot ? 'ok' : 'idle',
          durationMs: lastBuildMs,
          error: lastError,
        },
        stale,
        ttlMs: TTL_MS,
        coverage: snapshot?.meta ?? null,
      }],
    });
  });

  const SIGNAL_ID = (code) => `${APP}:${code}`;

  app.get('/api/ops/signals', requireOpsToken, (_req, res) => {
    const snapshot = cachedSnapshot();
    const now = new Date().toISOString();
    const signals = [];
    const push = (code, severity, category, title, detail) => signals.push({ id: SIGNAL_ID(code), severity, category, title, detail, detectedAt: now });
    if (lastError) push('snapshot_failed', 'critical', 'snapshot', 'Снимок отчета не собран', lastError);
    if (!snapshot) {
      push('no_snapshot', building ? 'info' : 'critical', 'snapshot', building ? 'Снимок собирается' : 'Снимка еще нет',
        building ? 'Первая сборка после старта контейнера — отчет откроется, когда она закончится.' : 'Отчет не может быть показан: снимок не собран и сборка не идет.');
    } else {
      const ageMs = Date.now() - snapshot.at;
      if (ageMs >= TTL_MS * 2) {
        push('snapshot_stale', 'warning', 'freshness', `Данные не обновлялись ${Math.round(ageMs / 3600000)} ч`,
          `Снимок собран ${new Date(snapshot.at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}, TTL ${Math.round(TTL_MS / 3600000)} ч.`);
      }
      // The product reference, list 101 and newer file columns are optional inputs: the report builds
      // without them, but some slices or a page will be incomplete, and that must be visible externally.
      for (const [i, w] of (snapshot.meta?.warnings || []).entries()) push(`source_warning_${i}`, 'warning', 'sources', 'Источник прочитан не полностью', w);
      // Profitability files: more than one estimated month means the file has not been updated for a while.
      if ((snapshot.meta?.estMonths || []).length > 1) {
        push('profit_lag', 'info', 'freshness', 'Файл «Доходность» отстает',
          `Месяцы без файла ПЭО показываются оценкой: ${snapshot.meta.estMonths.join(', ')}. Последний месяц в файле: ${snapshot.meta.profitLast}.`);
      }
    }
    const overall = signals.some((s) => s.severity === 'critical') ? 'critical' : signals.some((s) => s.severity === 'warning') ? 'warning' : 'ok';
    res.json({ app: APP, generatedAt: now, overall, signals });
  });

  // --- Authenticated users only from here: identity comes from the platform SSO headers ---

  app.use(requireAuth);
  // Revenue, cost and profitability by client: optionally restricted to SSO groups (REQUIRED_TEAM).
  if (REQUIRED_TEAMS.length) {
    app.use((req, res, next) => {
      if (hasTeam(req.user, REQUIRED_TEAMS)) return next();
      if ((req.headers.accept || '').includes('text/html')) return res.status(403).type('html').send(renderForbidden(REQUIRED_TEAMS.join(', '), req.user?.email));
      return res.status(403).json({ error: `Нужна команда ${REQUIRED_TEAMS.join(' или ')}` });
    });
  }

  app.get('/', (_req, res) => {
    const snapshot = cachedSnapshot();
    if (!snapshot) {
      buildInBackground();
      if (lastError) return res.status(200).type('html').send(renderError(lastError));
      return res.status(200).type('html').send(renderBuilding({
        startedAt: buildStartedAt, elapsedSec: buildStartedAt ? (Date.now() - buildStartedAt) / 1000 : 0,
      }));
    }
    if (isStale(snapshot)) buildInBackground();
    res.set('Cache-Control', 'no-cache').sendFile(path.join(PUBLIC, 'index.html'));
  });

  // Page data from the snapshot: pre-compressed, served gzipped when the browser accepts it.
  app.get('/data/:name.json', (req, res) => {
    const snapshot = cachedSnapshot();
    if (!snapshot) return res.status(503).json({ error: 'Снимок еще собирается' });
    const f = snapshot.files[req.params.name];
    if (!f) return res.status(404).json({ error: 'Нет таких данных' });
    res.set({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache', Vary: 'Accept-Encoding' });
    if ((req.headers['accept-encoding'] || '').includes('gzip')) return res.set('Content-Encoding', 'gzip').send(f.gz);
    res.send(f.json);
  });

  app.use(express.static(PUBLIC, { index: false, maxAge: 0 }));

  // Snapshot metadata: coverage, build time and state, without downloading the data itself.
  app.get('/api/meta', (_req, res) => {
    const snapshot = cachedSnapshot();
    res.json({
      ok: !!snapshot,
      meta: snapshot?.meta ?? null,
      builtAt: snapshot ? new Date(snapshot.at).toISOString() : null,
      stale: snapshot ? isStale(snapshot) : null,
      building: !!building,
      error: lastError,
    });
  });

  // Forced rebuild. Responds immediately: the build runs in the background and its state is visible in /api/meta.
  app.post('/api/refresh', (_req, res) => {
    buildInBackground();
    res.status(202).json({ ok: true, message: 'Пересборка снимка запущена' });
  });

  app.use((err, _req, res, _next) => {
    console.error('[app]', err);
    res.status(500).type('html').send(renderError(err?.message ?? String(err)));
  });

  return app;
}
