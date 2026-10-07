import { Router } from 'express';
import { getSettings, updateSettings } from '../db.js';
import { validateSettings } from '../validation.js';

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  res.json(getSettings());
});

settingsRouter.put('/', (req, res) => {
  const input = validateSettings(req.body);
  res.json(updateSettings(input));
});
