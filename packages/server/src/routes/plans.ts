import { Router } from 'express';
import {
  computeOrderHash,
  computeSettingsHash,
} from '@pcp/shared';
import {
  confirmPlan,
  getSettings,
  orderRepo,
  planRepo,
} from '../db.js';
import { computePlan } from '../services.js';

export const plansRouter = Router();

/** 试排：按当前库存实时计算，不保存、不占库存 */
plansRouter.post('/orders/:orderId/preview', (req, res) => {
  const orderId = Number(req.params.orderId);
  const order = orderRepo.get(orderId);
  if (!order) {
    res.status(404).json({ error: '订单不存在' });
    return;
  }
  if (order.status === 'confirmed') {
    res.status(409).json({ error: '订单已确认，不能再试排' });
    return;
  }
  const { payload } = computePlan(orderId);
  res.json({ orderId, plan: payload });
});

/** 保存试排方案（草稿，仍不占库存） */
plansRouter.post('/orders/:orderId/plans', (req, res) => {
  const orderId = Number(req.params.orderId);
  const order = orderRepo.get(orderId);
  if (!order) {
    res.status(404).json({ error: '订单不存在' });
    return;
  }
  if (order.status === 'confirmed') {
    res.status(409).json({ error: '订单已确认' });
    return;
  }
  // 保存前始终以当前库存重新计算，避免前端提交过期数据
  const { payload } = computePlan(orderId);
  const plan = planRepo.create({ orderId, payload });
  res.status(201).json(plan);
});

plansRouter.get('/orders/:orderId/plans', (req, res) => {
  const orderId = Number(req.params.orderId);
  if (!orderRepo.get(orderId)) {
    res.status(404).json({ error: '订单不存在' });
    return;
  }
  res.json(planRepo.list(orderId));
});

plansRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const plan = planRepo.get(id);
  if (!plan) {
    res.status(404).json({ error: '方案不存在' });
    return;
  }
  res.json(plan);
});

plansRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const plan = planRepo.get(id);
  if (!plan) {
    res.status(404).json({ error: '方案不存在' });
    return;
  }
  if (plan.status === 'confirmed') {
    res.status(409).json({ error: '已确认的方案不能删除' });
    return;
  }
  planRepo.remove(id);
  res.status(204).end();
});

/**
 * 确认方案：原子扣减原料 + 入库余料。
 * 库存/订单/工艺变化导致方案失效时返回 409 PLAN_STALE 并附原因；
 * 重复或并发确认由方案状态锁拦截（409 ALREADY_CONFIRMED），绝不重复消耗。
 */
plansRouter.post('/:id/confirm', (req, res) => {
  const id = Number(req.params.id);
  const plan = planRepo.get(id);
  if (!plan) {
    res.status(404).json({ error: '方案不存在' });
    return;
  }
  const order = orderRepo.get(plan.order_id);
  if (!order) {
    res.status(404).json({ error: '订单不存在' });
    return;
  }

  const expectedOrderHash = computeOrderHash(orderRepo.pieces(order.id));
  const expectedSettingsHash = computeSettingsHash(getSettings());

  try {
    const result = confirmPlan(plan.id, {
      expectedOrderHash,
      expectedSettingsHash,
    });
    res.json({
      ok: true,
      plan: result.plan,
      stockChanges: result.stockChanges,
      remnantsAdded: result.remnantsAdded,
    });
  } catch (err) {
    const e = err as { status?: number; code?: string; reasons?: string[]; message: string };
    res.status(e.status ?? 500).json({
      error: e.message,
      code: e.code,
      reasons: e.reasons,
    });
  }
});
