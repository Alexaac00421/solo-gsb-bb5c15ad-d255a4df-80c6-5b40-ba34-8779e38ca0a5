import { Grain, PlanRequest } from './types';

export class ValidationError extends Error {
  status = 400;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function grain(v: unknown): Grain {
  if (v === 'vertical' || v === 'horizontal' || v === 'none') return v;
  throw new ValidationError('纹向只能是 vertical / horizontal / none');
}

export function validateStockBody(body: any) {
  if (!body || typeof body.name !== 'string' || !body.name.trim()) {
    throw new ValidationError('名称必填');
  }
  if (!isNum(body.width) || body.width <= 0) throw new ValidationError('宽必须为正数(mm)');
  if (!isNum(body.height) || body.height <= 0) throw new ValidationError('高必须为正数(mm)');
  if (!Number.isInteger(body.quantity) || body.quantity < 0) throw new ValidationError('数量必须为非负整数');
  const kind = body.kind === 'remnant' ? 'remnant' : 'sheet';
  return {
    name: body.name.trim().slice(0, 100),
    width: body.width,
    height: body.height,
    quantity: body.quantity,
    grain: grain(body.grain ?? 'none'),
    kind,
  };
}

export function validatePlanRequest(body: any): PlanRequest {
  if (!body || typeof body !== 'object') throw new ValidationError('请求体格式错误');
  const p = ['margin', 'kerf', 'remnantMinWidth', 'remnantMinHeight'];
  for (const k of p) {
    if (!isNum(body[k]) || body[k] < 0) throw new ValidationError(`${k} 必须为非负数字`);
  }
  if (!Array.isArray(body.pieces) || body.pieces.length === 0) {
    throw new ValidationError('至少需要一种订单纸片');
  }
  if (body.pieces.length > 200) throw new ValidationError('单次纸片规格不超过 200 种');
  const pieces = body.pieces.map((x: any, i: number) => {
    if (!x || typeof x.name !== 'string' || !x.name.trim()) throw new ValidationError(`第 ${i + 1} 行纸片名称必填`);
    if (!isNum(x.width) || x.width <= 0) throw new ValidationError(`第 ${i + 1} 行宽必须为正数`);
    if (!isNum(x.height) || x.height <= 0) throw new ValidationError(`第 ${i + 1} 行高必须为正数`);
    if (!Number.isInteger(x.quantity) || x.quantity <= 0) throw new ValidationError(`第 ${i + 1} 行数量必须为正整数`);
    return {
      cid: typeof x.cid === 'string' ? x.cid.slice(0, 40) : undefined,
      name: x.name.trim().slice(0, 100),
      width: x.width,
      height: x.height,
      quantity: Math.min(x.quantity, 10000),
      allowRotation: !!x.allowRotation,
      grain: grain(x.grain ?? 'none'),
    };
  });
  const totalQty = pieces.reduce((s: number, p: { quantity: number }) => s + p.quantity, 0);
  if (totalQty > 10000) throw new ValidationError('纸片总数不超过 10000 片');
  let stockIds: number[] | undefined;
  if (body.stockIds !== undefined) {
    if (!Array.isArray(body.stockIds) || body.stockIds.some((s: unknown) => !Number.isInteger(s))) {
      throw new ValidationError('stockIds 必须为整数数组');
    }
    stockIds = body.stockIds;
  }
  return {
    margin: body.margin,
    kerf: body.kerf,
    remnantMinWidth: body.remnantMinWidth,
    remnantMinHeight: body.remnantMinHeight,
    pieces,
    stockIds,
  };
}
