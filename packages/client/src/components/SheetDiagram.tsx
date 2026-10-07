import { useMemo, useState } from 'react';
import type { PlanSheet } from '@pcp/shared';

const PIECE_COLORS = [
  '#7db9d4', '#f2b482', '#9fce8e', '#d6a3c9', '#e8d27a',
  '#8ecac2', '#c99a74', '#a8b5d6', '#d98e8e', '#7fbf9b',
  '#b8a9d9', '#d4b07f',
];

function colorFor(pieceId: number): string {
  return PIECE_COLORS[pieceId % PIECE_COLORS.length]!;
}

const PAD = 18;

export function SheetDiagram({
  sheet,
  showCuts,
  highlightSeq,
}: {
  sheet: PlanSheet;
  showCuts: boolean;
  highlightSeq: number | null;
}) {
  const [hover, setHover] = useState<string | null>(null);

  const scale = useMemo(() => {
    const maxW = 460;
    const maxH = 420;
    return Math.min(maxW / sheet.width, maxH / sheet.height, 2.5);
  }, [sheet.width, sheet.height]);

  const W = sheet.width * scale + PAD * 2;
  const H = sheet.height * scale + PAD * 2;

  // SVG 坐标：x 向右，y 向下（纸张从上往下），与方案坐标一致
  const X = (x: number) => PAD + x * scale;
  const Y = (y: number) => PAD + y * scale;

  const cutOpacity = (seq: number) => {
    if (!showCuts) return 0;
    if (highlightSeq == null) return 0.9;
    return seq === highlightSeq ? 1 : 0.25;
  };

  return (
    <svg
      width={W}
      height={H}
      role="img"
      aria-label={`第 ${sheet.sheetNo} 张排样示意`}
    >
      <defs>
        <marker id="arrowR" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
          <path d="M0,0 L5,2.5 L0,5 Z" fill="#23323d" />
        </marker>
        <marker id="arrowL" markerWidth="5" markerHeight="5" refX="1" refY="2.5" orient="auto">
          <path d="M5,0 L0,2.5 L5,5 Z" fill="#23323d" />
        </marker>
      </defs>
      {/* 原料边框（白边整体） */}
      <rect
        x={X(0)}
        y={Y(0)}
        width={sheet.width * scale}
        height={sheet.height * scale}
        fill="#eceff1"
        stroke="#5c6b78"
        strokeWidth={1.5}
      />
      {/* 可用区（白边内侧） */}
      <rect
        x={X(sheet.usable.x)}
        y={Y(sheet.usable.y)}
        width={sheet.usable.w * scale}
        height={sheet.usable.h * scale}
        fill="#ffffff"
        stroke="#b9c2ca"
        strokeDasharray="3 3"
        strokeWidth={1}
      />

      {/* 可复用余料 */}
      {sheet.remnants.map((r, i) => (
        <g key={`r${i}`}>
          <rect
            x={X(r.x)}
            y={Y(r.y)}
            width={r.w * scale}
            height={r.h * scale}
            fill="#bfe0c6"
            fillOpacity={0.55}
            stroke="#4d9e6a"
            strokeWidth={1}
            strokeDasharray="5 3"
          />
          {r.w * scale > 34 && r.h * scale > 16 && (
            <text
              x={X(r.x) + 4}
              y={Y(r.y) + 13}
              fontSize={10}
              fill="#22613b"
            >
              {r.label}
            </text>
          )}
        </g>
      ))}

      {/* 废料空区 */}
      {sheet.wasteRects.map((r, i) => (
        <g key={`w${i}`}>
          <rect
            x={X(r.x)}
            y={Y(r.y)}
            width={r.w * scale}
            height={r.h * scale}
            fill="#d9b3a8"
            fillOpacity={0.6}
            stroke="#a86a5a"
            strokeWidth={0.8}
          />
        </g>
      ))}

      {/* 成品 */}
      {sheet.placements.map((p, i) => {
        const key = `p${i}`;
        const active = hover === key;
        return (
          <g
            key={key}
            onMouseEnter={() => setHover(key)}
            onMouseLeave={() => setHover(null)}
          >
            <rect
              x={X(p.x)}
              y={Y(p.y)}
              width={p.w * scale}
              height={p.h * scale}
              fill={colorFor(p.pieceId)}
              fillOpacity={active ? 1 : 0.85}
              stroke="#23323d"
              strokeWidth={active ? 1.6 : 0.8}
            />
            {/* 纹向标记：双箭头沿丝缕方向（x 横向 / y 纵向） */}
            {p.grain !== 'none' && (
              <g
                stroke="#23323d"
                strokeWidth={1}
                opacity={0.7}
                markerStart="url(#arrowL)"
                markerEnd="url(#arrowR)"
              >
                {p.grain === 'x' ? (
                  <line
                    x1={X(p.x) + p.w * scale * 0.22}
                    y1={Y(p.y) + p.h * scale / 2}
                    x2={X(p.x) + p.w * scale * 0.78}
                    y2={Y(p.y) + p.h * scale / 2}
                  />
                ) : (
                  <line
                    x1={X(p.x) + p.w * scale / 2}
                    y1={Y(p.y) + p.h * scale * 0.78}
                    x2={X(p.x) + p.w * scale / 2}
                    y2={Y(p.y) + p.h * scale * 0.22}
                  />
                )}
              </g>
            )}
            {p.w * scale > 30 && p.h * scale > 18 && (
              <text
                x={X(p.x) + p.w * scale / 2}
                y={Y(p.y) + p.h * scale / 2 + 3}
                textAnchor="middle"
                fontSize={Math.min(11, 9 + p.w * scale * 0.02)}
                fill="#16222b"
                pointerEvents="none"
              >
                {p.pieceIndex}
              </text>
            )}
          </g>
        );
      })}

      {/* 切线：v 为竖线（沿 y 贯穿），h 为横线（沿 x 贯穿） */}
      {sheet.cuts.map((c) => {
        const common = {
          stroke: c.seq === highlightSeq ? '#e63946' : '#c0392b',
          strokeWidth: c.seq === highlightSeq ? 2.2 : 1.2,
          strokeDasharray: '6 3',
          opacity: cutOpacity(c.seq),
        };
        if (c.axis === 'v') {
          return (
            <line
              key={`c${c.seq}`}
              x1={X(c.at)}
              y1={Y(c.from)}
              x2={X(c.at)}
              y2={Y(c.to)}
              {...common}
            />
          );
        }
        return (
          <line
            key={`c${c.seq}`}
            x1={X(c.from)}
            y1={Y(c.at)}
            x2={X(c.to)}
            y2={Y(c.at)}
            {...common}
          />
        );
      })}

      {/* 刀序编号 */}
      {showCuts &&
        sheet.cuts.map((c) => {
          if (highlightSeq != null && c.seq !== highlightSeq) return null;
          const cx = c.axis === 'v' ? X(c.at) : X(c.at);
          const cy = c.axis === 'v' ? Y(c.from) + 10 : Y(c.at) - 4;
          return (
            <text
              key={`n${c.seq}`}
              x={cx + (c.axis === 'v' ? 4 : 0)}
              y={cy}
              fontSize={9}
              fill="#c0392b"
              textAnchor={c.axis === 'h' ? 'middle' : 'start'}
            >
              {c.seq}
            </text>
          );
        })}

      {/* 尺寸标注 */}
      <text x={W / 2} y={H - 4} fontSize={10} textAnchor="middle" fill="#66788a">
        {sheet.width} × {sheet.height} mm · 纹向 {sheet.grain === 'none' ? '无' : sheet.grain}
        {' '}· 利用率 {(sheet.utilization * 100).toFixed(1)}%
      </text>
    </svg>
  );
}
