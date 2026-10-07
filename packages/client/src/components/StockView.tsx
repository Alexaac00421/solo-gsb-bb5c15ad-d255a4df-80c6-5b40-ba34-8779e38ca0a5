import { useState } from 'react';
import type { Grain, StockInput, StockItem } from '@pcp/shared';
import { api } from '../api.js';
import { useAsync } from '../useAsync.js';

const empty: StockInput = {
  kind: 'sheet',
  name: '',
  width: 0,
  height: 0,
  grain: 'none',
  quantity: 1,
  note: '',
};

export function StockView() {
  const { data, error, loading, reload } = useAsync(() => api.listStock(), []);
  const [form, setForm] = useState<StockInput>(empty);
  const [editId, setEditId] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(
    null,
  );

  const submit = async () => {
    setMsg(null);
    try {
      if (editId != null) {
        await api.updateStock(editId, form);
        setMsg({ kind: 'success', text: '已更新库存条目' });
      } else {
        await api.createStock(form);
        setMsg({ kind: 'success', text: '已新增库存条目' });
      }
      setForm(empty);
      setEditId(null);
      reload();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };

  const startEdit = (s: StockItem) => {
    setEditId(s.id);
    setForm({
      kind: s.kind,
      name: s.name,
      width: s.width,
      height: s.height,
      grain: s.grain,
      quantity: s.quantity,
      note: s.note ?? '',
    });
    setMsg(null);
  };

  const remove = async (s: StockItem) => {
    if (!confirm(`确认删除「${s.name}」？已保存方案再次确认时会因此失效。`)) return;
    try {
      await api.deleteStock(s.id);
      reload();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };

  const f = (patch: Partial<StockInput>) => setForm((p) => ({ ...p, ...patch }));

  return (
    <>
      <div className="panel">
        <h2>{editId != null ? `编辑库存 #${editId}` : '录入原张 / 库存余料'}</h2>
        <div className="row">
          <div className="field">
            <label>类型</label>
            <select
              value={form.kind}
              onChange={(e) => f({ kind: e.target.value as StockInput['kind'] })}
            >
              <option value="sheet">原张</option>
              <option value="remnant">库存余料</option>
            </select>
          </div>
          <div className="field">
            <label>名称</label>
            <input
              value={form.name}
              onChange={(e) => f({ name: e.target.value })}
              placeholder="如 大度原纸 889×1194"
              style={{ width: 200 }}
            />
          </div>
          <div className="field">
            <label>宽 mm（x 向）</label>
            <input
              type="number"
              value={form.width || ''}
              onChange={(e) => f({ width: Number(e.target.value) })}
              style={{ width: 100 }}
            />
          </div>
          <div className="field">
            <label>高 mm（y 向）</label>
            <input
              type="number"
              value={form.height || ''}
              onChange={(e) => f({ height: Number(e.target.value) })}
              style={{ width: 100 }}
            />
          </div>
          <div className="field">
            <label>纹向（丝缕）</label>
            <select
              value={form.grain}
              onChange={(e) => f({ grain: e.target.value as Grain })}
            >
              <option value="none">无纹向</option>
              <option value="x">沿宽向 x</option>
              <option value="y">沿高向 y</option>
            </select>
          </div>
          <div className="field">
            <label>数量（张）</label>
            <input
              type="number"
              min={1}
              value={form.quantity}
              onChange={(e) => f({ quantity: Number(e.target.value) })}
              style={{ width: 90 }}
            />
          </div>
          <div className="field">
            <label>备注</label>
            <input
              value={form.note ?? ''}
              onChange={(e) => f({ note: e.target.value })}
              style={{ width: 160 }}
            />
          </div>
          <button className="btn" onClick={submit}>
            {editId != null ? '保存修改' : '加入库存'}
          </button>
          {editId != null && (
            <button
              className="btn secondary"
              onClick={() => {
                setEditId(null);
                setForm(empty);
              }}
            >
              取消
            </button>
          )}
        </div>
        {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
        <p className="muted-text" style={{ fontSize: 12, marginBottom: 0 }}>
          纹向指纸张丝缕方向：原张/余料的纹向会与成品纹向要求自动比对；余料排样时不计原料白边。
        </p>
      </div>

      <div className="panel">
        <h2>现有库存</h2>
        {loading && <p>加载中…</p>}
        {error && <div className="msg error">{error}</div>}
        {data && (
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>类型</th>
                <th>名称</th>
                <th>宽×高 (mm)</th>
                <th>纹向</th>
                <th>数量</th>
                <th>备注</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((s) => (
                <tr key={s.id}>
                  <td>{s.id}</td>
                  <td>
                    <span className={`badge ${s.kind}`}>
                      {s.kind === 'sheet' ? '原张' : '余料'}
                    </span>
                  </td>
                  <td>{s.name}</td>
                  <td>
                    {s.width} × {s.height}
                  </td>
                  <td>{s.grain === 'none' ? '无' : s.grain}</td>
                  <td>{s.quantity}</td>
                  <td className="muted-text">{s.note}</td>
                  <td>
                    <button
                      className="btn ghost"
                      style={{ padding: '3px 10px', marginRight: 6 }}
                      onClick={() => startEdit(s)}
                    >
                      编辑
                    </button>
                    <button
                      className="btn danger"
                      style={{ padding: '3px 10px' }}
                      onClick={() => remove(s)}
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted-text">
                    暂无库存，请先录入。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
