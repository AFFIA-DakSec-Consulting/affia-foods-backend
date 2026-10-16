/**
 * Step 2 of the pipeline (KRAVEO_SPEC_MODULES.md 7.5 - 7.7): what the courier earns. PURE.
 * RULE 2: this file never receives what the customer pays (no fee, no discount, no coupon in its input). The payout depends on the
 * work done: distance, number of stops, time of day, weather flag. A free delivery for the customer changes nothing here.
 */
import { clamp, money, splitProportional } from '../../shared/pricing/money';
import { inWindow } from '../../shared/pricing/clock';
import { findZone } from '../delivery/delivery-pricing.engine';
import type { CourierConfig, CourierResult, PricingContext, ZoneRow } from '../../shared/pricing/types';

type WorkContext = Pick<PricingContext, 'distanceKm' | 'restaurantsCount' | 'now'>;

const perKmPayout = (cfg: CourierConfig, km: number): number => money(cfg.baseAmount + km * cfg.perKm);

const bonusApplies = (cfg: CourierConfig, b: CourierConfig['bonuses']['rows'][number], ctx: WorkContext, zone: { id: string } | null): boolean => {
  const c = b.conditions ?? {};
  switch (b.triggerType) {
    case 'RAIN': return cfg.bonuses.rainMode;
    case 'NIGHT':
    case 'RUSH_HOUR': return typeof c.from === 'string' && typeof c.to === 'string' && inWindow(ctx.now, { from: c.from, to: c.to });
    case 'ZONE': return !!zone && typeof c.zoneId === 'string' && c.zoneId === zone.id;
    default: return false; // MANUAL bonuses are granted by an admin, never automatically
  }
};

export const computeCourierPayout = (cfg: CourierConfig, zones: ZoneRow[], ctx: WorkContext): CourierResult => {
  const z = findZone(zones, ctx.distanceKm);
  const zoneRef = z ? { id: z.id, label: z.label } : null;
  let base: number;
  if (cfg.mode === 'flat') base = money(cfg.flatAmount);
  else if (cfg.mode === 'per_zone') base = z && z.courierPayout !== null ? money(z.courierPayout) : perKmPayout(cfg, ctx.distanceKm);
  else base = perKmPayout(cfg, ctx.distanceKm);

  const group = ctx.restaurantsCount > 1;
  const extraStops = group && cfg.batch.enabled ? (ctx.restaurantsCount - 1) * cfg.batch.extraStopPayout : 0;

  const hit = cfg.bonuses.enabled ? cfg.bonuses.rows.filter((b) => bonusApplies(cfg, b, ctx, zoneRef)) : [];
  const bonuses = hit.reduce((a, b) => a + money(b.amount), 0);

  const total = clamp(base + extraStops + bonuses, cfg.minPayout, cfg.maxPayout);
  return { courierPayout: money(total), base, extraStops, bonuses, bonusNames: hit.map((b) => b.name), zone: zoneRef };
};

/** Spreads a group's payout over its children (for the books of each restaurant order): parts add up to the total exactly. */
export const splitCourierPayout = (total: number, strategy: CourierConfig['batch']['splitStrategy'], legKm: number[]): number[] =>
  splitProportional(total, strategy === 'equal' ? legKm.map(() => 1) : legKm);
