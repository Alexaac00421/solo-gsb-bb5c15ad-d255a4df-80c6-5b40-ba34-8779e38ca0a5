import { useState } from 'react';
import { StockTab } from './components/StockTab';
import { PlannerTab } from './components/PlannerTab';
import { PlansTab } from './components/PlansTab';
import './styles.css';

type Tab = 'planner' | 'stock' | 'plans';

export function App() {
  const [tab, setTab] = useState<Tab>('planner');

  return (
    <>
      <header className="topbar">
        <h1>📄 纸品裁切规划台</h1>
        <nav className="tabs">
          <button className={tab === 'planner' ? 'active' : ''} onClick={() => setTab('planner')}>裁切试排</button>
          <button className={tab === 'stock' ? 'active' : ''} onClick={() => setTab('stock')}>原张与余料</button>
          <button className={tab === 'plans' ? 'active' : ''} onClick={() => setTab('plans')}>方案列表</button>
        </nav>
      </header>
      <main>
        {tab === 'planner' && <PlannerTab />}
        {tab === 'stock' && <StockTab />}
        {tab === 'plans' && <PlansTab />}
      </main>
    </>
  );
}
