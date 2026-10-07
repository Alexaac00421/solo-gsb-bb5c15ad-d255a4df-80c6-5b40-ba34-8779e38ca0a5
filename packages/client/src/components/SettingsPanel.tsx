import { useEffect, useState } from 'react';
import type { Settings } from '@pcp/shared';
import { api } from '../api.js';

export function SettingsPanel() {
  const [s, setS] = useState<Settings | null>(null);
  const [msg, setMsg] = useState<{ kind: 'error' | 'success'; text: string } | null>(
    null,
  );

  useEffect(() => {
    api.getSettings().then(setS).catch((e: Error) => setMsg({ kind: 'error', text: e.message }));
  }, []);

  if (!s) return <div className="panel">加载中…</div>;

  const f = (patch: Partial<Settings>) => setS((p) => ({ ...p!, ...patch }));

  const save = async () => {
    setMsg(null);
    try {
      await api.putSettings(s);
      setMsg({ kind: 'success', text: '工艺参数已保存。注意：参数变更后，之前保存的方案将在确认时被判定失效，需要重新排样。' });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <div className="panel" style={{ maxWidth: 640 }}>
      <h2>工艺参数</h2>
      <div className="row">
        <div className="field">
          <label>原料白边 margin (mm)</label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={s.margin}
            onChange={(e) => f({ margin: Number(e.target.value) })}
            style={{ width: 130 }}
          />
        </div>
        <div className="field">
          <label>刀缝 kerf (mm)</label>
          <input
            type="number"
            min={0}
            step={0.5}
            value={s.kerf}
            onChange={(e) => f({ kerf: Number(e.target.value) })}
            style={{ width: 130 }}
          />
        </div>
        <div className="field">
          <label>余料最小长 (mm)</label>
          <input
            type="number"
            min={1}
            step={1}
            value={s.remnantMinWidth}
            onChange={(e) => f({ remnantMinWidth: Number(e.target.value) })}
            style={{ width: 130 }}
          />
        </div>
        <div className="field">
          <label>余料最小宽 (mm)</label>
          <input
            type="number"
            min={1}
            step={1}
            value={s.remnantMinHeight}
            onChange={(e) => f({ remnantMinHeight: Number(e.target.value) })}
            style={{ width: 130 }}
          />
        </div>
        <button className="btn" onClick={save}>
          保存参数
        </button>
      </div>
      {msg && <div className={`msg ${msg.kind}`}>{msg.text}</div>}
      <ul className="muted-text" style={{ fontSize: 12, lineHeight: 1.8 }}>
        <li>白边：原张四周保留、不参与排样的边距（库存余料按无边距处理）。</li>
        <li>刀缝：切刀吃掉的宽度，排样会在相邻子矩形之间自动留出该间隙。</li>
        <li>
          余料阈值：切后空区长宽都达到该值才算「可复用余料」（确认后自动入库），否则计为废料。
        </li>
      </ul>
    </div>
  );
}
