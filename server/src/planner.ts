import {
  BoardResult,
  Cut,
  Grain,
  PieceSpec,
  PlacedPiece,
  PlanParams,
  PlanRequest,
  PlanResult,
  Rect,
  ReusableRemnant,
  StockItem,
  UnplacedPiece,
  WasteRect,
} from './types';

const EPS = 1e-6;

/** 保留 3 位小数，消除浮点误差 */
const r3 = (n: number): number => Math.round(n * 1000) / 1000;
const area = (r: Rect): number => r.w * r.h;

interface UnitPiece {
  pieceId: string;
  name: string;
  /** 原始规格（未旋转）尺寸 */
  sw: number;
  sh: number;
  allowRotation: boolean;
  grain: Grain;
  reason?: string;
}

interface FreeNode extends Rect {
  /** 该节点是否已被判定为可保留余料（不再参与排料） */
  remnant?: boolean;
}

interface BoardState {
  stockId: number;
  stockName: string;
  kind: 'sheet' | 'remnant';
  sourceW: number;
  sourceH: number;
  grain: Grain;
  /** 去掉四边边距后的可用区域 */
  inner: Rect;
  free: FreeNode[];
  placed: PlacedPiece[];
  cuts: Cut[];
  waste: WasteRect[];
}

/**
 * 判断纸片方向与原张纹向是否兼容。
 * 纹向描述纹理的延伸方向（vertical=沿 y 轴，horizontal=沿 x 轴）。
 * 纸片的纵向（h 边方向）必须与原张纹理方向一致；任一方为 none 时不限制。
 */
function grainCompatible(pieceGrain: Grain, boardGrain: Grain): boolean {
  if (pieceGrain === 'none' || boardGrain === 'none') return true;
  return pieceGrain === boardGrain;
}

/** 纸片以给定朝向放入时，其纹理方向是否仍满足要求 */
function orientationGrainOk(p: UnitPiece, rotated: boolean, boardGrain: Grain): boolean {
  if (p.grain === 'none' || boardGrain === 'none') return true;
  // 原规格下纸片纵向为 sh 边；旋转 90° 后纵向变为 sw 边，纹理随之转动
  const effective: Grain = rotated
    ? p.grain === 'vertical'
      ? 'horizontal'
      : 'vertical'
    : p.grain;
  return effective === boardGrain;
}

/** 初始化一张板：裁掉四边边距（作为废料），内部成为第一个空闲节点 */
function initBoard(stock: StockItem, params: PlanParams): BoardState {
  const { margin } = params;
  const inner: Rect = { x: margin, y: margin, w: stock.width - 2 * margin, h: stock.height - 2 * margin };
  const waste: WasteRect[] = [];

  if (margin > EPS) {
    // 四边边距作为边废料（仅示意，不产生贯穿切刀；若需要先修边可视为既有修边工序）
    waste.push({ x: 0, y: 0, w: stock.width, h: margin, reason: 'margin' });
    waste.push({ x: 0, y: stock.height - margin, w: stock.width, h: margin, reason: 'margin' });
    waste.push({ x: 0, y: margin, w: margin, h: stock.height - 2 * margin, reason: 'margin' });
    waste.push({ x: stock.width - margin, y: margin, w: margin, h: stock.height - 2 * margin, reason: 'margin' });
  }

  return {
    stockId: stock.id,
    stockName: stock.name,
    kind: stock.kind,
    sourceW: stock.width,
    sourceH: stock.height,
    grain: stock.grain,
    inner,
    free: [{ ...inner }],
    placed: [],
    cuts: [],
    waste,
  };
}

interface PlaceOption {
  node: FreeNode;
  rotated: boolean;
  w: number;
  h: number;
}

/** 在一个空闲节点里尝试放入纸片，返回可行朝向（不旋转优先） */
function fitInNode(p: UnitPiece, node: FreeNode, board: BoardState, kerf: number): PlaceOption | null {
  const tries: { rotated: boolean; w: number; h: number }[] = [];
  if (p.sw <= node.w + EPS && p.sh <= node.h + EPS) {
    tries.push({ rotated: false, w: p.sw, h: p.sh });
  }
  if (p.allowRotation) {
    // 旋转后的物理尺寸
    const rw = p.sh;
    const rh = p.sw;
    const sameDims = Math.abs(tries[0]?.w - rw) < EPS && Math.abs(tries[0]?.h - rh) < EPS;
    // 方形纸片尺寸虽相同，旋转仍可能改变纹向匹配，故尺寸相同时也保留旋转朝向
    if (rw <= node.w + EPS && rh <= node.h + EPS && (!sameDims || p.grain !== 'none')) {
      tries.push({ rotated: true, w: rw, h: rh });
    }
  }
  for (const t of tries) {
    if (!orientationGrainOk(p, t.rotated, board.grain)) continue;
    // 只要不旋转方向能放下即可（无剩余条带时不需要刀缝）
    const rightGap = node.w - t.w;
    const bottomGap = node.h - t.h;
    if (rightGap > EPS && rightGap < kerf - EPS) continue;
    if (bottomGap > EPS && bottomGap < kerf - EPS) continue;
    return { node, rotated: t.rotated, w: t.w, h: t.h };
  }
  return null;
}

