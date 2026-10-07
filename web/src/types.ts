export type Grain = 'vertical' | 'horizontal' | 'none';

export interface StockItem {
  id: number;
  name: string;
  width: number;
  height: number;
  quantity: number;
  grain: Grain;
  kind: 'sheet' | 'remnant';
  created_at?: string;
}

export interface PieceSpec {
  cid: string;
  name: string;
  width: number;
  height: number;
  quantity: number;
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
  stockIds?: number[];
}

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

export interface Cut extends Rect {
  id: number;
  orientation: 'vertical' | 'horizontal';
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
  stockVersion: number;
  stockUsage: { stockId: number; name: string; kind: 'sheet' | 'remnant'; quantity: number }[];
}

export interface PlanSummary {
  id: number;
  name: string;
  status: 'draft' | 'confirmed';
  stockVersion: number;
  currentStockVersion: number;
  stale: boolean;
  complete: boolean;
  totals: PlanResult['totals'];
  createdAt: string;
  confirmedAt: string | null;
}

export interface PlanDetail extends PlanSummary {
  request: PlanRequest;
  result: PlanResult;
}

export interface PlanPayload {
  name: string;
  request: PlanRequest;
  result: PlanResult;
  idempotencyKey?: string;
}
