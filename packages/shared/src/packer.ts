/**
 * 断头台式（guillotine）排样器。
 *
 * 约束：
 *  - 每一刀都必须贯穿当前待切子矩形（经典一刀切）；
 *  - 成品不重叠、不越界，满足纹向与旋转限制；
 *  - 刀缝 kerf 是切刀实际吃掉的材料，表现为相邻子矩形之间的间隙；
 *  - 原张保留四周白边 margin（余料无白边），排样只在白边内侧进行；
 *  - 空区按 remnantMinWidth/Height 分为「可复用余料」与「废料」。
 *
 * 放入一张纸片至多两刀（以竖切优先为例）：
 *   1. 竖切贯穿当前空区全高：左列（继续加工）+ 右列（整块保留为余料/废料）；
 *   2. 横切贯穿左列：成品 + 左列底部余料。
 * 横切优先时对称。两种朝向取「能保住更大整块余料」的方案。
 */

import type {
  ConsumedItem,
  Grain,
  NewRemnant,
  PlanPayload,
  PlanSheet,
  Placement,
  Rect,
  Settings,
  StockItem,
  OrderPiece,
  UnplacedPiece,
  CutRecord,
  Orientation,
} from './types.js';
import {
  anyStockCanContain,
  grainMatches,
  placedGrain,
  rectArea,
  round2,
} from './domain.js';

interface UnitStock {
  stockItemId: number;
  stockName: string;
  kind: 'sheet' | 'remnant';
  width: number;
  height: number;
  grain: Grain;
  /** 可用区（原张扣除白边；余料白边为 0） */
  usable: Rect;
}

type NodeKind = 'PRODUCT' | 'EMPTY' | 'V' | 'H';

interface PNode {
  kind: NodeKind;
  x: number;
  y: number;
  w: number;
  h: number;
  left: PNode | null;
  right: PNode | null;
  parent: PNode | null;
  pieceId?: number;
  pieceName?: string;
  pieceIndex?: number;
  orientation?: Orientation;
}

interface Candidate {
  leaf: PNode;
  node: PNode;
  /** 该空区放入后的剩余面积（越小越贴合） */
  leftover: number;
  /** 所选树能保住的最大整块余料面积（越大越好） */
  primaryOffcut: number;
}

type StrategyKey = 'longSide' | 'shortSide' | 'areaDesc' | 'widthDesc';

interface DemandItem {
  piece: OrderPiece;
  index: number;
}

const EPS = 1e-6;

/* ---------------- 尺寸适配（含刀缝） ---------------- */

interface Oriented {
  rotated: boolean;
  w: number;
  h: number;
}

/**
 * 纸片 (pw,ph) 能否放进 (aw,ah) 的区域。
 * 某方向若有剩余，则剩余必须容得下一刀（>= kerf）；完全填满则无需刀缝。
 */
export function orientationsIn(
  pw: number,
  ph: number,
  aw: number,
  ah: number,
  allowRotation: boolean,
  stockGrain: Grain,
  requiredGrain: Grain,
  kerf: number,
): Oriented[] {
  const axisOk = (piece: number, avail: number): boolean =>
    piece <= avail + EPS &&
    (avail - piece <= EPS || avail - piece + EPS >= kerf);
  const out: Oriented[] = [];
  if (
    axisOk(pw, aw) &&
    axisOk(ph, ah) &&
    grainMatches(stockGrain, requiredGrain, false)
  ) {
    out.push({ rotated: false, w: pw, h: ph });
  }
  if (
    allowRotation &&
    axisOk(ph, aw) &&
    axisOk(pw, ah) &&
    grainMatches(stockGrain, requiredGrain, true)
  ) {
    out.push({ rotated: true, w: ph, h: pw });
  }
  return out;
}

/* ---------------- 材料池 ---------------- */

