FROM node:20-bookworm-slim AS base

WORKDIR /app

# Install minimal OS dependencies for Chromium, curl for healthcheck & tini for zombie process reaping
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    tini \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

# Install Playwright chromium browser binaries and system libraries
RUN npx playwright install --with-deps chromium

COPY . .

# Memory-optimized runtime options
ENV NODE_ENV=production \
    NODE_OPTIONS="--expose-gc --max-old-space-size=64 --optimize-for-size" \
    PORT=3847 \
    HEADLESS=true \
    EPHEMERAL_BROWSER=true

# Expose dashboard port
EXPOSE 3847

# Healthcheck probing /healthz endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:3847/healthz || exit 1

# Use tini as PID 1 to reap zombie Chromium child processes and cleanly handle signals
ENTRYPOINT ["/usr/bin/tini", "--"]

# Start unified background daemon + web dashboard
CMD ["node", "daemon/server.js", "--with-scheduler", "--no-open"]
