import { useEffect, useState } from 'react';
import { api } from '../api';
import { Grain, StockItem } from '../types';

const grainLabel: Record<Grain, string> = { vertical: '竖纹', horizontal: '横纹', none: '无要求' };

const empty: { name: string; width: string; height: string; quantity: string; grain: Grain; kind: 'sheet' | 'remnant' } = {
  name: '',
  width: '',
  height: '',
  quantity: '1',
  grain: 'none',
  kind: 'sheet',
};

export function StockTab() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [version, setVersion] = useState<number>(0);
  const [form, setForm] = useState({ ...empty });
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const refresh = async () => {
    const data = await api.listStock();
    setItems(data.items);
    setVersion(data.stockVersion);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, []);

  const add = async () => {
    setError('');
    setMsg('');
    try {
      await api.createStock({
        name: form.name,
        width: Number(form.width),
        height: Number(form.height),
        quantity: Number(form.quantity),
        grain: form.grain,
        kind: form.kind,
      });
      setForm({ ...empty });
      await refresh();
      setMsg('已添加（库存版本已递增）');
    } catch (e: any) {
      setError(e.message);
    }
  };

  const del = async (id: number) => {
    if (!confirm('确定删除该库存记录？删除会使已存未确认方案失效。')) return;
    try {
      await api.deleteStock(id);
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
        <h2>录入原张 / 库存余料</h2>
        <div className="row">
          <div className="field">
            <label>名称</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="如：白卡 787×1092" />
          </div>
          <div className="field">
            <label>宽 mm</label>
            <input className="num" type="number" min="0" value={form.width} onChange={(e) => setForm({ ...form, width: e.target.value })} />
          </div>
          <div className="field">
            <label>高 mm</label>
            <input className="num" type="number" min="0" value={form.height} onChange={(e) => setForm({ ...form, height: e.target.value })} />
          </div>
          <div className="field">
            <label>数量</label>
            <input className="num" type="number" min="0" step="1" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
          </div>
          <div className="field">
            <label>纹向</label>
            <select value={form.grain} onChange={(e) => setForm({ ...form, grain: e.target.value as Grain })}>
              <option value="vertical">竖纹</option>
              <option value="horizontal">横纹</option>
              <option value="none">无要求</option>
            </select>
          </div>
          <div className="field">
            <label>类型</label>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'sheet' | 'remnant' })}>
              <option value="sheet">原张</option>
              <option value="remnant">余料</option>
            </select>
          </div>
          <button className="btn" onClick={add}>添加</button>
        </div>
      </div>

      <div className="panel">
        <h2>
          当前库存 <span className="muted" style={{ fontWeight: 400 }}>（库存版本 v{version}）</span>
        </h2>
        <table>
          <thead>
            <tr>
              <th>名称</th>
              <th>宽(mm)</th>
              <th>高(mm)</th>
              <th>数量</th>
              <th>纹向</th>
              <th>类型</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.width}</td>
                <td>{s.height}</td>
                <td>{s.quantity}</td>
                <td>{grainLabel[s.grain]}</td>
                <td><span className={`tag ${s.kind}`}>{s.kind === 'sheet' ? '原张' : '余料'}</span></td>
                <td><button className="btn danger" onClick={() => del(s.id)}>删除</button></td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr><td colSpan={7} className="muted">暂无库存</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
