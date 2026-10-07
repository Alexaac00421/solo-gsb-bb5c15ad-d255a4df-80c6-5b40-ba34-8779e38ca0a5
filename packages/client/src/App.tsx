import { useState } from 'react';
import { StockView } from './components/StockView.js';
import { OrdersView } from './components/OrdersView.js';
import { PlannerView } from './components/PlannerView.js';
import { SettingsPanel } from './components/SettingsPanel.js';

type Tab = 'planner' | 'stock' | 'orders' | 'settings';

export function App() {
  const [tab, setTab] = useState<Tab>('planner');
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);

  const goPlan = (orderId: number) => {
    setSelectedOrderId(orderId);
    setTab('planner');
  };

  return (
    <>
      <header className="topbar">
        <h1>📄 纸品裁切规划台</h1>
        <nav className="tabs">
          <button
            className={tab === 'planner' ? 'active' : ''}
            onClick={() => setTab('planner')}
          >
            裁切规划
          </button>
          <button
            className={tab === 'stock' ? 'active' : ''}
            onClick={() => setTab('stock')}
          >
            原料与余料库存
          </button>
          <button
            className={tab === 'orders' ? 'active' : ''}
            onClick={() => setTab('orders')}
          >
            订单
          </button>
          <button
            className={tab === 'settings' ? 'active' : ''}
            onClick={() => setTab('settings')}
          >
            工艺参数
          </button>
        </nav>
      </header>
      <main>
        {tab === 'stock' && <StockView />}
        {tab === 'orders' && <OrdersView onPlan={goPlan} />}
        {tab === 'planner' && (
          <PlannerView
            orderId={selectedOrderId}
            onPickOrder={() => setTab('orders')}
          />
        )}
        {tab === 'settings' && <SettingsPanel />}
      </main>
    </>
  );
}
