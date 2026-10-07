import express from 'express';
import cors from 'cors';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { seedIfEmpty } from './db.js';
import { ValidationError } from './validation.js';
import { settingsRouter } from './routes/settings.js';
import { stockRouter } from './routes/stock.js';
import { ordersRouter } from './routes/orders.js';
import { plansRouter } from './routes/plans.js';

seedIfEmpty();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: new Date().toISOString() });
});

app.use('/api/settings', settingsRouter);
app.use('/api/stock', stockRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/plans', plansRouter);

// 参数校验错误统一处理
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err instanceof ValidationError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: '请求体不是合法 JSON' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  },
);

// 生产环境托管前端构建产物
const serverDir = dirname(fileURLToPath(import.meta.url));
const clientDist = join(serverDir, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(join(clientDist, 'index.html'));
  });
}

app.listen(config.port, () => {
  console.log(`纸品裁切规划台服务已启动: http://0.0.0.0:${config.port}`);
  console.log(`数据库文件: ${config.dbPath}`);
});