function expandStock(stock: StockItem[], s: Settings): UnitStock[] {
  const units: UnitStock[] = [];
  for (const item of stock) {
    const qty = Math.max(0, Math.floor(item.quantity));
    const margin = item.kind === 'sheet' ? s.margin : 0;
    for (let i = 0; i < qty; i++) {
      units.push({
        stockItemId: item.id,
        stockName: item.name,
        kind: item.kind,
        width: item.width,
        height: item.height,
        grain: item.grain,
        usable: {
          x: margin,
          y: margin,
          w: item.width - 2 * margin,
          h: item.height - 2 * margin,
        },
      });
    }
  }
  // 优先消耗小面积材料；同尺寸时余料先于原张
  units.sort((a, b) => {
    const diff = a.width * a.height - b.width * b.height;
    if (diff !== 0) return diff;
    if (a.kind !== b.kind) return a.kind === 'remnant' ? -1 : 1;
    return a.stockItemId - b.stockItemId;
  });
  return units;
}

/* ---------------- 节点构造 ---------------- */

function makeEmpty(x: number, y: number, w: number, h: number): PNode {
  return { kind: 'EMPTY', x, y, w, h, left: null, right: null, parent: null };
}

function makeInternal(kind: 'V' | 'H', left: PNode, right: PNode): PNode {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const w =
    kind === 'V'
      ? right.x + right.w - left.x
      : Math.max(left.x + left.w, right.x + right.w) - x;
  const h =
    kind === 'H'
      ? right.y + right.h - left.y
      : Math.max(left.y + left.h, right.y + right.h) - y;
  const node: PNode = { kind, x, y, w, h, left, right, parent: null };
  left.parent = node;
  right.parent = node;
  return node;
}

/* ---------------- 单张排样 ---------------- */

class SheetPacker {
  root: PNode;
  readonly unit: UnitStock;
  private emptyLeaves: PNode[] = [];

  constructor(unit: UnitStock) {
    this.unit = unit;
    const u = unit.usable;
    this.root = makeEmpty(u.x, u.y, u.w, u.h);
    this.emptyLeaves = [this.root];
  }

  getEmpties(): readonly PNode[] {
    return this.emptyLeaves;
  }

  /**
   * 在空区 leaf 内构造放入纸片的子树。
   * remW/remH 为扣除刀缝后的真实余料尺寸。
   */
  private buildSubtree(
    leaf: PNode,
    o: Oriented,
    piece: OrderPiece,
    index: number,
    kerf: number,
  ): { node: PNode; primaryOffcut: number } {
    const { w, h, rotated } = o;
    const remW = leaf.w - w - kerf;
    const remH = leaf.h - h - kerf;
    const hasV = leaf.w - w > EPS; // 有竖切（右侧有余料列）
    const hasH = leaf.h - h > EPS; // 有横切（底部有余料行）

    const product = (): PNode => ({
      kind: 'PRODUCT',
      x: leaf.x,
      y: leaf.y,
      w,
      h,
      left: null,
      right: null,
      parent: leaf.parent,
      pieceId: piece.id,
      pieceName: piece.name,
      pieceIndex: index,
      orientation: rotated ? 'rotated' : 'normal',
    });

    if (!hasV && !hasH) {
      return { node: product(), primaryOffcut: 0 };
    }
    if (hasV && !hasH) {
      // 仅竖切：成品 | 右余料列（全高）
      const right = makeEmpty(leaf.x + w + kerf, leaf.y, remW, leaf.h);
      return { node: makeInternal('V', product(), right), primaryOffcut: remW * leaf.h };
    }
    if (hasH && !hasV) {
      // 仅横切：成品 / 底余料行（成品宽）
      const bottom = makeEmpty(leaf.x, leaf.y + h + kerf, w, remH);
      return { node: makeInternal('H', product(), bottom), primaryOffcut: w * remH };
    }

    // 两个方向都有余料：比较两种开料保住的整块余料
    // 竖切优先：右余料列 remW × H（整块），左列底部 w × remH
    const vColumn = remW * leaf.h;
    // 横切优先：底余料行 W × remH（整块），上行右侧 remW × h
    const hRow = leaf.w * remH;

    if (vColumn >= hRow) {
      const right = makeEmpty(leaf.x + w + kerf, leaf.y, remW, leaf.h);
      const bottom = makeEmpty(leaf.x, leaf.y + h + kerf, w, remH);
      const leftCol = makeInternal('H', product(), bottom);
      return { node: makeInternal('V', leftCol, right), primaryOffcut: vColumn };
    }
    const bottom = makeEmpty(leaf.x, leaf.y + h + kerf, leaf.w, remH);
    const right = makeEmpty(leaf.x + w + kerf, leaf.y, remW, h);
    const topRow = makeInternal('V', product(), right);
    return { node: makeInternal('H', topRow, bottom), primaryOffcut: hRow };
  }

