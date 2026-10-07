import { useEffect, useState } from 'react';
import { api } from '../api';
import { PlanDetail, PlanSummary } from '../types';
import { BoardDiagram } from './BoardDiagram';

function genIdemKey() {
  return `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function PlansTab() {
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [detail, setDetail] = useState<PlanDetail | null>(null);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [idemKeys, setIdemKeys] = useState<Record<number, string>>({});

  const refresh = async () => {
    const data = await api.listPlans();
    setPlans(data.plans);
    if (detail) {
      try {
        setDetail(await api.getPlan(detail.id));
      } catch {
        setDetail(null);
      }
    }
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (id: number) => {
    setError('');
    setMsg('');
    try {
      setDetail(await api.getPlan(id));
    } catch (e: any) {
      setError(e.message);
    }
  };

  const doConfirm = async (p: PlanSummary) => {
    if (!p.complete) {
      setError('该方案不是完整方案（有未排入纸片），不能确认');
      return;
    }
    setBusy(true);
    setError('');
    setMsg('');
    // 同一方案的重复/并发点击复用同一幂等键，服务端据此拒绝重复扣减
    let key = idemKeys[p.id];
    if (!key) {
      key = genIdemKey();
      setIdemKeys((m) => ({ ...m, [p.id]: key! }));
    }
    try {
      const r = await api.confirmPlan(p.id, key);
      if (r.idempotent) setMsg('该方案此前已确认，本次为幂等返回，库存未重复变动。');
      else setMsg('已确认：原料已原子扣减，余料已入库，库存版本已推进。');
      await refresh();
    } catch (e: any) {
      setError(e.message);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const del = async (id: number) => {
    if (!window.confirm('删除此草稿方案？（已确认方案不可删除）')) return;
    try {
      await api.deletePlan(id);
      if (detail?.id === id) setDetail(null);
      await refresh();
    } catch (e: any) {
      setError(e.message);
    }
  };

  return (
    <div>
      {error && <div className="banner err">{error}</div>}
      {msg && <div className="banner ok">{msg}</div>}

      <div className="panel">
        <h2>已存方案</h2>
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>名称</th>
              <th>状态</th>
              <th>完整性</th>
              <th>库存版本</th>
              <th>原张/余料</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td><a href="#" onClick={(e) => { e.preventDefault(); open(p.id); }}>{p.name}</a></td>
                <td>
                  {p.status === 'confirmed' ? (
                    <span className="tag confirmed">已确认</span>
                  ) : (
                    <span className="tag draft">草稿</span>
                  )}
                </td>
                <td>
                  {p.complete ? <span className="tag confirmed">完整</span> : <span className="tag incomplete">有未排入</span>}
                </td>
                <td>
                  v{p.stockVersion}
                  {p.status === 'draft' && p.stale && (
                    <span className="tag stale" style={{ marginLeft: 6 }}>已失效（当前 v{p.currentStockVersion}）</span>
                  )}
                </td>
                <td>{p.totals.sheetsUsed} / {p.totals.remnantsUsed}</td>
                <td className="muted">{p.createdAt}{p.confirmedAt ? ` · 确认于 ${p.confirmedAt}` : ''}</td>
                <td>
                  {p.status === 'draft' && (
                    <>
                      <button className="btn" disabled={busy || p.stale || !p.complete} onClick={() => doConfirm(p)} title={p.stale ? '库存已变动，需重排' : !p.complete ? '非完整方案' : ''}>
                        确认扣库存
                      </button>{' '}
                      <button className="btn danger" onClick={() => del(p.id)}>删除</button>
                    </>
                  )}
                  {p.status === 'confirmed' && <span className="muted">库存已锁定</span>}
                </td>
              </tr>
            ))}
            {plans.length === 0 && <tr><td colSpan={8} className="muted">暂无方案，去“裁切试排”页创建吧</td></tr>}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
          库存一旦变动（任何确认或手工增删），版本号递增；仍为草稿的旧方案会标记“已失效”，确认被拒绝，需重新试排。
          重复点击确认或并发提交不会重复消耗库存（事务 + 幂等键）。
        </p>
      </div>

      {detail && (
        <div className="panel">
          <h2>
            方案 #{detail.id}：{detail.name}
            {detail.status === 'draft' && detail.stale && <span className="tag stale" style={{ marginLeft: 8 }}>库存已变动，方案失效</span>}
          </h2>
          <div className="stats">
            <div className="stat"><b>{detail.result.totals.piecesPlaced}/{detail.result.totals.piecesRequired}</b><span>成品片数</span></div>
            <div className="stat"><b>{detail.result.totals.sheetsUsed}</b><span>原张</span></div>
            <div className="stat"><b>{detail.result.totals.remnantsUsed}</b><span>余料</span></div>
            <div className="stat"><b>{detail.result.totals.wasteArea.toLocaleString()}</b><span>废料 mm²</span></div>
            <div className="stat"><b>{detail.result.totals.remnantArea.toLocaleString()}</b><span>回收余料 mm²</span></div>
          </div>
          {!detail.result.complete && (
            <div className="banner warn">
              非完整方案，未排入：
              {detail.result.unplaced.map((u) => ` ${u.name}×${u.quantity}`).join('，')}
            </div>
          )}
          <div className="boards-wrap">
            {detail.result.boards.map((b) => <BoardDiagram key={b.boardIndex} board={b} />)}
          </div>
        </div>
      )}
    </div>
  );
}
