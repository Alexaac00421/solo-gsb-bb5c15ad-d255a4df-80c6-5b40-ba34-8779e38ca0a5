# syntax=docker/dockerfile:1

# ---- 构建阶段 ----
FROM node:20-bookworm-slim AS build

# better-sqlite3 需要 python3/make/g++ 从源码编译原生模块
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先复制 workspace 清单以利用 Docker 层缓存
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/

# 安装全部依赖（.npmrc 已显式指定 CC/CXX，避开包装器 cc）
RUN npm ci

# 复制源码并构建：shared → server → client
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/client packages/client
RUN npm run build

# 去掉 devDependencies，仅保留生产依赖（会触发 better-sqlite3 预编译/编译）
RUN npm prune --omit=dev

# ---- 运行阶段 ----
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/planner.db \
    SEED=true

# 原生模块运行时需要的基础库；wget 仅用于健康检查
RUN apt-get update \
  && apt-get install -y --no-install-recommends libstdc++6 wget \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 生产 node_modules（含编译好的 better_sqlite3.node）
COPY --from=build /app/node_modules ./node_modules
# 各包产物
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/client/dist ./packages/client/dist

RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

USER node
EXPOSE 8080

HEALTHCHECK --interval=20s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["node", "packages/server/dist/index.js"]
