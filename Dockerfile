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
# DATA_DIR holds photos and push keys; DB_PATH is only read once, to import the old SQLite database.
ENV NODE_ENV=production PORT=3001 DATA_DIR=/data DB_PATH=/data/letsgo.sqlite
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
