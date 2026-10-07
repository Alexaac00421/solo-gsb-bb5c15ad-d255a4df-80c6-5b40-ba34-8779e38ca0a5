export class ValidationError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

type Grain = 'x' | 'y' | 'none';

const isGrain = (v: unknown): v is Grain =>
  v === 'x' || v === 'y' || v === 'none';

const isPosNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0;

const isNonNegNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0;

const isPosInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0;

export function requireString(v: unknown, field: string): string {
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ValidationError(`${field} 不能为空`);
  }
  return v.trim();
}

export function validateSettings(body: unknown): {
  margin: number;
  kerf: number;
  remnantMinWidth: number;
  remnantMinHeight: number;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isNonNegNum(b.margin)) throw new ValidationError('边距必须是非负数字');
  if (!isNonNegNum(b.kerf)) throw new ValidationError('刀缝必须是非负数字');
  if (!isPosNum(b.remnantMinWidth))
    throw new ValidationError('余料最小长必须是正数');
  if (!isPosNum(b.remnantMinHeight))
    throw new ValidationError('余料最小宽必须是正数');
  if (b.margin > 10000 || b.kerf > 10000)
    throw new ValidationError('边距/刀缝数值超出合理范围');
  return {
    margin: b.margin,
    kerf: b.kerf,
    remnantMinWidth: b.remnantMinWidth,
    remnantMinHeight: b.remnantMinHeight,
  };
}

export function validateStock(body: unknown): {
  kind: 'sheet' | 'remnant';
  name: string;
  width: number;
  height: number;
  grain: Grain;
  quantity: number;
  note: string | null;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.kind !== 'sheet' && b.kind !== 'remnant')
    throw new ValidationError('类型必须是 sheet 或 remnant');
  const name = requireString(b.name, '名称');
  if (!isPosNum(b.width) || b.width > 100000)
    throw new ValidationError('宽必须是 0~100000 之间的数字');
  if (!isPosNum(b.height) || b.height > 100000)
    throw new ValidationError('高必须是 0~100000 之间的数字');
  if (!isGrain(b.grain)) throw new ValidationError('纹向必须是 x / y / none');
  if (!isPosInt(b.quantity) || b.quantity > 100000)
    throw new ValidationError('数量必须是 1~100000 的整数');
  const note =
    b.note == null ? null : requireString(b.note, '备注');
  return {
    kind: b.kind,
    name,
    width: b.width,
    height: b.height,
    grain: b.grain,
    quantity: b.quantity,
    note,
  };
}

export function validateOrder(body: unknown): {
  title: string;
  pieces: Array<{
    name: string;
    width: number;
    height: number;
    grainRequired: Grain;
    allowRotation: boolean;
    quantity: number;
  }>;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  const title = requireString(b.title, '订单标题');
  if (!Array.isArray(b.pieces) || b.pieces.length === 0)
    throw new ValidationError('订单至少包含一种纸片');

  const MAX_TOTAL = 10000;
  let total = 0;
  const pieces = b.pieces.map((raw, i) => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const name = requireString(p.name, `第 ${i + 1} 项纸片名称`);
    if (!isPosNum(p.width) || p.width > 100000)
      throw new ValidationError(`第 ${i + 1} 项宽不合法`);
    if (!isPosNum(p.height) || p.height > 100000)
      throw new ValidationError(`第 ${i + 1} 项高不合法`);
    if (!isGrain(p.grainRequired))
      throw new ValidationError(`第 ${i + 1} 项纹向不合法`);
    if (typeof p.allowRotation !== 'boolean')
      throw new ValidationError(`第 ${i + 1} 项必须明确是否允许旋转`);
    if (!isPosInt(p.quantity) || p.quantity > 10000)
      throw new ValidationError(`第 ${i + 1} 项数量必须是 1~10000 的整数`);
    total += p.quantity;
    if (total > MAX_TOTAL)
      throw new ValidationError(`单次排样纸片总数不能超过 ${MAX_TOTAL}`);
    return {
      name,
      width: p.width,
      height: p.height,
      grainRequired: p.grainRequired,
      allowRotation: p.allowRotation,
      quantity: p.quantity,
    };
  });

  return { title, pieces };
}
