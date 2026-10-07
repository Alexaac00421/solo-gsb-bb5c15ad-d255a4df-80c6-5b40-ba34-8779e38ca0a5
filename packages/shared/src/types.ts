/**
 * 裁切规划台共享领域类型 —— 前后端共用。
 * 尺寸单位均为毫米 (mm)；x 沿材料宽向，y 沿材料高向。
 */

/** 纹向（丝缕方向）：'x' 表示沿宽向，'y' 表示沿高向，'none' 表示无纹向要求 */
export type Grain = 'x' | 'y' | 'none';

/** 库存条目：原张(kind=sheet) 或可复用余料(kind=remnant) */
export interface StockItem {
  id: number;
  kind: 'sheet' | 'remnant';
  name: string;
  width: number;
  height: number;
  grain: Grain;
  quantity: number;
  note: string | null;
  created_at: string;
  /** 余料由哪次确认产生（溯源） */
  source_plan_id: number | null;
}

/** 订单纸片需求 */
export interface OrderPiece {
  id: number;
  order_id: number;
  name: string;
  width: number;
  height: number;
  /** 成品纹向要求：'none' 表示无要求 */
  grainRequired: Grain;
  /** 是否允许旋转 90° 排样 */
  allowRotation: boolean;
  quantity: number;
}

export type OrderStatus = 'open' | 'confirmed';

export interface Order {
  id: number;
  title: string;
  status: OrderStatus;
  created_at: string;
  confirmed_at: string | null;
}

/** 全局工艺参数（单条记录 id=1） */
export interface Settings {
  /** 原料四周白边（mm），排样只在白边内侧区域进行；余料不计白边 */
  margin: number;
  /** 刀缝（切刀占用宽度，mm） */
  kerf: number;
  /** 可复用余料最小长（mm） */
  remnantMinWidth: number;
  /** 可复用余料最小宽（mm） */
  remnantMinHeight: number;
}

/** 摆放朝向 */
export type Orientation = 'normal' | 'rotated';

/** 方案中的一张材料（一次切割单位） */
export interface PlanSheet {
  sheetNo: number;
  stockItemId: number;
  stockName: string;
  kind: 'sheet' | 'remnant';
  /** 材料原始尺寸 */
  width: number;
  height: number;
  grain: Grain;
  /** 可用区（原张去除白边后） */
  usable: Rect;
  placements: Placement[];
  cuts: CutRecord[];
  /** 可复用余料（空区中尺寸达标的） */
  remnants: RectLabel[];
  /** 废料空区（空区中尺寸不达标的） */
  wasteRects: RectLabel[];
  /** 各类面积（mm²） */
  areaTotal: number;
  areaUsable: number;
  areaProduct: number;
  areaRemnant: number;
  areaWaste: number;
  /** 利用率 0~1 = 成品面积 / 材料总面积 */
  utilization: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RectLabel extends Rect {
  label: string;
}

export interface Placement {
  pieceId: number;
  pieceName: string;
  /** 第几张需求（1..quantity），用于逐张区分 */
  pieceIndex: number;
  x: number;
  y: number;
  w: number;
  h: number;
  orientation: Orientation;
  grain: Grain;
}

/** 一刀：沿 at 坐标，在 [from,to] 区间内贯穿当前子矩形 */
export interface CutRecord {
  seq: number;
  axis: 'v' | 'h';
  at: number;
  from: number;
  to: number;
  /** 作用的当前子矩形（切前） */
  target: Rect;
  /** 可读说明 */
  description: string;
}

/** 每张材料消耗快照（确认时据此原子扣减） */
export interface ConsumedItem {
  stockItemId: number;
  kind: 'sheet' | 'remnant';
  name: string;
  width: number;
  height: number;
  grain: Grain;
  qty: number;
}

/** 新产生的可复用余料（确认时入库） */
export interface NewRemnant {
  width: number;
  height: number;
  grain: Grain;
  qty: number;
}

/** 未排入纸片的聚合项 */
export interface UnplacedPiece {
  pieceId: number;
  name: string;
  width: number;
  height: number;
  grainRequired: Grain;
  allowRotation: boolean;
  qty: number;
  reason: 'STOCK_TOO_SMALL' | 'INVENTORY_EXHAUSTED';
}

/** 试排结果（同时也是保存方案的载荷主体） */
export interface PlanPayload {
  settings: Settings;
  orderHash: string;
  settingsHash: string;
  complete: boolean;
  sheets: PlanSheet[];
  consumed: ConsumedItem[];
  newRemnants: NewRemnant[];
  unplaced: UnplacedPiece[];
  totals: {
    sheetsUsed: number;
    piecesPlaced: number;
    piecesUnplaced: number;
    areaProduct: number;
    areaRemnant: number;
    areaWaste: number;
  };
}

export interface Plan {
  id: number;
  order_id: number;
  complete: boolean;
  order_hash: string;
  settings_hash: string;
  payload: PlanPayload;
  status: 'draft' | 'confirmed';
  created_at: string;
  confirmed_at: string | null;
}

/* ---------------- 输入 DTO ---------------- */

export interface StockInput {
  kind: 'sheet' | 'remnant';
  name: string;
  width: number;
  height: number;
  grain: Grain;
  quantity: number;
  note?: string | null;
}

export interface OrderInput {
  title: string;
  pieces: Array<{
    name: string;
    width: number;
    height: number;
    grainRequired: Grain;
    allowRotation: boolean;
    quantity: number;
  }>;
}

export interface ApiError {
  error: string;
  code?: string;
  /** 方案失效确认时附带的原因明细 */
  reasons?: string[];
}
