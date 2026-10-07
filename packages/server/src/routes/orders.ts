import { Router } from 'express';
import { orderRepo } from '../db.js';
import { validateOrder } from '../validation.js';

export const ordersRouter = Router();

ordersRouter.get('/', (_req, res) => {
  res.json(orderRepo.list());
});

ordersRouter.get('/:id', (req, res) => {
  const id = Number(req.params.id);
  const order = orderRepo.get(id);
  if (!order) {
    res.status(404).json({ error: '订单不存在' });
    return;
  }
  res.json({ ...order, pieces: orderRepo.pieces(id) });
});

ordersRouter.post('/', (req, res) => {
  const input = validateOrder(req.body);
  const order = orderRepo.create(input);
  res.status(201).json({ ...order, pieces: orderRepo.pieces(order.id) });
});

ordersRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!orderRepo.remove(id)) {
    res.status(404).json({ error: '订单不存在' });
    return;
  }
  res.status(204).end();
});
