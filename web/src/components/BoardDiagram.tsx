import { BoardResult } from '../types';

const PALETTE = [
  '#93c5fd', '#fca5a5', '#fcd34d', '#86efac', '#c4b5fd',
  '#fdba74', '#67e8f9', '#f9a8d4', '#a3e635', '#f0abfc',
  '#5eead4', '#fda4af', '#bef264', '#a5b4fc', '#fde68a',
];

export function pieceColor(pieceId: string): string {
  let h = 0;
  for (let i = 0; i < pieceId.length; i++) h = (h * 31 + pieceId.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

interface Props {
  board: BoardResult;
  width?: number;
}

/** 单张原张的逐刀示意 SVG：成品（彩色）、余料（绿）、废料（灰）、刀缝（红） */
export function BoardDiagram({ board, width = 420 }: Props) {
  const pad = 10;
  const scale = Math.min((width - pad * 2) / board.sourceW, 460 / board.sourceH);
  const w = board.sourceW * scale;
  const h = board.sourceH * scale;
  const svgW = w + pad * 2;
  const svgH = h + pad * 2 + 18;

  const t = (v: number) => v * scale;

  return (
    <svg width={svgW} height={svgH} role="img" aria-label={`第 ${board.boardIndex + 1} 张裁切示意`}>
      <g transform={`translate(${pad},${pad})`}>
        {/* 原张边框 */}
        <rect x={0} y={0} width={w} height={h} fill="#fafafa" stroke="#374151" strokeWidth={1.5} />

        {/* 废料 */}
        {board.waste.map((wr, i) => (
          <rect
            key={`w${i}`}
            x={t(wr.x)}
            y={t(wr.y)}
            width={Math.max(0, t(wr.w))}
            height={Math.max(0, t(wr.h))}
            fill="var(--waste)"
            opacity={0.85}
          />
        ))}

        {/* 可复用余料 */}
        {board.remnants.map((rm, i) => (
          <g key={`r${i}`}>
            <rect x={t(rm.x)} y={t(rm.y)} width={t(rm.w)} height={t(rm.h)} fill="var(--remnant)" stroke="#16a34a" strokeDasharray="4 2" />
            <text x={t(rm.x) + 4} y={t(rm.y) + 13} fontSize={10} fill="#166534">
              余料 {rm.w.toFixed(0)}×{rm.h.toFixed(0)}
            </text>
          </g>
        ))}

        {/* 成品 */}
        {board.placed.map((p, i) => (
          <g key={`p${i}`}>
            <rect
              x={t(p.x)}
              y={t(p.y)}
              width={t(p.w)}
              height={t(p.h)}
              fill={pieceColor(p.pieceId)}
              stroke="#1f2937"
              strokeWidth={0.8}
            >
              <title>{`${p.name}${p.rotated ? '（旋转90°）' : ''} @(${p.x},${p.y}) ${p.w}×${p.h}mm`}</title>
            </rect>
            {t(p.w) > 34 && t(p.h) > 16 && (
              <text
                x={t(p.x) + t(p.w) / 2}
                y={t(p.y) + t(p.h) / 2 + 3}
                fontSize={10}
                textAnchor="middle"
                fill="#111827"
              >
                {p.rotated ? '⟳ ' : ''}
                {p.name}
              </text>
            )}
          </g>
        ))}

        {/* 刀缝（贯穿当前子矩形的一刀） */}
        {board.cuts.map((c) => (
          <rect
            key={`c${c.id}`}
            x={t(c.x)}
            y={t(c.y)}
            width={Math.max(1.4, t(c.w))}
            height={Math.max(1.4, t(c.h))}
            fill="var(--cut)"
            opacity={0.9}
          >
            <title>{`第 ${c.id} 刀：${c.label}，贯穿 ${c.orientation === 'vertical' ? `${c.h}mm 高` : `${c.w}mm 宽`}`}</title>
          </rect>
        ))}

        {/* 尺寸标注 */}
        <text x={0} y={h + 15} fontSize={10} fill="var(--muted)">
          {board.sourceW} × {board.sourceH} mm
        </text>
      </g>
    </svg>
  );
}
