import { useEffect, useState } from 'react';
import { api } from '../api';
import { BoardResult, Grain, PieceSpec, PlanResult, PlanRequest, StockItem } from '../types';
import { BoardDiagram } from './BoardDiagram';

const grainLabel: Record<Grain, string> = { vertical: '竖纹', horizontal: '横纹', none: '无要求' };

let cidSeq = 1;
const newPiece = (): PieceSpec => ({
  cid: `new${cidSeq++}`,
  name: '',
  width: 0,
  height: 0,
  quantity: 1,
  allowRotation: true,
  grain: 'none',
});

const DEFAULT_PIECES: PieceSpec[] = [
  { cid: 'p1', name: '名片', width: 90, height: 54, quantity: 30, allowRotation: true, grain: 'none' },
  { cid: 'p2', name: '卡片', width: 210, height: 148, quantity: 6, allowRotation: false, grain: 'vertical' },
];

export function PlannerTab() {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [pieces, setPieces] = useState<PieceSpec[]>(DEFAULT_PIECES);
  const [params, setParams] = useState({ margin: 10, kerf: 3, remnantMinWidth: 150, remnantMinHeight: 100 });
  const [selectedStock, setSelectedStock] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<PlanResult | null>(null);
  const [planName, setPlanName] = useState('');
  const [savedId, setSavedId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [msgKind, setMsgKind] = useState<'ok' | 'warn'>('ok');

  const refreshStock = async () => {
    const data = await api.listStock();
    setStock(data.items);
    setSelectedStock((prev) => {
      const next = new Set([...prev].filter((id) => data.items.some((s) => s.id === id)));
      return next;
    });
  };

  useEffect(() => {
    refreshStock().catch((e) => setError(e.message));
  }, []);

  const updatePiece = (cid: string, patch: Partial<PieceSpec>) => {
    setPieces((ps) => ps.map((p) => (p.cid === cid ? { ...p, ...patch } : p)));
  };

  const buildRequest = (): PlanRequest => ({
    ...params,
    pieces: pieces.map(({ cid, ...rest }) => ({ cid, ...rest })),
    stockIds: [...selectedStock],
  });

  const preview = async () => {
    setError('');
    setMsg('');
    setBusy(true);
    try {
      const r = await api.preview(buildRequest());
      setResult(r);
      setSavedId(null);
      if (r.complete) {
        setMsgKind('ok');
        setMsg(`试排完成：全部 ${r.totals.piecesRequired} 片均可排入（试排不占用库存）`);
      } else {
        setMsgKind('warn');
        setMsg(`整单未排下：仅 ${r.totals.piecesPlaced}/${r.totals.piecesRequired} 片排入，${r.unplaced.reduce((s, u) => s + u.quantity, 0)} 片未排入；此结果不是完整方案，不能确认。`);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!result || !planName.trim()) {
      setError('请先试排并填写方案名称');
      return;
    }
    setError('');
    setBusy(true);
    try {
      const saved = await api.savePlan({ name: planName.trim(), request: buildRequest(), result });
      setResult(saved.result);
      setSavedId(saved.id);
      setMsgKind('ok');
      setMsg(`方案「${planName}」已保存为草稿（id=${saved.id}），未扣减库存；可前往“方案列表”确认。`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleStock = (id: number) => {
    setSelectedStock((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div>
      {error && <div className="banner err">{error}</div>}
      {msg && <div className={`banner ${msgKind}`}>{msg}</div>}

      <div className="panel">
        <h2>① 订单纸片</h2>
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 130 }}>名称</th>
              <th>宽(mm)</th>
              <th>高(mm)</th>
              <th>数量</th>
              <th>允许旋转90°</th>
              <th>纸片纹向</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pieces.map((p) => (
              <tr key={p.cid} className="piece-edit">
                <td><input value={p.name} onChange={(e) => updatePiece(p.cid, { name: e.target.value })} /></td>
                <td><input type="number" min="1" value={p.width || ''} onChange={(e) => updatePiece(p.cid, { width: Number(e.target.value) })} /></td>
                <td><input type="number" min="1" value={p.height || ''} onChange={(e) => updatePiece(p.cid, { height: Number(e.target.value) })} /></td>
                <td><input type="number" min="1" step="1" value={p.quantity || ''} onChange={(e) => updatePiece(p.cid, { quantity: Number(e.target.value) })} /></td>
                <td className="checkbox-cell">
                  <input type="checkbox" checked={p.allowRotation} onChange={(e) => updatePiece(p.cid, { allowRotation: e.target.checked })} />
                </td>
                <td>
                  <select value={p.grain} onChange={(e) => updatePiece(p.cid, { grain: e.target.value as Grain })}>
                    <option value="none">无要求</option>
                    <option value="vertical">竖纹</option>
                    <option value="horizontal">横纹</option>
                  </select>
                </td>
                <td><button className="btn danger" onClick={() => setPieces((ps) => ps.filter((x) => x.cid !== p.cid))}>删</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn secondary" onClick={() => setPieces((ps) => [...ps, newPiece()])}>+ 添加规格</button>
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h2>② 工艺参数</h2>
          <div className="row">
            <div className="field">
              <label>原料边距 (mm)</label>
              <input className="num" type="number" min="0" value={params.margin} onChange={(e) => setParams({ ...params, margin: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>刀缝宽 (mm)</label>
              <input className="num" type="number" min="0" value={params.kerf} onChange={(e) => setParams({ ...params, kerf: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>余料最小宽 (mm)</label>
              <input className="num" type="number" min="0" value={params.remnantMinWidth} onChange={(e) => setParams({ ...params, remnantMinWidth: Number(e.target.value) })} />
            </div>
            <div className="field">
              <label>余料最小高 (mm)</label>
              <input className="num" type="number" min="0" value={params.remnantMinHeight} onChange={(e) => setParams({ ...params, remnantMinHeight: Number(e.target.value) })} />
            </div>
          </div>
          <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
            边距为原张四边不可用区域；每次贯穿裁切占用一个刀缝宽；小于余料最小长宽的剩余矩形计为废料。
          </p>
        </div>

        <div className="panel">
          <h2>③ 参与试排的库存（不勾选=全部）</h2>
          <div style={{ maxHeight: 170, overflow: 'auto' }}>
            <table>
              <tbody>
                {stock.map((s) => (
                  <tr key={s.id}>
                    <td className="checkbox-cell" style={{ width: 30 }}>
                      <input type="checkbox" checked={selectedStock.has(s.id)} onChange={() => toggleStock(s.id)} />
                    </td>
                    <td>{s.name}</td>
                    <td className="muted">{s.width}×{s.height} ×{s.quantity}</td>
                    <td><span className={`tag ${s.kind}`}>{s.kind === 'sheet' ? '原张' : '余料'}</span></td>
                    <td className="muted">{grainLabel[s.grain]}</td>
                  </tr>
                ))}
                {stock.length === 0 && <tr><td className="muted">暂无库存</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="row">
          <button className="btn" disabled={busy} onClick={preview}>{busy ? '计算中…' : '④ 试排'}</button>
          <div className="field">
            <label>方案名称（保存用）</label>
            <input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="如：10月名片订单" style={{ width: 220 }} />
          </div>
          <button className="btn secondary" disabled={busy || !result} onClick={save}>⑤ 保存方案（草稿，不占库存）</button>
          {savedId && <span className="muted">已保存 #{savedId}</span>}
        </div>
      </div>

      {result && <ResultView result={result} />}
    </div>
  );
}

function ResultView({ result }: { result: PlanResult }) {
  const t = result.totals;
  return (
    <div className="panel">
      <h2>
        试排结果{' '}
        {result.complete ? (
          <span className="tag confirmed">完整方案：{t.piecesPlaced}/{t.piecesRequired} 片已排入</span>
        ) : (
          <span className="tag incomplete">非完整方案：仅排入 {t.piecesPlaced}/{t.piecesRequired} 片</span>
        )}
        <span className="muted" style={{ fontWeight: 400, marginLeft: 10 }}>基于库存版本 v{result.stockVersion}</span>
      </h2>

      <div className="stats">
        <div className="stat"><b>{t.sheetsUsed}</b><span>消耗原张</span></div>
        <div className="stat"><b>{t.remnantsUsed}</b><span>消耗余料</span></div>
        <div className="stat"><b>{t.usedArea.toLocaleString()}</b><span>成品面积 mm²</span></div>
        <div className="stat"><b>{t.wasteArea.toLocaleString()}</b><span>废料面积 mm²</span></div>
        <div className="stat"><b>{t.remnantArea.toLocaleString()}</b><span>可复用余料 mm²</span></div>
      </div>

      <h3>库存占用（确认前不实际扣减）</h3>
      <div>
        {result.stockUsage.map((u) => (
          <span key={u.stockId} className={`tag ${u.kind}`} style={{ marginRight: 8 }}>
            {u.name} × {u.quantity}
          </span>
        ))}
      </div>

      {result.unplaced.length > 0 && (
        <>
          <h3 style={{ color: 'var(--danger)' }}>未排入纸片</h3>
          <table>
            <thead><tr><th>名称</th><th>规格(mm)</th><th>未排数量</th><th>原因</th></tr></thead>
            <tbody>
              {result.unplaced.map((u) => (
                <tr key={`${u.pieceId}-${u.width}x${u.height}`}>
                  <td>{u.name}</td>
                  <td>{u.width}×{u.height}</td>
                  <td>{u.quantity}</td>
                  <td className="muted">{u.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h3>逐张示意与切割顺序（红条为贯穿刀缝，编号即下刀顺序）</h3>
      <div className="legend">
        <span><i className="swatch" style={{ background: 'var(--waste)' }} />废料 / 边距</span>
        <span><i className="swatch" style={{ background: 'var(--remnant)' }} />可复用余料</span>
        <span><i className="swatch" style={{ background: 'var(--cut)' }} />刀缝</span>
        <span className="muted">彩色块为成品，⟳ 表示旋转 90°</span>
      </div>
      <div className="boards-wrap">
        {result.boards.map((b: BoardResult) => (
          <div className="board-card" key={b.boardIndex}>
            <h4>
              第 {b.boardIndex + 1} 张：{b.stockName}（{b.sourceW}×{b.sourceH}，{grainLabel[b.grain]}）
            </h4>
            <BoardDiagram board={b} />
            <div className="cut-list">
              <strong>切割顺序（{b.cuts.length} 刀）：</strong>
              <ol style={{ margin: '4px 0 0 18px', padding: 0 }}>
                {b.cuts.map((c) => (
                  <li key={c.id}>
                    第 {c.id} 刀 · {c.orientation === 'vertical' ? '垂切' : '横切'} · {c.label}
                    ，贯穿 {c.orientation === 'vertical' ? `${c.h}mm` : `${c.w}mm`}
                  </li>
                ))}
                {b.cuts.length === 0 && <li className="muted">无切分（恰好填满）</li>}
              </ol>
              {b.remnants.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  保留余料：
                  {b.remnants.map((rm, i) => (
                    <span key={i} className="tag remnant" style={{ marginRight: 6 }}>
                      {rm.w.toFixed(1)}×{rm.h.toFixed(1)} @({rm.x.toFixed(0)},{rm.y.toFixed(0)})
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