/**
 * 放入纸片后以贯穿刀缝切分节点。
 * 垂切：沿纸片右边（或完整贴合时不切），把右侧条带切出，再在左（上）区域横切分出下侧；
 * 横切顺序对称。两种分法都评估，选保留大块更完整、刀缝损失更小的一种。
 */
function splitNode(
  board: BoardState,
  node: FreeNode,
  opt: PlaceOption,
  params: PlanParams,
): { free: FreeNode[] } {
  const { kerf } = params;
  const rightGap = node.w - opt.w;
  const bottomGap = node.h - opt.h;
  const newFree: FreeNode[] = [];
  const alternatives: { nodes: FreeNode[]; score: number }[] = [];

  // —— 方案 A：先垂切（右条带），再横切（左下条带）——
  if (rightGap <= EPS && bottomGap <= EPS) {
    // 恰好填满，无切分
    alternatives.push({ nodes: [], score: 0 });
  } else {
    const nodesA: FreeNode[] = [];
    let scoreA = 0;
    if (rightGap > EPS) {
      // 贯穿垂切：x = node.x + opt.w，刀缝宽 kerf
      board.cuts.push({
        id: 0,
        x: node.x + opt.w,
        y: node.y,
        w: kerf,
        h: node.h,
        orientation: 'vertical',
        position: node.x + opt.w,
        label: `垂切 @${r3(node.x + opt.w)}`,
      });
      nodesA.push({ x: node.x + opt.w + kerf, y: node.y, w: rightGap - kerf, h: node.h });
      scoreA += kerf * node.h;
    }
    if (bottomGap > EPS) {
      // 贯穿横切（在纸片所在的左侧区域）
      board.cuts.push({
        id: 0,
        x: node.x,
        y: node.y + opt.h,
        w: opt.w,
        h: kerf,
        orientation: 'horizontal',
        position: node.y + opt.h,
        label: `横切 @${r3(node.y + opt.h)}`,
      });
      nodesA.push({ x: node.x, y: node.y + opt.h + kerf, w: opt.w, h: bottomGap - kerf });
      scoreA += opt.w * kerf;
    }
    alternatives.push({ nodes: nodesA, score: scoreA });

    // —— 方案 B：先横切（下条带），再垂切（右上条带）——
    const nodesB: FreeNode[] = [];
    let scoreB = 0;
    if (bottomGap > EPS) {
      nodesB.push({ x: node.x, y: node.y + opt.h + kerf, w: node.w, h: bottomGap - kerf });
      scoreB += node.w * kerf;
    }
    if (rightGap > EPS) {
      nodesB.push({ x: node.x + opt.w + kerf, y: node.y, w: rightGap - kerf, h: opt.h });
      scoreB += kerf * opt.h;
    }
    // 评估：偏好剩余大块面积更大（利于后续大纸片），刀缝损失更小
    const scoreNodes = (ns: FreeNode[]): number =>
      ns.reduce((m, n) => m + (n.w > EPS && n.h > EPS ? Math.max(n.w, n.h) * Math.min(n.w, n.h) : 0), 0);
    const aOk = nodesA.every((n) => n.w >= -EPS && n.h >= -EPS);
    const bOk = nodesB.every((n) => n.w >= -EPS && n.h >= -EPS);
    const best =
      aOk && bOk
        ? scoreNodes(nodesB) > scoreNodes(nodesA) + EPS
          ? 'B'
          : 'A'
        : aOk
          ? 'A'
          : 'B';
    if (best === 'B') {
      // 撤销方案 A 已登记的切刀，改用方案 B
      if (rightGap > EPS) board.cuts.pop();
      if (bottomGap > EPS) board.cuts.pop();
      if (bottomGap > EPS) {
        board.cuts.push({
          id: 0,
          x: node.x,
          y: node.y + opt.h,
          w: node.w,
          h: kerf,
          orientation: 'horizontal',
          position: node.y + opt.h,
          label: `横切 @${r3(node.y + opt.h)}`,
        });
      }
      if (rightGap > EPS) {
        board.cuts.push({
          id: 0,
          x: node.x + opt.w,
          y: node.y,
          w: kerf,
          h: opt.h,
          orientation: 'vertical',
          position: node.x + opt.w,
          label: `垂切 @${r3(node.x + opt.w)}`,
        });
      }
      alternatives[0] = { nodes: nodesB, score: scoreB };
    }
  }

  const chosen = alternatives[0];
  for (const n of chosen.nodes) {
    if (n.w > EPS && n.h > EPS) newFree.push(n);
  }
  return { free: newFree };
}

