# ---- build ----
FROM node:22-bookworm-slim AS build
RUN corepack enable && apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY api/package.json api/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY api api
COPY web web
RUN pnpm --filter @letsgo/web build && pnpm --filter @letsgo/api build

# ---- runtime ----
FROM node:22-bookworm-slim
# PostgreSQL 16 lives inside the container (unless DATABASE_URL points elsewhere), so
# Unraid's update button is all an upgrade needs. From the PostgreSQL apt repository;
# no default cluster is created: the app creates its own in /data/db on first start.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl; \
    install -d /usr/share/postgresql-common/pgdg /etc/postgresql-common/createcluster.d; \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc; \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list; \
    echo "create_main_cluster = false" > /etc/postgresql-common/createcluster.d/letsgo.conf; \
    apt-get update; \
    apt-get install -y --no-install-recommends postgresql-16; \
    apt-get purge -y curl; apt-get autoremove -y; rm -rf /var/lib/apt/lists/*
# DATA_DIR holds the database, photos, push keys and backups; DB_PATH is the old SQLite file, imported once.
ENV NODE_ENV=production PORT=3001 DATA_DIR=/data DB_PATH=/data/letsgo.sqlite PG_BIN=/usr/lib/postgresql/16/bin
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/api/dist ./api/dist
COPY --from=build /app/api/package.json ./api/package.json
COPY --from=build /app/web/dist ./web/dist
VOLUME ["/data"]
EXPOSE 3001
USER node
WORKDIR /app/api
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
