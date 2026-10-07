export const config = {
  port: Number(process.env.PORT ?? 8080),
  dbPath: process.env.DB_PATH ?? '/data/planner.db',
  /** 数据库为空时是否写入示例库存与示例订单 */
  seed: process.env.SEED !== 'false',
  nodeEnv: process.env.NODE_ENV ?? 'development',
};