  /** 评估在某空区放入纸片的最佳候选（不落盘） */
  evaluate(
    leaf: PNode,
    piece: OrderPiece,
    index: number,
    kerf: number,
  ): Candidate | null {
    let best: Candidate | null = null;
    for (const o of orientationsIn(
      piece.width,
      piece.height,
      leaf.w,
      leaf.h,
      piece.allowRotation,
      this.unit.grain,
      piece.grainRequired,
      kerf,
    )) {
      const { node, primaryOffcut } = this.buildSubtree(leaf, o, piece, index, kerf);
      const leftover = leaf.w * leaf.h - o.w * o.h;
      if (
        !best ||
        leftover < best.leftover - EPS ||
        (Math.abs(leftover - best.leftover) <= EPS &&
          primaryOffcut > best.primaryOffcut + EPS)
      ) {
        best = { leaf, node, leftover, primaryOffcut };
      }
    }
    return best;
  }

  /** 应用候选，替换空叶并重建空区索引 */
  apply(cand: Candidate): void {
    const { leaf, node } = cand;
    if (leaf.parent) {
      if (leaf.parent.left === leaf) leaf.parent.left = node;
      else leaf.parent.right = node;
      node.parent = leaf.parent;
    } else {
      this.root = node;
      node.parent = null;
    }
    this.emptyLeaves = [];
    this.collectEmpty(this.root);
  }

  private collectEmpty(n: PNode): void {
    if (n.kind === 'EMPTY') {
      if (n.w > EPS && n.h > EPS) this.emptyLeaves.push(n);
      return;
    }
    if (n.kind === 'PRODUCT') return;
    if (n.left) this.collectEmpty(n.left);
    if (n.right) this.collectEmpty(n.right);
  }
}

/* ---------------- 切分树 → 切割顺序 ---------------- */

interface TraverseResult {
  cuts: CutRecord[];
  placements: Placement[];
  empties: PNode[];
}

function traverseTree(root: PNode, stockGrain: Grain, kerf: number): TraverseResult {
  const cuts: CutRecord[] = [];
  const placements: Placement[] = [];
  const empties: PNode[] = [];

  const walk = (n: PNode): void => {
    if (n.kind === 'PRODUCT') {
      placements.push({
        pieceId: n.pieceId!,
        pieceName: n.pieceName!,
        pieceIndex: n.pieceIndex!,
        x: round2(n.x),
        y: round2(n.y),
        w: round2(n.w),
        h: round2(n.h),
        orientation: n.orientation!,
        grain: placedGrain(stockGrain, n.orientation === 'rotated'),
      });
      return;
    }
    if (n.kind === 'EMPTY') {
      empties.push(n);
      return;
    }
    const l = n.left!;
    const r = n.right!;
    if (n.kind === 'V') {
      // 刀缝居中于左右子矩形之间的间隙
      const at = round2(Math.min(l.x + l.w, r.x) + kerf / 2);
      cuts.push({
        seq: 0,
        axis: 'v',
        at,
        from: round2(n.y),
        to: round2(n.y + n.h),
        target: {
          x: round2(n.x),
          y: round2(n.y),
          w: round2(n.w),
          h: round2(n.h),
        },
        description: `竖切：x≈${at}，自 y=${round2(n.y)} 切到 y=${round2(n.y + n.h)}，贯穿当前子矩形`,
      });
    } else {
      const at = round2(Math.min(l.y + l.h, r.y) + kerf / 2);
      cuts.push({
        seq: 0,
        axis: 'h',
        at,
        from: round2(n.x),
        to: round2(n.x + n.w),
        target: {
          x: round2(n.x),
          y: round2(n.y),
          w: round2(n.w),
          h: round2(n.h),
        },
        description: `横切：y≈${at}，自 x=${round2(n.x)} 切到 x=${round2(n.x + n.w)}，贯穿当前子矩形`,
      });
    }
    walk(l);
    walk(r);
  };

  walk(root);
  cuts.forEach((c, i) => (c.seq = i + 1));
  return { cuts, placements, empties };
}

