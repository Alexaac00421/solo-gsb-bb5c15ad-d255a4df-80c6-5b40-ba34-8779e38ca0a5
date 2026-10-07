import { PlanDetail, PlanPayload, PlanRequest, PlanResult, PlanSummary, StockItem } from './types';

async function req<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
  return data as T;
}

export const api = {
  health: () => req<{ ok: boolean; stockVersion: number }>('/api/health'),
  listStock: () => req<{ items: StockItem[]; stockVersion: number }>('/api/stock'),
  createStock: (body: Partial<StockItem>) =>
    req<{ id: number }>('/api/stock', { method: 'POST', body: JSON.stringify(body) }),
  updateStock: (id: number, body: Partial<StockItem>) =>
    req<{ ok: boolean }>(`/api/stock/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteStock: (id: number) => req<{ ok: boolean }>(`/api/stock/${id}`, { method: 'DELETE' }),
  preview: (body: PlanRequest) => req<PlanResult>('/api/plans/preview', { method: 'POST', body: JSON.stringify(body) }),
  savePlan: (body: PlanPayload) =>
    req<{ id: number; result: PlanResult }>('/api/plans', { method: 'POST', body: JSON.stringify(body) }),
  listPlans: () => req<{ plans: PlanSummary[] }>('/api/plans'),
  getPlan: (id: number) => req<PlanDetail>(`/api/plans/${id}`),
  deletePlan: (id: number) => req<{ ok: boolean }>(`/api/plans/${id}`, { method: 'DELETE' }),
  confirmPlan: (id: number, idempotencyKey?: string) =>
    req<{ confirmed: boolean; idempotent?: boolean; result: PlanResult }>(`/api/plans/${id}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ idempotencyKey }),
    }),
};
