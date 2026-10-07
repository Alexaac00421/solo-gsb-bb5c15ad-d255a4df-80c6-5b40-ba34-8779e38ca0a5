# 纸品裁切规划台（Paper Cutting Station）

为小型纸品工坊设计的浏览器裁切规划台：录入原张与库存余料、订单纸片、纹向、旋转限制及工艺参数，
系统按现有库存用**断头台式（guillotine）排料**试排，给出逐张示意、切割顺序、成品/废料/可复用余料。
试排与保存**不占用库存**；确认时在单个数据库事务内原子扣减原料并入库存余料，
重复或并发确认不会重复消耗；库存变动使旧方案失效时拒绝确认并提示重排。

## 技术栈

- 前端：TypeScript + React 18 + Vite
- 后端：TypeScript + Node.js + Express
- 数据库：SQLite（better-sqlite3，WAL 模式，数据文件持久化到卷）

## 快速启动（Docker，推荐）

需要 Docker 20.10+ 与 Docker Compose v2。

```bash
docker compose up --build -d
```

启动后访问：

- **规划台界面：http://localhost:3000**
- 健康检查：http://localhost:3000/api/health （返回当前库存版本号）

首次启动会自动建表并写入演示库存（白卡/牛皮纸/瓦楞原张及若干余料）。
停止与清理：

```bash
docker compose down          # 停止（保留数据卷）
docker compose down -v       # 停止并删除库存数据
```

## 本地开发启动

要求 Node.js 20+（better-sqlite3 会用到本地编译工具链：python3、make、g++）。

```bash
npm install                  # 安装全部 workspace 依赖

# 终端 1：启动后端（http://localhost:3000，自动建表+种子数据）
npm run dev:server

# 终端 2：启动前端开发服务器（http://localhost:5173，/api 代理到 3000）
npm run dev:web
```

- 开发模式访问地址：**http://localhost:5173**
- 生产构建：`npm run build`（先构建前端到 `web/dist`，再编译后端到 `server/dist`）
- 生产运行：`npm start`，然后访问 **http://localhost:3000**

## 配置（环境变量）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 后端 HTTP 端口（容器内固定 3000，宿主机端口在 compose 中映射） |
| `DB_PATH` | `./data/cutting.db`（开发）/ `/app/data/cutting.db`（容器） | SQLite 数据库文件路径，目录自动创建 |
| `VITE_API_TARGET` | `http://localhost:3000` | 仅开发时 Vite 代理 `/api` 的目标地址 |

修改宿主机暴露端口：编辑 `docker-compose.yml` 中 `"3000:3000"` 的左侧值，例如 `"8080:3000"`。

## 使用流程

1. **原张与余料**：录入纸名、宽/高(mm)、数量、纹向（竖纹/横纹/无要求）、类型（原张/余料）。
2. **裁切试排**：
   - 录入订单纸片：宽/高、数量、是否允许旋转 90°、纸片纹向；
   - 设置工艺参数：**原料边距**（四边不可用区）、**刀缝宽**（每刀材料损耗）、
     **余料保留最小宽/高**（剩余矩形达到该尺寸才回收入库，否则计为废料）；
   - 可勾选限定参与试排的库存（不勾选=全部库存，自动优先消耗余料）；
   - 点击“试排”：展示逐张 SVG 示意、按编号的贯穿切割顺序、成品/废料/余料统计；
   - 整单排不下时会列出**未排入纸片及原因**，结果明确标记为“非完整方案”，不可确认；
   - “保存方案”只生成草稿，不影响库存。
3. **方案列表**：
   - 草稿确认后才会在一个 SQLite 事务里：校验库存版本 → 按当前库存重算并核对 →
     扣减所用原张/余料 → 把达到保留门槛的余料入库（同规格自动合并）→ 写库存流水 → 推进库存版本；
   - 库存在此期间发生过任何变动，方案标记“已失效”，确认返回 409，需要重新试排；
   - 已确认方案幂等返回，重复点击或并发提交均不会二次扣库存；
   - 已确认方案不可删除（库存流水留存审计）。

## 排料规则（约束保证）

- 每一刀都是**贯穿当前子矩形**的整刀（垂切或横切），刀缝占用一个 `kerf` 宽度；
- 成品矩形互不重叠、不越出边距内可用区，尺寸已扣除刀缝；
- 纸片仅在“允许旋转”时才旋转；旋转后的纹向与原张纹向一起参与匹配（任一纹向为“无要求”即不限制）；
- 空闲矩形 ≥ 余料最小宽且 ≥ 最小高 → 确认后入为余料；否则计为废料；
- 排料策略：纸片按面积降序（不可旋转者优先），优先填已开板的最佳坑位，
  否则启用新板（余料优先、小面积优先），放不下则计入未排入。

## 目录结构

```
server/                 Express + better-sqlite3 后端
  src/planner.ts        断头台排料纯函数引擎（无副作用，便于测试）
  src/db.ts             建表、库存版本号、种子数据
  src/index.ts          REST API 与确认事务
  src/validation.ts     入参校验
web/                    React + Vite 前端
  src/components/       库存页 / 试排页 / 方案列表页 / SVG 逐张示意
Dockerfile              多阶段构建（含 better-sqlite3 编译工具链）
docker-compose.yml      单服务 + 数据卷 + 健康检查
data/                   运行时 SQLite 数据（自动创建，已在 .gitignore）
```

## REST API 摘要

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查 + 当前库存版本 |
| GET/POST/PUT/DELETE | `/api/stock[/:id]` | 库存增删改查（写操作推进版本） |
| POST | `/api/plans/preview` | 试排（不落库、不占库存） |
| POST | `/api/plans` | 保存草稿（服务端按当前库存重算） |
| GET | `/api/plans` / `/api/plans/:id` | 方案列表/详情（含失效标记） |
| POST | `/api/plans/:id/confirm` | 原子确认（版本校验 + 幂等键 + 扣减/回收） |
| DELETE | `/api/plans/:id` | 删除草稿 |