/* ---------------- 多策略排样 ---------------- */

function expandDemand(pieces: OrderPiece[]): DemandItem[] {
  const items: DemandItem[] = [];
  for (const p of pieces) {
    for (let i = 1; i <= p.quantity; i++) items.push({ piece: p, index: i });
  }
  return items;
}

function sortDemand(items: DemandItem[], strategy: StrategyKey): DemandItem[] {
  const arr = [...items];
  const area = (p: OrderPiece) => p.width * p.height;
  switch (strategy) {
    case 'longSide':
      arr.sort(
        (a, b) =>
          Math.max(b.piece.width, b.piece.height) -
            Math.max(a.piece.width, a.piece.height) ||
          area(b.piece) - area(a.piece),
      );
      break;
    case 'shortSide':
      arr.sort(
        (a, b) =>
          Math.min(b.piece.width, b.piece.height) -
            Math.min(a.piece.width, a.piece.height) ||
          area(b.piece) - area(a.piece),
      );
      break;
    case 'areaDesc':
      arr.sort((a, b) => area(b.piece) - area(a.piece));
      break;
    case 'widthDesc':
      arr.sort(
        (a, b) =>
          b.piece.width - a.piece.width || b.piece.height - a.piece.height,
      );
      break;
  }
  return arr;
}

interface OpenSheet {
  unit: UnitStock;
  packer: SheetPacker;
}

interface RawResult {
  placed: number;
  consumedArea: number;
  sheets: OpenSheet[];
  unplaced: DemandItem[];
}

interface AppliedCandidate extends Candidate {
  packer: SheetPacker;
  newUnit: UnitStock | null;
}

function runStrategy(
  units: UnitStock[],
  pieces: OrderPiece[],
  settings: Settings,
  strategy: StrategyKey,
): RawResult {
  const demand = sortDemand(expandDemand(pieces), strategy);
  const open: OpenSheet[] = [];
  const used = new Array<boolean>(units.length).fill(false);
  const unplaced: DemandItem[] = [];

  /** 在所有已开料张的空区里找最贴合的候选 */
  const findInOpen = (item: DemandItem): AppliedCandidate | null => {
    let best: AppliedCandidate | null = null;
    for (const sh of open) {
      for (const leaf of sh.packer.getEmpties()) {
        const cand = sh.packer.evaluate(
          leaf,
          item.piece,
          item.index,
          settings.kerf,
        );
        if (
          cand &&
          (!best ||
            cand.leftover < best.leftover - EPS ||
            (Math.abs(cand.leftover - best.leftover) <= EPS &&
              cand.primaryOffcut > best.primaryOffcut + EPS))
        ) {
          best = { ...cand, packer: sh.packer, newUnit: null };
        }
      }
    }
    return best;
  };

  /** 开一张新材料：材料池按面积升序，取第一张未用且能容纳纸片的 */
  const openNewSheet = (item: DemandItem): AppliedCandidate | null => {
    for (let i = 0; i < units.length; i++) {
      if (used[i]) continue;
      const u = units[i]!;
      const fits = orientationsIn(
        item.piece.width,
        item.piece.height,
        u.usable.w,
        u.usable.h,
        item.piece.allowRotation,
        u.grain,
        item.piece.grainRequired,
        settings.kerf,
      );
      if (fits.length === 0) continue;
      const packer = new SheetPacker(u);
      const cand = packer.evaluate(
        packer.getEmpties()[0]!,
        item.piece,
        item.index,
        settings.kerf,
      )!;
      used[i] = true;
      return { ...cand, packer, newUnit: u };
    }
    return null;
  };

  for (const item of demand) {
    // 优先填已开料张（贴合优先）；没有合适空区时再开新材料
    const cand = findInOpen(item) ?? openNewSheet(item);
    if (!cand) {
      unplaced.push(item);
      continue;
    }
    cand.packer.apply(cand);
    if (cand.newUnit) {
      open.push({ unit: cand.newUnit, packer: cand.packer });
    }
  }

  const placed = demand.length - unplaced.length;
  const consumedArea = open.reduce(
    (sum, sh) => sum + sh.unit.width * sh.unit.height,
    0,
  );
  return { placed, consumedArea, sheets: open, unplaced };
}

