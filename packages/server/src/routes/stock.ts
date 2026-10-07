import { Router } from 'express';
import { stockRepo } from '../db.js';
import { validateStock } from '../validation.js';

export const stockRouter = Router();

stockRouter.get('/', (_req, res) => {
  res.json(stockRepo.list());
});

stockRouter.post('/', (req, res) => {
  const input = validateStock(req.body);
  res.status(201).json(stockRepo.create(input));
});

stockRouter.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'id 不合法' });
    return;
  }
  const input = validateStock(req.body);
  const updated = stockRepo.update(id, input);
  if (!updated) {
    res.status(404).json({ error: '库存条目不存在' });
    return;
  }
  res.json(updated);
});

stockRouter.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!stockRepo.remove(id)) {
    res.status(404).json({ error: '库存条目不存在' });
    return;
  }
  res.status(204).end();
});
