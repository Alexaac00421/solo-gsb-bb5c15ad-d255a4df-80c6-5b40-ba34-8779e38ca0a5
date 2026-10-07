# 纸品工坊 · 浏览器裁切规划台

面向小型纸品工坊的 Web 裁切排样工具：录入**原张 / 库存余料**与**订单纸片**（尺寸、数量、纹向、旋转限制）及**工艺参数**（原料白边、刀缝、可复用余料最小长宽），系统按**现有库存**自动进行**断头台式（一刀切）**排样，逐张展示排样示意、切割顺序、成品 / 废料 / 可复用余料。试排与保存**不占库存**；确认时在一个 SQLite 事务中**原子扣减原料并入库余料**，重复 / 并发确认**不会重复消耗**；库存、订单或工艺变化导致已存方案失效时**拒绝确认并提示重排**。

技术栈：**TypeScript（全栈）+ React 18 + Vite + Node.js + Express + better-sqlite3**，npm workspaces 单仓多包。

---

## 目录结构

```
.
├── Dockerfile                 # 多阶段构建（含原生模块编译 + 数据自动初始化）
├── docker-compose.yml         # 一键启动，SQLite 数据持久化到命名卷
├── package.json               # npm workspaces 根配置
└── packages/
    ├── shared/                # 排样算法 + 前后端共享类型（纯 TS，无依赖）
    │   └── src/
    │       ├── types.ts       # 领域类型
    │       ├── domain.ts      # 纹向/旋转规则、面积、内容哈希（失效检测）
    │       └── packer.ts      # 断头台式 guillotine 排样器
    ├── server/                # Express + better-sqlite3 API（生产时同时托管前端）
    │   └── src/
    │       ├── db.ts          # 建表、仓储、确认事务、示例数据初始化
    │       ├── services.ts    # 试排服务
    │       ├── validation.ts  # 入参校验
    │       └── routes/        # settings / stock / orders / plans
    └── client/                # React + Vite 前端（SVG 逐张示意与切线动画联动）
        └── src/
```

---

## 快速开始（Docker，推荐）

前置：已安装 Docker 20.10+ 与 Docker Compose v2。

```bash
# 构建镜像并后台启动（首次会编译 better-sqlite3 原生模块，约 2–4 分钟）
docker compose up -d --build

# 查看启动日志 / 健康状态
docker compose logs -f planner
```

启动后访问：

| 入口 | 地址 |
| --- | --- |
| 裁切规划台（浏览器界面） | <http://localhost:8080> |
| 健康检查 | <http://localhost:8080/api/health> |

停止与数据：

```bash
docker compose down          # 停止，保留数据（命名卷 planner-data）
docker compose down -v       # 停止并删除数据库卷（清空数据）
```

数据库文件位于卷内 `/data/planner.db`（同时生成 WAL 文件）。首次启动数据库为空时会自动建表并写入**示例库存与示例订单**（由 `SEED` 控制）。

---

## 本地开发（不用 Docker）

前置：Node.js 20+、npm 10+。若 `better-sqlite3` 需要从源码编译，另需 python3 / make / g++（Linux 构建镜像已内置）。

```bash
# 安装全部 workspace 依赖
npm install

# 方式一：前后端分别带热更新（两个终端）
npm run dev:server           # API: http://localhost:8080（tsx watch）
npm run dev:client           # Web: http://localhost:5173（/api 代理到 8080）

# 方式二：一个终端同时启动
npm run dev
```

生产模式本地运行：

```bash
npm run build                # 依次构建 shared / server / client
npm start                    # Node 服务同时托管前端与 API，访问 http://localhost:8080
```

---

## 配置项（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `8080` | 服务监听端口 |
| `DB_PATH` | `/data/planner.db` | SQLite 数据库文件路径（容器内挂载到卷） |
| `SEED` | `true` | 库为空时自动写入示例库存/订单；设为 `false` 得到空库 |
| `NODE_ENV` | `development`（镜像内为 `production`） | 运行环境 |

工艺参数（在界面「工艺参数」页维护，存入数据库单行设置）：

- **原料白边 margin (mm)**：原张四周保留边距，排样只在白边内侧进行；库存余料按无边距处理。
- **刀缝 kerf (mm)**：切刀吃掉的宽度，算法在相邻子矩形之间自动留出刀缝间隙。
- **余料最小长 / 最小宽 (mm)**：切后空区的长、宽都达到阈值才算「可复用余料」（确认后自动入库），否则计为废料。

