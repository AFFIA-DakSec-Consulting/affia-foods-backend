/**
 * Shadow mode (KRAVEO_SPEC_MODULES.md 13, rule 7). The legacy code (services/pricing.ts + utils/validation.ts) STILL decides what the
 * customer pays. Right after an order or group is created, the same cart goes through the module pipeline; the two results are
 * compared into PricingParityLog, and the new pipeline's snapshot (fee, courier payout, modules used) is written once on the order.
 *
 * Safety: it runs after the commit and outside the order transaction, never awaited by the request, and swallows every error (a bug here
 * must never fail or slow a checkout). PRICING_ENGINE_MODE=off disables it; it is off by default under NODE_ENV=test.
 * The cut-over (new engine decides) is a separate, deliberate step once the log shows zero diffs for 7 days.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { distanceKm, dropPointCoords, normalizeDropPoint, vendorHasLocation } from '../../config/campus';
import { errSummary } from '../../utils/log';
import { computePricing } from './pricing.pipeline';

export const pricingEngineMode = (): 'off' | 'shadow' => {
  const raw = (process.env.PRICING_ENGINE_MODE ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === 'shadow') return raw;
  return process.env.NODE_ENV === 'test' ? 'off' : 'shadow';
};

export type ShadowInput = {
  kind: 'order' | 'group';
  refId: string;
  customerId: string;
  vendors: { id: string; lat: number; lng: number }[];
  cartAmount: number;
  dropoffHostel: string;
  dropoffLat: number | null;
  dropoffLng: number | null;
  couponCode: string | null;
  legacy: { fee: number; discount: number; total: number };
  orderIds: string[];
};

type Pt = { lat: number; lng: number };

/** Km of the tour restaurants (in order) -> customer, and the distance between the two farthest restaurants. null = unknown location. */
export const tourDistance = (vendors: Pt[], drop: Pt | null): { km: number; detourKm: number } | null => {
  if (!drop || vendors.length === 0) return null;
  let km = 0;
  for (let i = 0; i < vendors.length; i++) km += distanceKm(vendors[i], i + 1 < vendors.length ? vendors[i + 1] : drop);
  let detour = 0;
  for (let i = 0; i < vendors.length; i++) for (let j = i + 1; j < vendors.length; j++) detour = Math.max(detour, distanceKm(vendors[i], vendors[j]));
  return { km, detourKm: detour };
};

export const runShadow = async (s: ShadowInput): Promise<void> => {
  const now = new Date();
  const vendorPts = s.vendors.filter((v) => vendorHasLocation(v.lat, v.lng));
  const dropPt: Pt | null =
    typeof s.dropoffLat === 'number' && typeof s.dropoffLng === 'number' ? { lat: s.dropoffLat, lng: s.dropoffLng } : dropPointCoords(normalizeDropPoint(s.dropoffHostel) ?? '');
  const tour = vendorPts.length === s.vendors.length ? tourDistance(vendorPts, dropPt) : null;
  const legacy = { fee: s.legacy.fee, discount: s.legacy.discount, total: s.legacy.total };
  try {
    const r = await computePricing({
      context: { cartAmount: Math.round(s.cartAmount), distanceKm: tour?.km ?? 0, restaurantsCount: s.vendors.length, maxDetourKm: tour?.detourKm ?? 0, now, city: 'default' },
      vendorIds: s.vendors.map((v) => v.id), userId: s.customerId, promoCode: s.couponCode, excludeOrderIds: s.orderIds, mode: 'shadow',
    });
    if (!tour) r.snapshot.warnings.push('DISTANCE_UNKNOWN');
    const next = { fee: r.deliveryFeeCustomer, discount: r.cartDiscount, total: r.customerTotal };
    const diff = (['fee', 'discount', 'total'] as const).filter((k) => Math.round(legacy[k]) !== next[k]);
    await prisma.pricingParityLog.create({ data: { orderRef: s.refId, legacyResult: legacy, newResult: { ...next, courierPayout: r.courierPayout, warnings: r.snapshot.warnings }, hasDiff: diff.length > 0, diffFields: diff } });
    const snap = {
      deliveryFeeOriginal: r.deliveryFeeOriginal, deliveryFeeCustomer: r.deliveryFeeCustomer, courierPayout: r.courierPayout, deliverySubsidy: r.deliverySubsidy,
      merchantContribution: r.merchantContribution, promotionId: r.promotionId, subscriptionId: r.subscriptionId, pricingSnapshot: r.snapshot as unknown as Prisma.InputJsonValue,
    };
    const where = { id: s.refId, pricingSnapshot: { equals: Prisma.DbNull } }; // write once: the snapshot is immutable
    if (s.kind === 'group') await prisma.orderGroup.updateMany({ where, data: snap });
    else await prisma.order.updateMany({ where, data: snap });
  } catch (err) {
    console.error('pricing shadow failed:', errSummary(err));
    await prisma.pricingParityLog.create({ data: { orderRef: s.refId, legacyResult: legacy, newResult: { error: err instanceof Error ? err.message.slice(0, 200) : 'error' }, hasDiff: true, diffFields: ['error'] } }).catch(() => undefined);
  }
};

const pending = new Set<Promise<unknown>>();
/** Fire and forget. Never throws, never blocks the caller. */
export const scheduleShadow = (s: ShadowInput): void => {
  if (pricingEngineMode() !== 'shadow') return;
  const p = runShadow(s).catch(() => undefined).finally(() => pending.delete(p));
  pending.add(p);
};
export const __waitForShadow = async () => { while (pending.size > 0) await Promise.all([...pending]); };
