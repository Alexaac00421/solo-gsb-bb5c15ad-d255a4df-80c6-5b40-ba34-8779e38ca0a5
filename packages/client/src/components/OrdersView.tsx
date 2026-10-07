import { useState } from 'react';
import type { Grain, OrderInput } from '@pcp/shared';
import { api } from '../api.js';
import { useAsync } from '../useAsync.js';

interface PieceDraft {
  name: string;
  width: number | '';
  height: number | '';
  grainRequired: Grain;
  allowRotation: boolean;
  quantity: number | '';
}

const newPiece = (): PieceDraft => ({
  name: '',
  width: '',
  height: '',
  grainRequired: 'none',
  allowRotation: true,
  quantity: 1,
});

export function OrdersView({ onPlan }: { onPlan: (orderId: number) => void }) {
  const { data, error, loading, reload } = useAsync(() => api.listOrders(), []);
  const [title, setTitle] = useState('');
  const [pieces, setPieces] = useState<PieceDraft[]>([newPiece()]);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(
    null,
  );

  const setPiece = (i: number, patch: Partial<PieceDraft>) =>
    setPieces((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  const submit = async () => {
    setMsg(null);
    const input: OrderInput = {
      title,
      pieces: pieces.map((p) => ({
        name: p.name,
        width: Number(p.width),
        height: Number(p.height),
        grainRequired: p.grainRequired,
        allowRotation: p.allowRotation,
        quantity: Number(p.quantity),
      })),
    };
    try {
      const order = await api.createOrder(input);
      setMsg({ kind: 'success', text: `订单「${order.title}」已创建` });
      setTitle('');
      setPieces([newPiece()]);
      reload();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };

  const remove = async (id: number, t: string) => {
    if (!confirm(`删除订单「${t}」及其全部方案？`)) return;
    try {
      await api.deleteOrder(id);
      reload();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <>
      <div className="panel">
        <h2>新建订单</h2>
        <div className="field" style={{ marginBottom: 12, maxWidth: 360 }}>
          <label>订单标题</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="如 10月 婚庆请柬"
          />
        </div>

        <h3>纸片需求</h3>
        <div className="piece-edit-row" style={{ fontSize: 12, color: 'var(--muted)' }}>
          <span>名称</span>
          <span>宽 mm</span>
          <span>高 mm</span>
          <span>纹向要求</span>
          <span>允许旋转</span>
          <span>数量</span>
          <span></span>
        </div>
        {pieces.map((p, i) => (
          <div className="piece-edit-row" key={i}>
            <input
              value={p.name}
              onChange={(e) => setPiece(i, { name: e.target.value })}
              placeholder={`纸片 ${i + 1}`}
            />
            <input
              type="number"
              value={p.width}
              onChange={(e) =>
                setPiece(i, { width: e.target.value === '' ? '' : Number(e.target.value) })
              }
            />
            <input
              type="number"
              value={p.height}
              onChange={(e) =>
                setPiece(i, { height: e.target.value === '' ? '' : Number(e.target.value) })
              }
            />
            <select
              value={p.grainRequired}
              onChange={(e) => setPiece(i, { grainRequired: e.target.value as Grain })}
            >
              <option value="none">无要求</option>
              <option value="x">沿宽向 x</option>
              <option value="y">沿高向 y</option>
            </select>
            <label className="field checkbox-field">
              <input
                type="checkbox"
                checked={p.allowRotation}
                onChange={(e) => setPiece(i, { allowRotation: e.target.checked })}
              />
              {p.allowRotation ? '可转 90°' : '不可旋转'}
            </label>
            <input
              type="number"
              min={1}
              value={p.quantity}
              onChange={(e) =>
                setPiece(i, { quantity: e.target.value === '' ? '' : Number(e.target.value) })
              }
            />
            <button
              className="btn danger"
              style={{ padding: '6px 10px' }}
              onClick={() => setPieces((ps) => ps.filter((_, idx) => idx !== i))}
              disabled={pieces.length === 1}
              title="删除该行"
            >
              ✕
            </button>
          </div>
        ))}
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn secondary" onClick={() => setPieces((ps) => [...ps, newPiece()])}>
            + 添加一种纸片
          </button>
          <button className="btn" onClick={submit}>
            创建订单
          </button>
        </div>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
      </div>

      <div className="panel">
        <h2>订单列表</h2>
        {loading && <p>加载中…</p>}
        {error && <div className="msg error">{error}</div>}
        {data && (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>标题</th>
                <th>纸片种类</th>
                <th>总数量</th>
                <th>状态</th>
                <th>创建时间</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id}>
                  <td>{o.id}</td>
                  <td className="clickable" onClick={() => onPlan(o.id)}>
                    {o.title}
                  </td>
                  <td>{o.pieceCount}</td>
                  <td>{o.totalQty}</td>
                  <td>
                    <span className={`badge ${o.status === 'confirmed' ? 'ok' : 'warn'}`}>
                      {o.status === 'confirmed' ? '已确认' : '待排产'}
                    </span>
                  </td>
                  <td className="muted-text">{o.created_at}</td>
                  <td>
                    <button
                      className="btn ghost"
                      style={{ padding: '3px 10px', marginRight: 6 }}
                      onClick={() => onPlan(o.id)}
                    >
                      去排样
                    </button>
                    {o.status !== 'confirmed' && (
                      <button
                        className="btn danger"
                        style={{ padding: '3px 10px' }}
                        onClick={() => {
                          void remove(o.id, o.title);
                        }}
                      >
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
