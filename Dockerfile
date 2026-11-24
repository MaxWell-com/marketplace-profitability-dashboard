FROM node:22-alpine

WORKDIR /app

# Manifests first, for layer caching
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
# Cache of parsed profitability files (CACHE_DIR, default ./.cache) — written by the node user
RUN mkdir -p .cache && chown node:node .cache

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
USER node

# Container health check (the hosting platform also polls /health)
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 || exit 1

CMD ["node", "src/server.js"]
