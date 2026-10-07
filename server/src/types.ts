// 排料引擎与 API 共用的类型定义

export type Grain = 'vertical' | 'horizontal' | 'none';

/** 原张 / 库存余料 */
export interface StockItem {
  id: number;
  name: string;
  width: number;
  height: number;
  quantity: number;
  grain: Grain;
  kind: 'sheet' | 'remnant';
}

/** 订单纸片一种规格 */
export interface PieceSpec {
  /** 前端临时 id，仅用于结果着色关联 */
  cid?: string;
  name: string;
  width: number;
  height: number;
  quantity: number;
  /** 是否允许旋转 90° */
  allowRotation: boolean;
  grain: Grain;
}

export interface PlanParams {
  margin: number;
  kerf: number;
  remnantMinWidth: number;
  remnantMinHeight: number;
}

export interface PlanRequest extends PlanParams {
  pieces: PieceSpec[];
  /** 限定参与试排的库存 id；空数组表示使用全部库存 */
  stockIds?: number[];
}

/** 矩形（坐标系：原张左上角为原点，x 向右，y 向下，单位 mm） */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PlacedPiece extends Rect {
  pieceId: string;
  name: string;
  rotated: boolean;
}

/** 一刀贯穿当前子矩形的切割动作 */
export interface Cut extends Rect {
  id: number;
  orientation: 'vertical' | 'horizontal';
  /** 刀缝在该方向上的位置（垂切=刀缝左边 x，横切=刀缝顶边 y） */
  position: number;
  label: string;
}

export interface WasteRect extends Rect {
  reason: 'margin' | 'trim' | 'offcut';
}

export interface ReusableRemnant extends Rect {
  area: number;
}

export interface BoardResult {
  boardIndex: number;
  stockId: number;
  stockName: string;
  kind: 'sheet' | 'remnant';
  sourceW: number;
  sourceH: number;
  grain: Grain;
  placed: PlacedPiece[];
  cuts: Cut[];
  waste: WasteRect[];
  remnants: ReusableRemnant[];
  usedArea: number;
  wasteArea: number;
  remnantArea: number;
}

export interface UnplacedPiece {
  pieceId: string;
  name: string;
  width: number;
  height: number;
  rotated: boolean;
  quantity: number;
  reason: string;
}

export interface PlanResult {
  params: PlanParams;
  complete: boolean;
  boards: BoardResult[];
  unplaced: UnplacedPiece[];
  totals: {
    piecesPlaced: number;
    piecesRequired: number;
    sheetsUsed: number;
    remnantsUsed: number;
    usedArea: number;
    wasteArea: number;
    remnantArea: number;
  };
  /** 试排时读取的库存版本，确认时据此检测库存是否变动 */
  stockVersion: number;
  /** 本次占用的库存 id 及数量（试排/保存不真正扣减） */
  stockUsage: { stockId: number; name: string; kind: 'sheet' | 'remnant'; quantity: number }[];
}

/** 保存方案 / 确认接口的载荷：结果 + 入参快照 */
export interface PlanPayload {
  name: string;
  request: PlanRequest;
  result: PlanResult;
  idempotencyKey?: string;
}