/* ---------------- 结果组装 ---------------- */

function classifyEmpties(
  empties: PNode[],
  settings: Settings,
): { remnants: PlanSheet['remnants']; waste: PlanSheet['wasteRects']; areaRemnant: number } {
  const remnants: PlanSheet['remnants'] = [];
  const waste: PlanSheet['wasteRects'] = [];
  let areaRemnant = 0;
  let rNo = 1;
  let wNo = 1;

  for (const e of empties) {
    const label =
      e.w >= settings.remnantMinWidth - EPS &&
      e.h >= settings.remnantMinHeight - EPS
        ? `余料 R${rNo++}`
        : `废料 W${wNo++}`;
    const rect = {
      x: round2(e.x),
      y: round2(e.y),
      w: round2(e.w),
      h: round2(e.h),
      label,
    };
    if (label.startsWith('余料')) {
      remnants.push(rect);
      areaRemnant += rectArea(rect);
    } else {
      waste.push(rect);
    }
  }
  return { remnants, waste, areaRemnant };
}

function buildPlanSheets(result: RawResult, settings: Settings): PlanSheet[] {
  return result.sheets.map((sh, idx) => {
    const { cuts, placements, empties } = traverseTree(
      sh.packer.root,
      sh.unit.grain,
      settings.kerf,
    );
    const { remnants, waste, areaRemnant } = classifyEmpties(empties, settings);

    const areaTotal = sh.unit.width * sh.unit.height;
    const u = sh.unit.usable;
    const areaUsable = u.w * u.h;
    const areaProduct = placements.reduce((s, p) => s + p.w * p.h, 0);
    const wasteRectArea = waste.reduce((s, r) => s + rectArea(r), 0);
    // 可用区内未被成品/余料/废料空区覆盖的部分 = 刀缝间隙 + 白边以外损耗
    const insideLoss =
      areaUsable - areaProduct - areaRemnant - wasteRectArea;
    const areaWaste = areaTotal - areaUsable + wasteRectArea + Math.max(0, insideLoss);

    return {
      sheetNo: idx + 1,
      stockItemId: sh.unit.stockItemId,
      stockName: sh.unit.stockName,
      kind: sh.unit.kind,
      width: round2(sh.unit.width),
      height: round2(sh.unit.height),
      grain: sh.unit.grain,
      usable: {
        x: round2(u.x),
        y: round2(u.y),
        w: round2(u.w),
        h: round2(u.h),
      },
      placements,
      cuts,
      remnants,
      wasteRects: waste,
      areaTotal: round2(areaTotal),
      areaUsable: round2(areaUsable),
      areaProduct: round2(areaProduct),
      areaRemnant: round2(areaRemnant),
      areaWaste: round2(areaWaste),
      utilization: round2(areaProduct / areaTotal),
    };
  });
}

function aggregateConsumed(result: RawResult): ConsumedItem[] {
  const map = new Map<number, ConsumedItem>();
  for (const sh of result.sheets) {
    const u = sh.unit;
    const existing = map.get(u.stockItemId);
    if (existing) existing.qty += 1;
    else {
      map.set(u.stockItemId, {
        stockItemId: u.stockItemId,
        kind: u.kind,
        name: u.stockName,
        width: round2(u.width),
        height: round2(u.height),
        grain: u.grain,
        qty: 1,
      });
    }
  }
  return [...map.values()].sort((a, b) => a.stockItemId - b.stockItemId);
}