/** 在一张已启用的板上找最佳放置点 */
function findBoardOption(
  board: BoardState,
  p: UnitPiece,
  params: PlanParams,
): (PlaceOption & { freeIndex: number; score: number }) | null {
  let best: (PlaceOption & { freeIndex: number; score: number }) | null = null;
  board.free.forEach((node, idx) => {
    if (node.remnant) return;
    const opt = fitInNode(p, node, board, params.kerf);
    if (!opt) return;
    // 偏好：剩余空间更贴合（短边剩余小）、节点更小（优先填小坑）
    const slack = (node.w - opt.w) + (node.h - opt.h);
    const nodeArea = node.w * node.h;
    const score = slack + nodeArea * 1e-6;
    if (!best || score < best.score) best = { ...opt, freeIndex: idx, score };
  });
  return best;
}

/** 判断空闲节点是否达到余料保留门槛 */
function isRemnant(n: FreeNode, params: PlanParams): boolean {
  return n.w >= params.remnantMinWidth - EPS && n.h >= params.remnantMinHeight - EPS;
}

/** 展开规格为单件纸片 */
function flatten(pieces: PieceSpec[]): UnitPiece[] {
  const units: UnitPiece[] = [];
  pieces.forEach((p, i) => {
    const baseId = p.cid || `P${i + 1}`;
    for (let k = 0; k < p.quantity; k++) {
      units.push({
        pieceId: baseId,
        name: p.name,
        sw: p.width,
        sh: p.height,
        allowRotation: p.allowRotation,
        grain: p.grain,
      });
    }
  });
  return units;
}

/**
 * 排料主入口（纯函数，不触碰数据库）。
 * 策略：纸片按面积降序（不可旋转优先），逐件在已启用板中找最佳坑位；
 * 找不到则从库存（余料优先、小面积优先）启用一张新板；仍放不下记为未排入。
 */
