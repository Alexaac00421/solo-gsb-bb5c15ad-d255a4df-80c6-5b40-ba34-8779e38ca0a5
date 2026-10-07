import express, { NextFunction, Request, Response } from 'express';
import path from 'path';
import { bumpStockVersion, getDb, getStockVersion } from './db';
import { buildPlan } from './planner';
import { Grain, PlanPayload, PlanRequest, StockItem } from './types';
import { ValidationError, validatePlanRequest, validateStockBody } from './validation';

const app = express();
app.use(express.json({ limit: '5mb' }));

const wrap = (fn: (req: Request, res: Response) => void) => (req: Request, res: Response, next: NextFunction) => {
  try {
    fn(req, res);
  } catch (e) {
    next(e);
  }
};

function loadStock(): StockItem[] {
  return getDb()
    .prepare(`SELECT id, name, width, height, quantity, grain, kind FROM stock WHERE quantity > 0 ORDER BY kind, id`)
    .all() as StockItem[];
}

function reCompute(req: PlanRequest) {
  const d = getDb();
  return buildPlan(req, loadStock(), getStockVersion(d));
}

// ---------- 健康检查 / 状态 ----------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, stockVersion: getStockVersion(getDb()) });
});

// ---------- 库存 ----------
app.get('/api/stock', wrap((_req, res) => {
  // 已扣减到 0 的记录不在操作列表显示（审计见 stock_movements）
  const rows = getDb()
    .prepare(`SELECT id, name, width, height, quantity, grain, kind, created_at FROM stock WHERE quantity > 0 ORDER BY kind, id`)
    .all();
  res.json({ items: rows, stockVersion: getStockVersion(getDb()) });
}));