function aggregateNewRemnants(sheets: PlanSheet[]): NewRemnant[] {
  const map = new Map<string, NewRemnant>();
  for (const sh of sheets) {
    for (const r of sh.remnants) {
      const k = `${r.w}x${r.h}@${sh.grain}`;
      const existing = map.get(k);
      if (existing) existing.qty += 1;
      else map.set(k, { width: r.w, height: r.h, grain: sh.grain, qty: 1 });
    }
  }
  return [...map.values()].sort((a, b) => a.width - b.width || a.height - b.height);
}

function aggregateUnplaced(
  unplaced: DemandItem[],
  units: UnitStock[],
): UnplacedPiece[] {
  const stockInfo = units.map((u) => ({
    width: u.width,
    height: u.height,
    usableW: u.usable.w,
    usableH: u.usable.h,
    grain: u.grain,
  }));
  const map = new Map<number, UnplacedPiece>();
  for (const item of unplaced) {
    const p = item.piece;
    const existing = map.get(p.id);
    if (existing) {
      existing.qty += 1;
      continue;
    }
    // 尺寸/纹向上任何一张材料都放不下 → 纸片过大；否则是现有库存数量耗尽
    const reason: UnplacedPiece['reason'] = anyStockCanContain(
      p.width,
      p.height,
      p.allowRotation,
      stockInfo,
      p.grainRequired,
    )
      ? 'INVENTORY_EXHAUSTED'
      : 'STOCK_TOO_SMALL';
    map.set(p.id, {
      pieceId: p.id,
      name: p.name,
      width: round2(p.width),
      height: round2(p.height),
      grainRequired: p.grainRequired,
      allowRotation: p.allowRotation,
      qty: 1,
      reason,
    });
  }
  return [...map.values()].sort((a, b) => a.pieceId - b.pieceId);
}

/* ---------------- 对外入口 ---------------- */

export interface PackInput {
  stock: StockItem[];
  pieces: OrderPiece[];
  settings: Settings;
  orderHash: string;
  settingsHash: string;
}

export function pack(input: PackInput): PlanPayload {
  const { stock, pieces, settings, orderHash, settingsHash } = input;
  const totalDemand = pieces.reduce((s, p) => s + p.quantity, 0);
  const units = expandStock(stock, settings);

  const strategies: StrategyKey[] = [
    'longSide',
    'shortSide',
    'areaDesc',
    'widthDesc',
  ];

  let best: RawResult | null = null;
  for (const strategy of strategies) {
    const r = runStrategy(units, pieces, settings, strategy);
    if (
      !best ||
      r.placed > best.placed ||
      (r.placed === best.placed && r.consumedArea < best.consumedArea)
    ) {
      best = r;
    }
  }

  const result = best!;
  const sheets = buildPlanSheets(result, settings);
  const consumed = aggregateConsumed(result);
  const newRemnants = aggregateNewRemnants(sheets);
  const unplaced = aggregateUnplaced(result.unplaced, units);

  const piecesUnplaced = unplaced.reduce((s, p) => s + p.qty, 0);
  const areaProduct = sheets.reduce((s, sh) => s + sh.areaProduct, 0);
  const areaRemnant = sheets.reduce((s, sh) => s + sh.areaRemnant, 0);
  const areaWaste = sheets.reduce((s, sh) => s + sh.areaWaste, 0);

  return {
    settings: {
      margin: round2(settings.margin),
      kerf: round2(settings.kerf),
      remnantMinWidth: round2(settings.remnantMinWidth),
      remnantMinHeight: round2(settings.remnantMinHeight),
    },
    orderHash,
    settingsHash,
    complete: totalDemand > 0 && piecesUnplaced === 0,
    sheets,
    consumed,
    newRemnants,
    unplaced,
    totals: {
      sheetsUsed: sheets.length,
      piecesPlaced: totalDemand - piecesUnplaced,
      piecesUnplaced,
      areaProduct: round2(areaProduct),
      areaRemnant: round2(areaRemnant),
      areaWaste: round2(areaWaste),
    },
  };
}
