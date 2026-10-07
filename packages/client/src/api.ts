import type {
  ApiError,
  Order,
  OrderInput,
  Plan,
  PlanPayload,
  Settings,
  StockInput,
  StockItem,
} from '@pcp/shared';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = body as ApiError;
    throw new PlanApiError(
      err?.error ?? `请求失败 (${res.status})`,
      err?.code,
      err?.reasons,
    );
  }
  return body as T;
}

export class PlanApiError extends Error {
  code?: string;
  reasons?: string[];
  constructor(message: string, code?: string, reasons?: string[]) {
    super(message);
    this.code = code;
    this.reasons = reasons;
  }
}

type OrderDetail = Order & { pieces: import('@pcp/shared').OrderPiece[] };

export const api = {
  getSettings: () => request<Settings>('/api/settings'),
  putSettings: (s: Settings) =>
    request<Settings>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(s),
    }),

  listStock: () => request<StockItem[]>('/api/stock'),
  createStock: (s: StockInput) =>
    request<StockItem>('/api/stock', { method: 'POST', body: JSON.stringify(s) }),
  updateStock: (id: number, s: StockInput) =>
    request<StockItem>(`/api/stock/${id}`, {
      method: 'PUT',
      body: JSON.stringify(s),
    }),
  deleteStock: (id: number) =>
    request<void>(`/api/stock/${id}`, { method: 'DELETE' }),

  listOrders: () =>
    request<Array<Order & { pieceCount: number; totalQty: number }>>(
      '/api/orders',
    ),
  getOrder: (id: number) => request<OrderDetail>(`/api/orders/${id}`),
  createOrder: (o: OrderInput) =>
    request<OrderDetail>('/api/orders', {
      method: 'POST',
      body: JSON.stringify(o),
    }),
  deleteOrder: (id: number) =>
    request<void>(`/api/orders/${id}`, { method: 'DELETE' }),

  previewPlan: (orderId: number) =>
    request<{ orderId: number; plan: PlanPayload }>(
      `/api/plans/orders/${orderId}/preview`,
      { method: 'POST' },
    ),
  savePlan: (orderId: number) =>
    request<Plan>(`/api/plans/orders/${orderId}/plans`, { method: 'POST' }),
  listPlans: (orderId: number) =>
    request<Plan[]>(`/api/plans/orders/${orderId}/plans`),
  getPlan: (id: number) => request<Plan>(`/api/plans/${id}`),
  deletePlan: (id: number) =>
    request<void>(`/api/plans/${id}`, { method: 'DELETE' }),
  confirmPlan: (id: number) =>
    request<{
      ok: boolean;
      plan: Plan;
      stockChanges: Array<{
        id: number;
        name: string;
        delta: number;
        newQuantity: number;
      }>;
      remnantsAdded: number;
    }>(`/api/plans/${id}/confirm`, { method: 'POST' }),
};
