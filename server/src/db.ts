import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database;

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data', 'cutting.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  seed(db);
  return db;
}

function migrate(d: Database.Database) {
  d.exec(`
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS stock (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    width REAL NOT NULL,
    height REAL NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity >= 0),
    grain TEXT NOT NULL DEFAULT 'none',
    kind TEXT NOT NULL DEFAULT 'sheet' CHECK (kind IN ('sheet','remnant')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed')),
    request_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    stock_version INTEGER NOT NULL,
    idempotency_key TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    confirmed_at TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_plans_idem ON plans(idempotency_key) WHERE idempotency_key IS NOT NULL;

  -- 确认时产生的库存流水（审计用）
  CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES plans(id),
    stock_id INTEGER,
    name TEXT NOT NULL,
    movement_type TEXT NOT NULL CHECK (movement_type IN ('consume','remnant_in')),
    width REAL,
    height REAL,
    grain TEXT,
    quantity INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  `);

  const row = d.prepare(`SELECT value FROM meta WHERE key='stock_version'`).get() as { value: string } | undefined;
  if (!row) d.prepare(`INSERT INTO meta(key, value) VALUES ('stock_version', '1')`).run();
}

/** 当前库存版本号：任何库存变动（确认扣减、手工增删）都会递增 */
export function getStockVersion(d: Database.Database): number {
  const row = d.prepare(`SELECT value FROM meta WHERE key='stock_version'`).get() as { value: string };
  return Number(row.value);
}

export function bumpStockVersion(d: Database.Database): number {
  d.prepare(`UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key='stock_version'`).run();
  return getStockVersion(d);
}

function seed(d: Database.Database) {
  const count = d.prepare(`SELECT COUNT(*) AS c FROM stock`).get() as { c: number };
  if (count.c > 0) return;
  const ins = d.prepare(
    `INSERT INTO stock(name, width, height, quantity, grain, kind) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const tx = d.transaction(() => {
    // 原张
    ins.run('白卡 787×1092', 787, 1092, 20, 'vertical', 'sheet');
    ins.run('牛皮纸 889×1194', 889, 1194, 10, 'vertical', 'sheet');
    ins.run('瓦楞纸板 1200×1000', 1200, 1000, 8, 'none', 'sheet');
    // 库存余料
    ins.run('余料-白卡', 420, 300, 3, 'vertical', 'remnant');
    ins.run('余料-牛皮纸', 500, 360, 2, 'vertical', 'remnant');
    ins.run('余料-瓦楞', 600, 400, 1, 'none', 'remnant');
  });
  tx();
}
