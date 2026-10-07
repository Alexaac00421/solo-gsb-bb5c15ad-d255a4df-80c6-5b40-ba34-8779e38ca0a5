import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ConsumedItem,
  NewRemnant,
  Order,
  OrderPiece,
  Plan,
  PlanPayload,
  Settings,
  StockItem,
} from '@pcp/shared';
import { config } from './config.js';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

mkdirSync(dirname(config.dbPath), { recursive: true });

/* ---------------- 建表 ---------------- */

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  margin REAL NOT NULL,
  kerf REAL NOT NULL,
  remnant_min_width REAL NOT NULL,
  remnant_min_height REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('sheet','remnant')),
  name TEXT NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  grain TEXT NOT NULL CHECK (grain IN ('x','y','none')),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  note TEXT,
  source_plan_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS order_pieces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  width REAL NOT NULL,
  height REAL NOT NULL,
  grain_required TEXT NOT NULL CHECK (grain_required IN ('x','y','none')),
  allow_rotation INTEGER NOT NULL CHECK (allow_rotation IN (0,1)),
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);

CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  complete INTEGER NOT NULL CHECK (complete IN (0,1)),
  order_hash TEXT NOT NULL,
  settings_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_pieces_order ON order_pieces(order_id);
CREATE INDEX IF NOT EXISTS idx_plans_order ON plans(order_id);
`);

/* ---------------- 行映射 ---------------- */

interface StockRow {
  id: number;
  kind: 'sheet' | 'remnant';
  name: string;
  width: number;
  height: number;
  grain: 'x' | 'y' | 'none';
  quantity: number;
  note: string | null;
  created_at: string;
  source_plan_id: number | null;
}

export function mapStock(r: StockRow): StockItem {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    width: r.width,
    height: r.height,
    grain: r.grain,
    quantity: r.quantity,
    note: r.note,
    created_at: r.created_at,
    source_plan_id: r.source_plan_id,
  };
}

interface PieceRow {
  id: number;
  order_id: number;
  name: string;
  width: number;
  height: number;
  grain_required: 'x' | 'y' | 'none';
  allow_rotation: number;
  quantity: number;
}

export function mapPiece(r: PieceRow): OrderPiece {
  return {
    id: r.id,
    order_id: r.order_id,
    name: r.name,
    width: r.width,
    height: r.height,
    grainRequired: r.grain_required,
    allowRotation: r.allow_rotation === 1,
    quantity: r.quantity,
  };
}

interface OrderRow {
  id: number;
  title: string;
  status: 'open' | 'confirmed';
  created_at: string;
  confirmed_at: string | null;
}

export function mapOrder(r: OrderRow): Order {
  return {
    id: r.id,
    title: r.title,
    status: r.status,
    created_at: r.created_at,
    confirmed_at: r.confirmed_at,
  };
}

interface PlanRow {
  id: number;
  order_id: number;
  complete: number;
  order_hash: string;
  settings_hash: string;
  payload: string;
  status: 'draft' | 'confirmed';
  created_at: string;
  confirmed_at: string | null;
}

export function mapPlan(r: PlanRow): Plan {
  return {
    id: r.id,
    order_id: r.order_id,
    complete: r.complete === 1,
    order_hash: r.order_hash,
    settings_hash: r.settings_hash,
    payload: JSON.parse(r.payload) as PlanPayload,
    status: r.status,
    created_at: r.created_at,
    confirmed_at: r.confirmed_at,
  };
}

/* ---------------- Settings ---------------- */

export function getSettings(): Settings {
  const row = db
    .prepare(
      `SELECT margin, kerf, remnant_min_width AS remnantMinWidth,
              remnant_min_height AS remnantMinHeight FROM settings WHERE id = 1`,
    )
    .get() as
    | Pick<Settings, 'margin' | 'kerf' | 'remnantMinWidth' | 'remnantMinHeight'>
    | undefined;
  if (!row) {
    const def: Settings = {
      margin: 10,
      kerf: 3,
      remnantMinWidth: 50,
      remnantMinHeight: 50,
    };
    db.prepare(
      `INSERT INTO settings (id, margin, kerf, remnant_min_width, remnant_min_height)
       VALUES (1, @margin, @kerf, @remnantMinWidth, @remnantMinHeight)`,
    ).run(def);
    return def;
  }
  return {
    margin: row.margin,
    kerf: row.kerf,
    remnantMinWidth: row.remnantMinWidth,
    remnantMinHeight: row.remnantMinHeight,
  };
}

export function updateSettings(s: Settings): Settings {
  db.prepare(
    `UPDATE settings SET margin=?, kerf=?, remnant_min_width=?, remnant_min_height=? WHERE id=1`,
  ).run(s.margin, s.kerf, s.remnantMinWidth, s.remnantMinHeight);
  return getSettings();
}

/* ---------------- Stock ---------------- */

export const stockRepo = {
  list(): StockItem[] {
    return (db
      .prepare(`SELECT * FROM stock_items ORDER BY kind DESC, id`)
      .all() as StockRow[]).map(mapStock);
  },
  get(id: number): StockItem | undefined {
    const r = db.prepare(`SELECT * FROM stock_items WHERE id=?`).get(id) as
      | StockRow
      | undefined;
    return r ? mapStock(r) : undefined;
  },
  create(input: {
    kind: 'sheet' | 'remnant';
    name: string;
    width: number;
    height: number;
    grain: 'x' | 'y' | 'none';
    quantity: number;
    note: string | null;
  }): StockItem {
    const info = db
      .prepare(
        `INSERT INTO stock_items (kind,name,width,height,grain,quantity,note)
         VALUES (@kind,@name,@width,@height,@grain,@quantity,@note)`,
      )
      .run(input);
    return this.get(Number(info.lastInsertRowid))!;
  },
  update(
    id: number,
    input: {
      kind: 'sheet' | 'remnant';
      name: string;
      width: number;
      height: number;
      grain: 'x' | 'y' | 'none';
      quantity: number;
      note: string | null;
    },
  ): StockItem | undefined {
    db.prepare(
      `UPDATE stock_items SET kind=@kind,name=@name,width=@width,height=@height,
        grain=@grain,quantity=@quantity,note=@note WHERE id=@id`,
    ).run({ ...input, id });
    return this.get(id);
  },
  remove(id: number): boolean {
    return db.prepare(`DELETE FROM stock_items WHERE id=?`).run(id).changes > 0;
  },
};

/* ---------------- Orders ---------------- */

export const orderRepo = {
  list(): Array<Order & { pieceCount: number; totalQty: number }> {
    const rows = db
      .prepare(
        `SELECT o.*,
           (SELECT COUNT(*) FROM order_pieces p WHERE p.order_id=o.id) AS pieceCount,
           (SELECT COALESCE(SUM(p.quantity),0) FROM order_pieces p WHERE p.order_id=o.id) AS totalQty
         FROM orders o ORDER BY o.id DESC`,
      )
      .all() as Array<OrderRow & { pieceCount: number; totalQty: number }>;
    return rows.map((r) => ({
      ...mapOrder(r),
      pieceCount: r.pieceCount,
      totalQty: r.totalQty,
    }));
  },
  get(id: number): Order | undefined {
    const r = db.prepare(`SELECT * FROM orders WHERE id=?`).get(id) as
      | OrderRow
      | undefined;
    return r ? mapOrder(r) : undefined;
  },
  pieces(orderId: number): OrderPiece[] {
    return (db
      .prepare(`SELECT * FROM order_pieces WHERE order_id=? ORDER BY id`)
      .all(orderId) as PieceRow[]).map(mapPiece);
  },
  create(input: {
    title: string;
    pieces: Array<{
      name: string;
      width: number;
      height: number;
      grainRequired: 'x' | 'y' | 'none';
      allowRotation: boolean;
      quantity: number;
    }>;
  }): Order {
    const tx = db.transaction(() => {
      const info = db
        .prepare(`INSERT INTO orders (title) VALUES (?)`)
        .run(input.title);
      const orderId = Number(info.lastInsertRowid);
      const stmt = db.prepare(
        `INSERT INTO order_pieces
           (order_id,name,width,height,grain_required,allow_rotation,quantity)
         VALUES (?,?,?,?,?,?,?)`,
      );
      for (const p of input.pieces) {
        stmt.run(
          orderId,
          p.name,
          p.width,
          p.height,
          p.grainRequired,
          p.allowRotation ? 1 : 0,
          p.quantity,
        );
      }
      return orderId;
    });
    const id = tx();
    return this.get(id)!;
  },
  remove(id: number): boolean {
    return db.prepare(`DELETE FROM orders WHERE id=?`).run(id).changes > 0;
  },
};

/* ---------------- Plans ---------------- */

export const planRepo = {
  list(orderId: number): Plan[] {
    return (db
      .prepare(`SELECT * FROM plans WHERE order_id=? ORDER BY id DESC`)
      .all(orderId) as PlanRow[]).map(mapPlan);
  },
  get(id: number): Plan | undefined {
    const r = db.prepare(`SELECT * FROM plans WHERE id=?`).get(id) as
      | PlanRow
      | undefined;
    return r ? mapPlan(r) : undefined;
  },
  create(input: {
    orderId: number;
    payload: PlanPayload;
  }): Plan {
    const info = db
      .prepare(
        `INSERT INTO plans (order_id, complete, order_hash, settings_hash, payload)
         VALUES (@orderId, @complete, @orderHash, @settingsHash, @payload)`,
      )
      .run({
        orderId: input.orderId,
        complete: input.payload.complete ? 1 : 0,
        orderHash: input.payload.orderHash,
        settingsHash: input.payload.settingsHash,
        payload: JSON.stringify(input.payload),
      });
    return this.get(Number(info.lastInsertRowid))!;
  },
  remove(id: number): boolean {
    return db.prepare(`DELETE FROM plans WHERE id=?`).run(id).changes > 0;
  },
};

/* ---------------- 确认（原子事务） ---------------- */

export interface ConfirmResult {
  plan: Plan;
  stockChanges: Array<{
    id: number;
    name: string;
    delta: number;
    newQuantity: number;
  }>;
  remnantsAdded: number;
}

/**
 * 原子确认：
 *  1. 校验方案仍为草稿（状态锁，重复/并发确认直接拒绝，不重复消耗）；
 *  2. 校验订单/工艺参数未变、库存仍够；
 *  3. 扣减原料、入库余料、写流水、置订单与方案为 confirmed。
 * 全部在同一个 better-sqlite3 事务（BEGIN IMMEDIATE 串行化写）内完成。
 */
export function confirmPlan(
  planId: number,
  ctx: {
    expectedOrderHash: string;
    expectedSettingsHash: string;
  },
): ConfirmResult {
  const tx = db.transaction((): ConfirmResult => {
    const row = db.prepare(`SELECT * FROM plans WHERE id=?`).get(planId) as
      | PlanRow
      | undefined;
    if (!row) throw Object.assign(new Error('方案不存在'), { status: 404 });
    if (row.status === 'confirmed') {
      throw Object.assign(new Error('该方案已确认，请勿重复提交'), {
        status: 409,
        code: 'ALREADY_CONFIRMED',
      });
    }

    const payload = JSON.parse(row.payload) as PlanPayload;
    const reasons: string[] = [];

    // 非完整方案（存在未排入纸片）一律不得确认
    if (!payload.complete) {
      throw Object.assign(
        new Error('该方案未排下全部纸片，不是完整方案，请补充库存后重新排样'),
        { status: 400, code: 'INCOMPLETE_PLAN' },
      );
    }

    // 订单内容变动 → 方案失效
    if (payload.orderHash !== ctx.expectedOrderHash) {
      reasons.push('订单纸片需求已被修改，保存的方案已失效');
    }
    // 工艺参数变动 → 方案失效
    if (payload.settingsHash !== ctx.expectedSettingsHash) {
      reasons.push('边距/刀缝/余料阈值等工艺参数已变更，保存的方案已失效');
    }

    // 库存逐项校验（数量必须仍然充足，尺寸/纹向快照异常也拒绝）
    for (const c of payload.consumed as ConsumedItem[]) {
      const s = db.prepare(`SELECT * FROM stock_items WHERE id=?`).get(
        c.stockItemId,
      ) as StockRow | undefined;
      if (!s) {
        reasons.push(`所需材料「${c.name}」已被删除`);
        continue;
      }
      if (
        s.width !== c.width ||
        s.height !== c.height ||
        s.grain !== c.grain ||
        s.kind !== c.kind
      ) {
        reasons.push(
          `材料「${c.name}」的尺寸或纹向已变化（保存方案时为 ${c.width}×${c.height}/${c.grain}）`,
        );
      }
      if (s.quantity < c.qty) {
        reasons.push(
          `材料「${c.name}」库存不足：方案需要 ${c.qty}，当前仅剩 ${s.quantity}`,
        );
      }
    }

    if (reasons.length > 0) {
      throw Object.assign(new Error('库存或订单已变化，方案失效，请重新排样'), {
        status: 409,
        code: 'PLAN_STALE',
        reasons,
      });
    }

    const changes: ConfirmResult['stockChanges'] = [];

    // 扣减
    for (const c of payload.consumed as ConsumedItem[]) {
      const before = db
        .prepare(`SELECT quantity FROM stock_items WHERE id=?`)
        .get(c.stockItemId) as { quantity: number };
      db.prepare(
        `UPDATE stock_items SET quantity = quantity - ? WHERE id=?`,
      ).run(c.qty, c.stockItemId);
      changes.push({
        id: c.stockItemId,
        name: c.name,
        delta: -c.qty,
        newQuantity: before.quantity - c.qty,
      });
    }

    // 余料入库（按规格合并数量；同时保留逐条溯源也可，这里按规格合并）
    let remnantsAdded = 0;
    for (const nr of payload.newRemnants as NewRemnant[]) {
      const existing = db
        .prepare(
          `SELECT id, quantity FROM stock_items
           WHERE kind='remnant' AND width=? AND height=? AND grain=?`,
        )
        .get(nr.width, nr.height, nr.grain) as
        | { id: number; quantity: number }
        | undefined;
      if (existing) {
        db.prepare(
          `UPDATE stock_items SET quantity = quantity + ? WHERE id=?`,
        ).run(nr.qty, existing.id);
        changes.push({
          id: existing.id,
          name: `余料 ${nr.width}×${nr.height}`,
          delta: nr.qty,
          newQuantity: existing.quantity + nr.qty,
        });
      } else {
        const info = db
          .prepare(
            `INSERT INTO stock_items
               (kind,name,width,height,grain,quantity,note,source_plan_id)
             VALUES ('remnant',?,?,?,?,?,NULL,?)`,
          )
          .run(
            `余料 ${nr.width}×${nr.height}`,
            nr.width,
            nr.height,
            nr.grain,
            nr.qty,
            planId,
          );
        changes.push({
          id: Number(info.lastInsertRowid),
          name: `余料 ${nr.width}×${nr.height}`,
          delta: nr.qty,
          newQuantity: nr.qty,
        });
      }
      remnantsAdded += nr.qty;
    }

    db.prepare(
      `UPDATE plans SET status='confirmed', confirmed_at=datetime('now') WHERE id=?`,
    ).run(planId);
    db.prepare(
      `UPDATE orders SET status='confirmed', confirmed_at=datetime('now') WHERE id=?`,
    ).run(row.order_id);

    return {
      plan: planRepo.get(planId)!,
      stockChanges: changes,
      remnantsAdded,
    };
  });

  return tx.immediate();
}

/* ---------------- 示例数据 ---------------- */

export function seedIfEmpty(): void {
  if (!config.seed) return;
  const count = db.prepare(`SELECT COUNT(*) AS n FROM settings`).get() as {
    n: number;
  };
  if (count.n === 0) getSettings();

  const stockCount = db.prepare(`SELECT COUNT(*) AS n FROM stock_items`).get() as {
    n: number;
  };
  if (stockCount.n > 0) return;

  const seedStock = db.transaction(() => {
    const ins = db.prepare(
      `INSERT INTO stock_items (kind,name,width,height,grain,quantity,note)
       VALUES (?,?,?,?,?,?,?)`,
    );
    ins.run('sheet', '大度原纸 889×1194', 889, 1194, 'y', 10, '示例：纹向沿高（y）');
    ins.run('sheet', '正度原纸 787×1092', 787, 1092, 'y', 8, null);
    ins.run('sheet', '卡纸 600×800', 600, 800, 'none', 5, '无纹向');
    ins.run('remnant', '余料 420×300', 420, 300, 'y', 2, '示例余料');
  });
  seedStock();

  const orderCount = db.prepare(`SELECT COUNT(*) AS n FROM orders`).get() as {
    n: number;
  };
  if (orderCount.n > 0) return;

  const seedOrder = db.transaction(() => {
    const info = db
      .prepare(`INSERT INTO orders (title) VALUES (?)`)
      .run('示例订单：名片与便签');
    const orderId = Number(info.lastInsertRowid);
    const ins = db.prepare(
      `INSERT INTO order_pieces
         (order_id,name,width,height,grain_required,allow_rotation,quantity)
       VALUES (?,?,?,?,?,?,?)`,
    );
    ins.run(orderId, '名片', 90, 54, 'none', 1, 200);
    ins.run(orderId, '便签本封面', 210, 148, 'y', 1, 12);
    ins.run(orderId, '竖向吊牌（不可旋转）', 80, 200, 'y', 0, 30);
  });
  seedOrder();
}
