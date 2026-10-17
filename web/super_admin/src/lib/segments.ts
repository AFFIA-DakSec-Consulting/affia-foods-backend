// Automatic customer segments (inspired by the Eylos dashboard): computed from what a customer did, no manual list to maintain.
// Pure and React-free. A customer can belong to several segments (e.g. "à risque" and "récurrent").
import type { CustomerRow } from '../types';

export const SEGMENT_IDS = ['NEW', 'NEVER_ORDERED', 'FIRST_ORDER', 'RECURRING', 'LOYAL', 'AT_RISK'] as const;
export type SegmentId = (typeof SEGMENT_IDS)[number];

export const SEGMENT_INFO: Record<SegmentId, { label: string; hint: string }> = {
  NEW: { label: 'Nouveaux', hint: 'Inscrits depuis moins de 30 jours' },
  NEVER_ORDERED: { label: 'Jamais commandé', hint: 'Compte créé, aucune commande' },
  FIRST_ORDER: { label: '1re commande', hint: 'Une seule commande à ce jour' },
  RECURRING: { label: 'Récurrents', hint: '2 à 4 commandes' },
  LOYAL: { label: 'Fidèles', hint: '5 commandes ou plus' },
  AT_RISK: { label: 'À risque', hint: 'Ont déjà commandé, mais plus depuis 30 jours' },
};

const DAY_MS = 86_400_000;
export const NEW_DAYS = 30;
export const AT_RISK_DAYS = 30;

type SegmentInput = Pick<CustomerRow, 'createdAt' | 'ordersCount' | 'lastOrderAt' | 'deleted'>;

export const segmentsOf = (c: SegmentInput, now: number = Date.now()): SegmentId[] => {
  if (c.deleted) return [];
  const out: SegmentId[] = [];
  if (now - new Date(c.createdAt).getTime() < NEW_DAYS * DAY_MS) out.push('NEW');
  if (c.ordersCount === 0) out.push('NEVER_ORDERED');
  if (c.ordersCount === 1) out.push('FIRST_ORDER');
  if (c.ordersCount >= 2 && c.ordersCount <= 4) out.push('RECURRING');
  if (c.ordersCount >= 5) out.push('LOYAL');
  if (c.ordersCount > 0 && c.lastOrderAt && now - new Date(c.lastOrderAt).getTime() > AT_RISK_DAYS * DAY_MS) out.push('AT_RISK');
  return out;
};

export const countSegments = (customers: SegmentInput[], now: number = Date.now()): Record<SegmentId, number> => {
  const counts = Object.fromEntries(SEGMENT_IDS.map((id) => [id, 0])) as Record<SegmentId, number>;
  for (const c of customers) for (const id of segmentsOf(c, now)) counts[id] += 1;
  return counts;
};
