import {
  computeOrderHash,
  computeSettingsHash,
  pack,
  type OrderPiece,
  type PlanPayload,
  type Settings,
  type StockItem,
} from '@pcp/shared';
import { getSettings, orderRepo, stockRepo } from './db.js';

/** 以当前库存与订单内容试排（不落库、不占库存） */
export function computePlan(orderId: number): {
  orderHash: string;
  settingsHash: string;
  payload: PlanPayload;
} {
  const pieces = orderRepo.pieces(orderId);
  const settings = getSettings();
  const stock = stockRepo.list();
  return computePlanFrom(stock, pieces, settings);
}

export function computePlanFrom(
  stock: StockItem[],
  pieces: OrderPiece[],
  settings: Settings,
): {
  orderHash: string;
  settingsHash: string;
  payload: PlanPayload;
} {
  const orderHash = computeOrderHash(pieces);
  const settingsHash = computeSettingsHash(settings);
  const payload = pack({ stock, pieces, settings, orderHash, settingsHash });
  return { orderHash, settingsHash, payload };
}