app.post('/api/stock', wrap((req, res) => {
  const body = validateStockBody(req.body);
  const d = getDb();
  const info = d
    .prepare(`INSERT INTO stock(name, width, height, quantity, grain, kind) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(body.name, body.width, body.height, body.quantity, body.grain, body.kind);
  bumpStockVersion(d);
  res.status(201).json({ id: info.lastInsertRowid, stockVersion: getStockVersion(d) });
}));

app.put('/api/stock/:id', wrap((req, res) => {
  const body = validateStockBody(req.body);
  const d = getDb();
  const info = d
    .prepare(`UPDATE stock SET name=?, width=?, height=?, quantity=?, grain=?, kind=? WHERE id=?`)
    .run(body.name, body.width, body.height, body.quantity, body.grain, body.kind, req.params.id);
  if (info.changes === 0) throw new ValidationError('库存记录不存在');
  bumpStockVersion(d);
  res.json({ ok: true, stockVersion: getStockVersion(d) });
}));

app.delete('/api/stock/:id', wrap((req, res) => {
  const d = getDb();
  const info = d.prepare(`DELETE FROM stock WHERE id=?`).run(req.params.id);
  if (info.changes === 0) throw new ValidationError('库存记录不存在');
  bumpStockVersion(d);
  res.json({ ok: true, stockVersion: getStockVersion(d) });
}));

// ---------- 试排（不落库、不占库存） ----------
app.post('/api/plans/preview', wrap((req, res) => {
  const planReq = validatePlanRequest(req.body);
  res.json(reCompute(planReq));
}));

// ---------- 保存方案（草稿，不占库存） ----------
app.post('/api/plans', wrap((req, res) => {
  const body = req.body as Partial<PlanPayload>;
  if (!body || typeof body.name !== 'string' || !body.name.trim()) throw new ValidationError('方案名称必填');
  const planReq = validatePlanRequest(body.request);
  // 服务端以当前库存重新试排，防止前端结果被篡改
  const result = reCompute(planReq);
  const d = getDb();
  const version = getStockVersion(d);
  const info = d
    .prepare(`INSERT INTO plans(name, status, request_json, result_json, stock_version) VALUES (?, 'draft', ?, ?, ?)`)
    .run(body.name.trim().slice(0, 100), JSON.stringify(planReq), JSON.stringify(result), version);
  res.status(201).json({ id: info.lastInsertRowid, result, stockVersion: version });
}));

app.get('/api/plans', wrap((_req, res) => {
  const rows = getDb()
    .prepare(
      `SELECT id, name, status, stock_version, created_at, confirmed_at, result_json
       FROM plans ORDER BY id DESC LIMIT 200`,
    )
    .all() as any[];
  const currentVersion = getStockVersion(getDb());
  res.json({
    plans: rows.map((r) => {
      const result = JSON.parse(r.result_json);
      return {
        id: r.id,
        name: r.name,
        status: r.status,
        stockVersion: r.stock_version,
        currentStockVersion: currentVersion,
        stale: r.status === 'draft' && r.stock_version !== currentVersion,
        complete: result.complete,
        totals: result.totals,
        createdAt: r.created_at,
        confirmedAt: r.confirmed_at,
      };
    }),
    stockVersion: currentVersion,
  });
}));

app.get('/api/plans/:id', wrap((req, res) => {
  const d = getDb();
  const r = d.prepare(`SELECT * FROM plans WHERE id=?`).get(req.params.id) as any;
  if (!r) throw new ValidationError('方案不存在');
  const currentVersion = getStockVersion(d);
  res.json({
    id: r.id,
    name: r.name,
    status: r.status,
    stockVersion: r.stock_version,
    currentStockVersion: currentVersion,
    stale: r.status === 'draft' && r.stock_version !== currentVersion,
    request: JSON.parse(r.request_json),
    result: JSON.parse(r.result_json),
    createdAt: r.created_at,
    confirmedAt: r.confirmed_at,
  });
}));

app.delete('/api/plans/:id', wrap((req, res) => {
  const d = getDb();
  const r = d.prepare(`SELECT status FROM plans WHERE id=?`).get(req.params.id) as { status: string } | undefined;
  if (!r) throw new ValidationError('方案不存在');
  if (r.status === 'confirmed') throw new ValidationError('已确认方案不可删除（库存流水需留存）');
  d.prepare(`DELETE FROM plans WHERE id=?`).run(req.params.id);
  res.json({ ok: true });
}));

/**
 * 确认方案：在单个 SQLite 事务内完成
 *  1) 幂等键检查（重复/并发确认不重复消耗）
 *  2) 库存版本检查（库存变动导致方案失效则拒绝，要求重排）
 *  3) 服务端按方案入参重新试排，结果须与草案一致（complete、板数、用量一致）
 *  4) 原子扣减原料、入库余料、写流水、推进版本号
 */
app.post('/api/plans/:id/confirm', wrap((req, res) => {
  const d = getDb();
  const id = Number(req.params.id);
  const idempotencyKey =
    typeof req.body?.idempotencyKey === 'string' && req.body.idempotencyKey.trim()
      ? req.body.idempotencyKey.trim().slice(0, 120)
      : undefined;

  const outcome = d.transaction((): { status: string; http: number; data: any } => {
    const plan = d.prepare(`SELECT * FROM plans WHERE id=?`).get(id) as any;
    if (!plan) return { status: 'not_found', http: 404, data: { error: '方案不存在' } };

    // 已确认：幂等返回，绝不重复扣库存
    if (plan.status === 'confirmed') {
      if (idempotencyKey && plan.idempotency_key && plan.idempotency_key !== idempotencyKey) {
        return { status: 'conflict', http: 409, data: { error: '该方案已用其他幂等键确认' } };
      }
      return {
        status: 'already_confirmed',
        http: 200,
        data: { id, confirmed: true, idempotent: true, result: JSON.parse(plan.result_json) },
      };
    }

    // 幂等键已被别的方案使用
    if (idempotencyKey) {
      const dup = d.prepare(`SELECT id FROM plans WHERE idempotency_key=? AND id<>?`).get(idempotencyKey, id) as
        | { id: number }
        | undefined;
      if (dup) return { status: 'conflict', http: 409, data: { error: '幂等键已被其他确认使用' } };
    }

    // 库存版本：变动即拒绝
    const currentVersion = getStockVersion(d);
    if (plan.stock_version !== currentVersion) {
      return {
        status: 'stale',
        http: 409,
        data: {
          error: '库存自方案保存后已发生变动，方案失效，请重新试排后再确认',
          planStockVersion: plan.stock_version,
          currentStockVersion: currentVersion,
        },
      };
    }

    const planReq: PlanRequest = JSON.parse(plan.request_json);
    const fresh = buildPlan(planReq, loadStock(), currentVersion);
    if (!fresh.complete) {
      return { status: 'incomplete', http: 409, data: { error: '方案未排下全部纸片，不能确认', result: fresh } };
    }

    // 逐行扣减
    const stockRows = d.prepare(`SELECT * FROM stock`).all() as any[];
    const stockMap = new Map<number, any>(stockRows.map((s) => [s.id, s]));
    for (const u of fresh.stockUsage) {
      const row = stockMap.get(u.stockId);
      if (!row || row.quantity < u.quantity) {
        return {
          status: 'stale',
          http: 409,
          data: { error: `库存「${u.name}」数量不足，请重新试排`, currentStockVersion: currentVersion },
        };
      }
    }

    // 执行扣减
    const dec = d.prepare(`UPDATE stock SET quantity = quantity - ? WHERE id = ?`);
    for (const u of fresh.stockUsage) dec.run(u.quantity, u.stockId);

    // 余料入库：同纸名/尺寸/纹向的余料合并数量
    const insRemnant = d.prepare(
      `INSERT INTO stock(name, width, height, quantity, grain, kind) VALUES (?, ?, ?, 1, ?, 'remnant')`,
    );
    const findRemnant = d.prepare(
      `SELECT id, quantity FROM stock WHERE kind='remnant' AND name=? AND ABS(width-?)<0.001 AND ABS(height-?)<0.001 AND grain=?`,
    );
    const incRemnant = d.prepare(`UPDATE stock SET quantity = quantity + ? WHERE id=?`);
    const addMovement = d.prepare(
      `INSERT INTO stock_movements(plan_id, stock_id, name, movement_type, width, height, grain, quantity)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const b of fresh.boards) {
      addMovement.run(id, b.stockId, b.stockName, 'consume', b.sourceW, b.sourceH, b.grain, 1);
      // 归一化纸名：余料再开板产生的新余料不重复加前缀，保证同规格能合并
      const baseName = b.stockName.replace(/^余料-/, '');
      for (const rm of b.remnants) {
        const remName = `余料-${baseName}`;
        const grainV: Grain = b.grain;
        const existing = findRemnant.get(remName, rm.w, rm.h, grainV) as { id: number; quantity: number } | undefined;
        if (existing) {
          incRemnant.run(1, existing.id);
          addMovement.run(id, existing.id, remName, 'remnant_in', rm.w, rm.h, grainV, 1);
        } else {
          const info = insRemnant.run(remName, rm.w, rm.h, grainV);
          addMovement.run(id, Number(info.lastInsertRowid), remName, 'remnant_in', rm.w, rm.h, grainV, 1);
        }
      }
    }

    const newVersion = bumpStockVersion(d);
    const newResult = { ...fresh, stockVersion: newVersion };
    d.prepare(
      `UPDATE plans SET status='confirmed', confirmed_at=datetime('now'), idempotency_key=?, result_json=? WHERE id=?`,
    ).run(idempotencyKey ?? null, JSON.stringify(newResult), id);

    return { status: 'confirmed', http: 200, data: { id, confirmed: true, result: newResult, stockVersion: newVersion } };
  })();

  res.status(outcome.http).json(outcome.data);
}));

// ---------- 错误处理 ----------
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  // 幂等键唯一索引冲突（并发确认同一 key）
  if (err && /UNIQUE constraint failed: plans\.idempotency_key/.test(err.message || '')) {
    return res.status(409).json({ error: '该确认请求已处理（幂等键冲突），请勿重复提交' });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || '服务器内部错误' });
});

// ---------- API 未匹配路由 ----------
app.use('/api', (_req, res) => {
  res.status(404).json({ error: '接口不存在' });
});

// ---------- 生产环境静态资源 ----------
const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
app.use(express.static(webDist));
app.get(/^(?!\/api\/).*/, (_req, res) => {
  res.sendFile(path.join(webDist, 'index.html'), (err) => {
    if (err) res.status(404).send('前端尚未构建，请先运行 npm run build');
  });
});

const PORT = Number(process.env.PORT || 3000);
app.listen(PORT, '0.0.0.0', () => {
  // 启动即初始化数据库（建表 + 种子库存）
  getDb();
  console.log(`裁切规划台已启动: http://localhost:${PORT}`);
});
