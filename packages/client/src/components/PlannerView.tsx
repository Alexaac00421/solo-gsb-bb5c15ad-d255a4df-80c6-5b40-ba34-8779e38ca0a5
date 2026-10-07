import { useCallback, useEffect, useState } from 'react';
import type { Plan, PlanPayload } from '@pcp/shared';
import { api, PlanApiError } from '../api.js';
import { useAsync } from '../useAsync.js';
import { SheetDiagram } from './SheetDiagram.js';

function fmtArea(mm2: number): string {
  if (mm2 >= 1e6) return `${(mm2 / 1e6).toFixed(2)} m²`;
  return `${(mm2 / 100).toFixed(1)} cm²`;
}

export function PlannerView({
  orderId,
  onPickOrder,
}: {
  orderId: number | null;
  onPickOrder: () => void;
}) {
  const { data: orders } = useAsync(() => api.listOrders(), []);
  const [internalOrderId, setInternalOrderId] = useState<number | null>(orderId);
  const activeOrderId = orderId ?? internalOrderId;

  const [plan, setPlan] = useState<PlanPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<
    { kind: 'error' | 'success' | 'warn'; text: string; reasons?: string[] } | null
  >(null);
  const [savedPlan, setSavedPlan] = useState<Plan | null>(null);
  const [showCuts, setShowCuts] = useState(true);
  const [highlightSeq, setHighlightSeq] = useState<number | null>(null);
  const [activeSheet, setActiveSheet] = useState(1);

  useEffect(() => {
    setPlan(null);
    setSavedPlan(null);
    setMsg(null);
    setActiveSheet(1);
  }, [activeOrderId]);

  const runPreview = useCallback(async () => {
    if (activeOrderId == null) return;
    setBusy(true);
    setMsg(null);
    setSavedPlan(null);
    try {
      const { plan: p } = await api.previewPlan(activeOrderId);
      setPlan(p);
      setActiveSheet(1);
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }, [activeOrderId]);

  const save = async () => {
    if (activeOrderId == null) return;
    setBusy(true);
    setMsg(null);
    try {
      const p = await api.savePlan(activeOrderId);
      setSavedPlan(p);
      setMsg({
        kind: 'success',
        text: `方案 #${p.id} 已保存（草稿，未占用库存）。确认前库存可继续用于其他试排。`,
      });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async () => {
    if (!savedPlan) return;
    if (
      !window.confirm(
        `确认方案 #${savedPlan.id}？系统将原子扣减原料并把可复用余料入库；确认后不可撤销，重复提交不会重复扣料。`,
      )
    )
      return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.confirmPlan(savedPlan.id);
      setMsg({
        kind: 'success',
        text: `已确认：扣减 ${r.stockChanges.filter((c) => c.delta < 0).length} 项原料、入库余料 ${r.remnantsAdded} 张。订单已完成。`,
      });
      setSavedPlan(r.plan);
    } catch (e) {
      if (e instanceof PlanApiError) {
        setMsg({
          kind: 'error',
          text: e.message,
          reasons: e.reasons,
        });
      } else {
        setMsg({ kind: 'error', text: (e as Error).message });
      }
      // 方案失效：拉取最新试排供重排
      if ((e as PlanApiError).code === 'PLAN_STALE') {
        setSavedPlan(null);
        await runPreview();
        setMsg({
          kind: 'error',
          text: '已存方案因库存/订单/工艺变化失效，已按当前库存重新试排，请核对后重新保存。',
          reasons: (e as PlanApiError).reasons,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const activeOrder = orders?.find((o) => o.id === activeOrderId);
  const confirmed = savedPlan?.status === 'confirmed';
  const displayedSheet = plan?.sheets.find((s) => s.sheetNo === activeSheet) ?? plan?.sheets[0];

  return (
    <>
      <div className="panel">
        <h2>裁切规划</h2>
        <div className="row">
          <div className="field">
            <label>选择订单</label>
            <select
              value={activeOrderId ?? ''}
              onChange={(e) => setInternalOrderId(Number(e.target.value))}
              style={{ minWidth: 280 }}
              disabled={orderId != null}
            >
              <option value="" disabled>
                请选择…
              </option>
              {orders?.map((o) => (
                <option key={o.id} value={o.id}>
                  #{o.id} {o.title}（{o.totalQty} 片）
                  {o.status === 'confirmed' ? ' · 已确认' : ''}
                </option>
              ))}
            </select>
          </div>
          {activeOrder?.status === 'confirmed' && (
            <span className="badge ok">该订单已确认完成</span>
          )}
          <button
            className="btn"
            onClick={runPreview}
            disabled={busy || activeOrderId == null || activeOrder?.status === 'confirmed'}
          >
            {busy ? '计算中…' : '按当前库存试排'}
          </button>
          {activeOrderId == null && (
            <button className="btn secondary" onClick={onPickOrder}>
              先去创建/选择订单
            </button>
          )}
        </div>
        <p className="muted-text" style={{ fontSize: 12, marginBottom: 0 }}>
          试排与保存都不会占用库存；只有「确认」才会原子扣减原料并把余料入库。
        </p>
      </div>

      {msg && (
        <div className={`msg ${msg.kind}`}>
          {msg.text}
          {msg.reasons && msg.reasons.length > 0 && (
            <ul>
              {msg.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {plan && (
        <>
          <div className="panel">
            <div className="plan-actions">
              <h2 style={{ margin: 0 }}>
                试排结果
                {plan.complete ? (
                  <span className="badge ok" style={{ marginLeft: 10 }}>
                    完整方案：全部排入
                  </span>
                ) : (
                  <span className="badge err" style={{ marginLeft: 10 }}>
                    非完整方案：{plan.totals.piecesUnplaced} 片未排入
                  </span>
                )}
              </h2>
              <label className="field checkbox-field" style={{ marginLeft: 'auto' }}>
                <input
                  type="checkbox"
                  checked={showCuts}
                  onChange={(e) => setShowCuts(e.target.checked)}
                />
                显示切线
              </label>
              <button className="btn secondary" onClick={save} disabled={busy || confirmed}>
                保存此方案（草稿）
              </button>
              <button
                className="btn"
                onClick={handleConfirm}
                disabled={busy || !savedPlan || confirmed || !plan.complete}
                title={!plan.complete ? '存在未排入纸片，不是完整方案，不能确认' : undefined}
              >
                {confirmed ? '已确认' : '确认方案并扣减库存'}
              </button>
            </div>
            {savedPlan && !confirmed && (
              <p className="muted-text" style={{ fontSize: 12, margin: '8px 0 0' }}>
                已保存草稿 #{savedPlan.id}。确认时会再次校验库存；若期间库存变化导致方案失效，将拒绝确认并要求重排。
              </p>
            )}

            <div className="stat-grid">
              <div className="stat">
                <div className="v">{plan.totals.sheetsUsed}</div>
                <div className="l">消耗材料（张）</div>
              </div>
              <div className="stat">
                <div className="v">
                  {plan.totals.piecesPlaced}
                  <span className="muted-text"> / {plan.totals.piecesPlaced + plan.totals.piecesUnplaced}</span>
                </div>
                <div className="l">已排入成品（片）</div>
              </div>
              <div className="stat">
                <div className="v">{fmtArea(plan.totals.areaProduct)}</div>
                <div className="l">成品面积</div>
              </div>
              <div className="stat">
                <div className="v">{plan.newRemnants.reduce((s, r) => s + r.qty, 0)}</div>
                <div className="l">可复用余料（张）</div>
              </div>
              <div className="stat">
                <div className="v">{fmtArea(plan.totals.areaRemnant)}</div>
                <div className="l">余料面积</div>
              </div>
              <div className="stat">
                <div className="v">{fmtArea(plan.totals.areaWaste)}</div>
                <div className="l">废料（含白边/刀缝）</div>
              </div>
            </div>

            <h3>本方案消耗</h3>
            <table>
              <thead>
                <tr>
                  <th>库存</th>
                  <th>类型</th>
                  <th>尺寸</th>
                  <th>纹向</th>
                  <th>数量</th>
                </tr>
              </thead>
              <tbody>
                {plan.consumed.map((c) => (
                  <tr key={c.stockItemId}>
                    <td>{c.name}</td>
                    <td>
                      <span className={`badge ${c.kind}`}>
                        {c.kind === 'sheet' ? '原张' : '余料'}
                      </span>
                    </td>
                    <td>
                      {c.width} × {c.height}
                    </td>
                    <td>{c.grain === 'none' ? '无' : c.grain}</td>
                    <td>−{c.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <h3>确认后入库的可复用余料</h3>
            {plan.newRemnants.length === 0 ? (
              <p className="muted-text" style={{ fontSize: 12 }}>
                无达标的可复用余料（空区均小于 {plan.settings.remnantMinWidth}×
                {plan.settings.remnantMinHeight} mm，或被完全利用）。
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>尺寸 (mm)</th>
                    <th>纹向</th>
                    <th>数量</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.newRemnants.map((r, i) => (
                    <tr key={i}>
                      <td>
                        {r.width} × {r.height}
                      </td>
                      <td>{r.grain === 'none' ? '无' : r.grain}</td>
                      <td>+{r.qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {!plan.complete && (
            <div className="panel" style={{ borderColor: '#e6b4ac' }}>
              <h2 style={{ color: 'var(--err)' }}>未排入纸片（{plan.unplaced.reduce((s, u) => s + u.qty, 0)} 片）</h2>
              <p className="muted-text" style={{ fontSize: 12 }}>
                存在未排入纸片时，本方案不是完整方案，不能视为整单可完成；可补充库存后重新试排。
              </p>
              <table>
                <thead>
                  <tr>
                    <th>纸片</th>
                    <th>尺寸</th>
                    <th>纹向要求</th>
                    <th>允许旋转</th>
                    <th>未排数量</th>
                    <th>原因</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.unplaced.map((u) => (
                    <tr key={u.pieceId}>
                      <td>{u.name}</td>
                      <td>
                        {u.width} × {u.height}
                      </td>
                      <td>{u.grainRequired === 'none' ? '无' : u.grainRequired}</td>
                      <td>{u.allowRotation ? '是' : '否'}</td>
                      <td>{u.qty}</td>
                      <td>
                        <span className="badge err">
                          {u.reason === 'STOCK_TOO_SMALL'
                            ? '现有库存中没有尺寸/纹向可容纳它的材料'
                            : '现有材料数量不足'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="panel">
            <h2>逐张示意与切割顺序</h2>
            <div className="legend">
              <span>
                <i style={{ background: '#7db9d4' }} /> 成品（编号=需求片序）
              </span>
              <span>
                <i style={{ background: '#bfe0c6' }} /> 可复用余料
              </span>
              <span>
                <i style={{ background: '#d9b3a8' }} /> 废料
              </span>
              <span>
                <i style={{ background: '#eceff1' }} /> 原料白边
              </span>
              <span>
                <i style={{ background: '#c0392b' }} /> 切线（红虚线，每刀贯穿当前子矩形）
              </span>
            </div>

            <div className="row" style={{ margin: '8px 0' }}>
              {plan.sheets.map((s) => (
                <button
                  key={s.sheetNo}
                  className={`btn ${s.sheetNo === activeSheet ? '' : 'secondary'}`}
                  style={{ padding: '5px 12px' }}
                  onClick={() => {
                    setActiveSheet(s.sheetNo);
                    setHighlightSeq(null);
                  }}
                >
                  第 {s.sheetNo} 张 · {s.stockName}
                </button>
              ))}
            </div>

            {displayedSheet && (
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: '0 0 auto' }}>
                  <SheetDiagram
                    sheet={displayedSheet}
                    showCuts={showCuts}
                    highlightSeq={highlightSeq}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 300 }}>
                  <h3 style={{ marginTop: 0 }}>
                    第 {displayedSheet.sheetNo} 张：{displayedSheet.stockName}（
                    {displayedSheet.width}×{displayedSheet.height}）
                  </h3>
                  <table>
                    <tbody>
                      <tr>
                        <td>成品</td>
                        <td>
                          {displayedSheet.placements.length} 片 ·{' '}
                          {fmtArea(displayedSheet.areaProduct)}
                        </td>
                      </tr>
                      <tr>
                        <td>可复用余料</td>
                        <td>
                          {displayedSheet.remnants.length} 块 ·{' '}
                          {fmtArea(displayedSheet.areaRemnant)}
                        </td>
                      </tr>
                      <tr>
                        <td>废料（含白边刀缝）</td>
                        <td>{fmtArea(displayedSheet.areaWaste)}</td>
                      </tr>
                      <tr>
                        <td>利用率</td>
                        <td>{(displayedSheet.utilization * 100).toFixed(1)}%</td>
                      </tr>
                    </tbody>
                  </table>

                  <h3>切割顺序（共 {displayedSheet.cuts.length} 刀）</h3>
                  <div className="cut-list">
                    {displayedSheet.cuts.map((c) => (
                      <div
                        key={c.seq}
                        className="clickable"
                        style={{
                          background:
                            highlightSeq === c.seq ? '#fdeceb' : undefined,
                        }}
                        onMouseEnter={() => setHighlightSeq(c.seq)}
                        onMouseLeave={() => setHighlightSeq(null)}
                      >
                        <span className="seq">{c.seq}.</span>
                        {c.axis === 'v' ? '竖切' : '横切'} · {c.description}
                      </div>
                    ))}
                    {displayedSheet.cuts.length === 0 && (
                      <div style={{ padding: 8 }} className="muted-text">
                        无需切割（纸片恰好铺满）。
                      </div>
                    )}
                  </div>

                  <h3>成品明细</h3>
                  <div className="cut-list">
                    {displayedSheet.placements.map((p, i) => (
                      <div key={i}>
                        <span className="seq">#{p.pieceIndex}</span>
                        {p.pieceName} @ ({p.x},{p.y}) {p.w}×{p.h}
                        {p.orientation === 'rotated' ? '（旋转90°）' : ''}
                        {p.grain !== 'none' ? ` 纹向${p.grain}` : ''}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