export function buildPlan(request: PlanRequest, stock: StockItem[], stockVersion: number): PlanResult {
  const params: PlanParams = {
    margin: request.margin,
    kerf: request.kerf,
    remnantMinWidth: request.remnantMinWidth,
    remnantMinHeight: request.remnantMinHeight,
  };

  // 库存池：按规格复制 quantity 份，余料优先、面积小者优先（先吃余料）
  const allow = new Set(request.stockIds && request.stockIds.length ? request.stockIds : []);
  const pool: StockItem[] = [];
  stock
    .filter((s) => s.quantity > 0 && (allow.size === 0 || allow.has(s.id)))
    .forEach((s) => {
      for (let k = 0; k < s.quantity; k++) pool.push(s);
    });
  pool.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'remnant' ? -1 : 1;
    return a.width * a.height - b.width * b.height;
  });

  const units = flatten(request.pieces).sort((a, b) => {
    if (a.allowRotation !== b.allowRotation) return a.allowRotation ? 1 : -1;
    return b.sw * b.sh - a.sw * a.sh;
  });

  const boards: BoardState[] = [];
  const usedStock = new Map<number, StockItem>();
  const unplaced: UnitPiece[] = [];

  for (const p of units) {
    let placed = false;

    // 1) 在已启用的板中找坑位
    let target: { board: BoardState; opt: PlaceOption & { freeIndex: number; score: number } } | null = null;
    for (const board of boards) {
      const opt = findBoardOption(board, p, params);
      if (opt && (!target || opt.score < target.opt.score)) {
        target = { board, opt };
      }
    }

    // 2) 评估启用新板（与现有坑位比较：优先更小的总面积代价；现有板优先以提高利用率）
    if (!target) {
      const poolIdx = pool.findIndex((s) => {
        const tmp = initBoard(s, params);
        if (tmp.inner.w < -EPS || tmp.inner.h < -EPS) return false;
        return findBoardOption(tmp, p, params) !== null;
      });
      if (poolIdx >= 0) {
        const [s] = pool.splice(poolIdx, 1);
        const board = initBoard(s, params);
        usedStock.set(s.id, s);
        boards.push(board);
        const opt = findBoardOption(board, p, params);
        if (opt) target = { board, opt };
      }
    }

    if (target) {
      const { board, opt } = target;
      const node = board.free[opt.freeIndex];
      board.placed.push({
        x: node.x,
        y: node.y,
        w: opt.w,
        h: opt.h,
        pieceId: p.pieceId,
        name: p.name,
        rotated: opt.rotated,
      });
      const { free } = splitNode(board, node, opt, params);
      board.free.splice(opt.freeIndex, 1, ...free);
      placed = true;
    }

    if (!placed) {
      // 纹向不兼容 / 所有库存都装不下
      const grainIssue = !pool.some((s) => grainCompatible(p.grain, s.grain));
      p.reason = grainIssue ? '没有纹向兼容且尺寸足够的库存' : '现有库存面积/尺寸不足';
      unplaced.push(p);
    }
  }

  // 收尾：空闲节点分为可保留余料与废料；切刀编号
  const boardResults: BoardResult[] = boards.map((b, bi) => {
    const remnants: ReusableRemnant[] = [];
    for (const n of b.free) {
      if (isRemnant(n, params)) {
        remnants.push({ x: r3(n.x), y: r3(n.y), w: r3(n.w), h: r3(n.h), area: r3(area(n)) });
      } else {
        b.waste.push({ x: n.x, y: n.y, w: n.w, h: n.h, reason: 'offcut' });
      }
    }
    b.cuts.forEach((c, i) => {
      c.id = i + 1;
    });
    const usedArea = b.placed.reduce((s, p) => s + p.w * p.h, 0);
    const remnantArea = remnants.reduce((s, n) => s + n.w * n.h, 0);
    const wasteArea = b.sourceW * b.sourceH - usedArea - remnantArea;
    return {
      boardIndex: bi,
      stockId: b.stockId,
      stockName: b.stockName,
      kind: b.kind,
      sourceW: r3(b.sourceW),
      sourceH: r3(b.sourceH),
      grain: b.grain,
      placed: b.placed.map((p) => ({ ...p, x: r3(p.x), y: r3(p.y), w: r3(p.w), h: r3(p.h) })),
      cuts: b.cuts.map((c) => ({ ...c, x: r3(c.x), y: r3(c.y), w: r3(c.w), h: r3(c.h), position: r3(c.position) })),
      waste: b.waste
        .filter((w) => w.w > EPS && w.h > EPS)
        .map((w) => ({ ...w, x: r3(w.x), y: r3(w.y), w: r3(w.w), h: r3(w.h) })),
      remnants,
      usedArea: r3(usedArea),
      wasteArea: r3(Math.max(0, wasteArea)),
      remnantArea: r3(remnantArea),
    };
  });

  // 聚合未排入纸片
  const unplacedAgg = new Map<string, UnplacedPiece>();
  for (const p of unplaced) {
    const key = `${p.pieceId}|${p.sw}x${p.sh}`;
    const ex = unplacedAgg.get(key);
    const reason = p.reason || '现有库存不足';
    if (ex) ex.quantity += 1;
    else
      unplacedAgg.set(key, {
        pieceId: p.pieceId,
        name: p.name,
        width: p.sw,
        height: p.sh,
        rotated: false,
        quantity: 1,
        reason,
      });
  }

  // 库存用量（按 stockId 聚合张数）
  const usageMap = new Map<number, { stockId: number; name: string; kind: 'sheet' | 'remnant'; quantity: number }>();
  for (const b of boards) {
    const s = usedStock.get(b.stockId)!;
    const ex = usageMap.get(b.stockId);
    if (ex) ex.quantity += 1;
    else usageMap.set(b.stockId, { stockId: b.stockId, name: s.name, kind: s.kind, quantity: 1 });
  }

  const required = request.pieces.reduce((s, p) => s + p.quantity, 0);
  const placedCount = required - unplaced.length;

  return {
    params,
    complete: unplaced.length === 0 && required > 0,
    boards: boardResults,
    unplaced: [...unplacedAgg.values()],
    totals: {
      piecesPlaced: placedCount,
      piecesRequired: required,
      sheetsUsed: boardResults.filter((b) => b.kind === 'sheet').length,
      remnantsUsed: boardResults.filter((b) => b.kind === 'remnant').length,
      usedArea: r3(boardResults.reduce((s, b) => s + b.usedArea, 0)),
      wasteArea: r3(boardResults.reduce((s, b) => s + b.wasteArea, 0)),
      remnantArea: r3(boardResults.reduce((s, b) => s + b.remnantArea, 0)),
    },
    stockVersion,
    stockUsage: [...usageMap.values()],
  };
}
