# ---- 构建阶段：前端 + 后端 ----
FROM node:20-bookworm-slim AS build
WORKDIR /app

# better-sqlite3 在无预编译包时需要本地编译工具链
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# 先拷贝 workspace 清单与锁文件以利用缓存（npm workspaces 会把依赖提升到根 node_modules）
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN npm ci

# 拷贝源码并构建（前端产物 -> web/dist，后端产物 -> server/dist）
COPY . .
RUN npm run build

# ---- 运行阶段 ----
FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/cutting.db

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# workspace 依赖已提升到根 node_modules（含 better-sqlite3 原生模块）
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist

RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000

# 首次启动自动建表并写入种子库存
CMD ["node", "server/dist/index.js"]
