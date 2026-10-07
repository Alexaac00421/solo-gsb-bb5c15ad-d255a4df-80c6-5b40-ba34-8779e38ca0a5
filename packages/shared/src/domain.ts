import type {
  Grain,
  OrderPiece,
  Rect,
  Settings,
} from './types.js';

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export const area = (r: { width: number; height: number }): number =>
  r.width * r.height;

/**
 * 判断成品摆放是否满足纹向要求。
 * - 需求无纹向（none）或材料无纹向（none）：总是满足；
 * - 不允许旋转：成品宽轴必须与纹向一致（需求纹向 == 材料纹向）；
 * - 允许旋转：纹向重合即可（旋转 90° 让轴对齐）。
 */
export function grainMatches(
  stockGrain: Grain,
  requiredGrain: Grain,
  rotated: boolean,
): boolean {
  if (requiredGrain === 'none' || stockGrain === 'none') return true;
  if (!rotated) return stockGrain === requiredGrain;
  return stockGrain === (requiredGrain === 'x' ? 'y' : 'x');
}

/** 摆放后成品自身纹向（沿自身宽轴 w 的方向） */
export function placedGrain(stockGrain: Grain, rotated: boolean): Grain {
  if (stockGrain === 'none') return 'none';
  if (!rotated) return stockGrain;
  return stockGrain === 'x' ? 'y' : 'x';
}

/** 纸片在给定需求下是否可能用于任一库存的尺寸（用于区分未排原因） */
export function anyStockCanContain(
  pw: number,
  ph: number,
  allowRotation: boolean,
  stock: Array<{ width: number; height: number; usableW: number; usableH: number; grain: Grain }>,
  requiredGrain: Grain,
): boolean {
  return stock.some((s) => {
    if (
      pw <= s.usableW &&
      ph <= s.usableH &&
      grainMatches(s.grain, requiredGrain, false)
    ) {
      return true;
    }
    return (
      allowRotation &&
      ph <= s.usableW &&
      pw <= s.usableH &&
      grainMatches(s.grain, requiredGrain, true)
    );
  });
}

export function rectArea(r: Rect): number {
  return r.w * r.h;
}

/** 规范化 JSON（键排序），用于生成稳定哈希输入 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

/** djb2 哈希，返回十六进制字符串（非密码学用途，仅做失效检测） */
export function hashOf(value: unknown): string {
  const s = stableStringify(value);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 订单内容指纹：纸片需求（不含状态）决定方案是否需要重排 */
export function computeOrderHash(pieces: OrderPiece[]): string {
  return hashOf(
    pieces
      .map((p) => ({
        id: p.id,
        name: p.name,
        width: round2(p.width),
        height: round2(p.height),
        grainRequired: p.grainRequired,
        allowRotation: p.allowRotation,
        quantity: p.quantity,
      }))
      .sort((a, b) => a.id - b.id),
  );
}

export function computeSettingsHash(s: Settings): string {
  return hashOf({
    margin: round2(s.margin),
    kerf: round2(s.kerf),
    remnantMinWidth: round2(s.remnantMinWidth),
    remnantMinHeight: round2(s.remnantMinHeight),
  });
}