---

## 使用流程

1. **工艺参数**：确认白边、刀缝、余料阈值。
2. **原料与余料库存**：录入原张或库存余料的名称、宽×高、纹向（无 / 沿宽 x / 沿高 y）、数量；余料也可手工补录。
3. **订单**：录入每种纸片的尺寸、数量、纹向要求、是否允许旋转 90°。
4. **裁切规划**：选择订单 → 「按当前库存试排」。
   - 顶部给出完整/非完整标记、材料与面积统计；
   - 「逐张示意」中：浅色块=成品（数字为片序，双箭头=丝缕方向，旋转片会标注）、绿色=可复用余料、棕色=废料、灰色=白边、红色虚线=切线（编号即刀序）；
   - 鼠标悬停右侧「切割顺序」条目可高亮对应切线；每一刀均贯穿当前待切子矩形。
5. **保存方案**：草稿不占库存，可反复试排保存。
6. **确认**：仅当全部纸片排入（完整方案）才可确认；确认原子完成「扣减原料 + 同规格余料合并入库 + 订单/方案置为已确认」。

---

## 关键业务规则与实现

### 排样约束（`packages/shared/src/packer.ts`）

- 排样为**断头台式两刀切分树**：放入一张纸片至多两刀（先竖后横或先横后竖），每一刀都贯穿**当前待切子矩形**的全宽或全高，任意中间布局都可由真实裁床执行。
- 成品**不重叠、不越界**（仅在白边内）；尺寸比较时在需要继续下刀的方向自动计入刀缝。
- **纹向**：纸片纹向要求必须与材料纹向重合；允许旋转时通过转 90° 让轴对齐，不允许旋转时要求原方向一致；无纹向材料/纸片不设限。成品输出实际摆放朝向与纹向。
- 材料池按面积升序、余料优先消耗；多策略（长边优先/短边优先/面积降序/宽度降序）各跑一遍，按「排入数量最多 → 消耗面积最小」取最优。
- 空区按余料阈值二分类：达标=可复用余料，未达标=废料；面积对账区分白边、刀缝间隙、废料空区。

### 库存与并发（`packages/server/src/db.ts`）

- 试排 `/preview` 与保存 `/plans` 均**不改动库存**；保存时服务端以当前库存**重新计算**后落库（不信任前端载荷）。
- 确认使用 `BEGIN IMMEDIATE` 事务 + 方案状态锁：同一方案的重复点击 / 并发请求只有一个成功，其余返回 `409 ALREADY_CONFIRMED`，**绝不重复扣料**。
- 确认前用**内容指纹**（djb2 哈希，覆盖订单纸片与工艺参数）与逐项库存快照（数量、尺寸、纹向、存在性）校验；任何变化返回 `409 PLAN_STALE` 并附带逐条原因，前端随即按当前库存重排。
- 非完整方案（有未排入纸片）返回 `400 INCOMPLETE_PLAN`，不得确认；未排入纸片区分原因：`STOCK_TOO_SMALL`（无任何材料可容纳）与 `INVENTORY_EXHAUSTED`（现有数量不足）。

### 主要 HTTP API

```
GET/PUT  /api/settings
GET/POST /api/stock                 PUT/DELETE /api/stock/:id
GET/POST /api/orders                GET/DELETE /api/orders/:id
POST     /api/plans/orders/:id/preview      # 试排（不落库）
POST     /api/plans/orders/:id/plans        # 保存草稿
GET      /api/plans/orders/:id/plans        # 草稿/方案列表
GET/DELETE /api/plans/:id
POST     /api/plans/:id/confirm             # 原子确认
```

---

## 数据初始化说明

- 表结构在服务启动时通过 `CREATE TABLE IF NOT EXISTS` 自动建立（settings、stock_items、orders、order_pieces、plans，含外键与 CHECK 约束）。
- `SEED=true`（默认）且库存表为空时写入：3 种原张、1 种库存余料，以及 1 个含 3 种纸片的示例订单，便于开箱即试。
- 需要空白环境：`SEED=false docker compose up -d --build`，或删除卷后重启。
