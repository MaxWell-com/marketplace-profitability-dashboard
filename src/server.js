// Entry point. The app is src/app.js, the data source is src/dataSource.js
// (DATA_SOURCE=demo by default: runs without any infrastructure).
import { createApp, buildInBackground, refreshIfStale } from './app.js';
import { DATA_SOURCE } from './dataSource.js';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

createApp().listen(PORT, HOST, () => {
  console.log(`[app] data source: ${DATA_SOURCE}; listening on http://${HOST}:${PORT}`);
  // Warm-up: build the snapshot right after startup, without waiting for the first visitor.
  buildInBackground();
  // TTL refresh even without visitors: data is fresh by the start of the day, monitoring sees failures.
  setInterval(refreshIfStale, 10 * 60 * 1000).unref();
});
