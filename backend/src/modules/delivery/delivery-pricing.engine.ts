/**
 * Step 1 of the pipeline (KRAVEO_SPEC_MODULES.md 7.1 - 7.4, 8): what the customer would pay for delivery BEFORE any promotion.
 * PURE: no database, no clock (the caller passes `now`), no marketing. Every value comes from the DeliveryConfig the pipeline built
 * from module_settings / delivery_zones (rule 3: nothing monetary or distance-related is written in this file).
 */
import { AppError } from '../../utils/appError';
import { clamp, money, roundToMultiple } from '../../shared/pricing/money';
import { inWindow } from '../../shared/pricing/clock';
import type { DeliveryConfig, DeliveryResult, PricingContext, ZoneRow } from '../../shared/pricing/types';

/** Zone with `minKm <= km < maxKm` (the last zone has no upper limit). Zones are checked in grid order. */
export const findZone = (rows: ZoneRow[], km: number): ZoneRow | null =>
  [...rows].sort((a, b) => a.minKm - b.minKm).find((z) => km >= z.minKm && (z.maxKm === null || km < z.maxKm)) ?? null;

/** frais = clamp(base + km x price/km, min, max), then rounded. */
export const formulaFee = (cfg: DeliveryConfig, km: number): number =>
  roundToMultiple(clamp(cfg.baseFee + km * cfg.pricePerKm, cfg.minFee, cfg.maxFee), cfg.rounding);

export const computeDeliveryFee = (cfg: DeliveryConfig, ctx: PricingContext): DeliveryResult => {
  const warnings: string[] = [];
  if (ctx.distanceKm > cfg.maxDeliveryDistance) {
    throw new AppError(400, 'OUT_OF_RANGE', `Delivery is not available beyond ${cfg.maxDeliveryDistance} km.`, 'distance_km');
  }
  if (ctx.restaurantsCount > 1) {
    if (!cfg.multi.enabled) throw new AppError(400, 'MULTI_DISABLED', 'Ordering from several restaurants at once is switched off right now.', 'restaurants_count');
    if (ctx.restaurantsCount > cfg.multi.maxRestaurants) {
      throw new AppError(400, 'TOO_MANY_RESTAURANTS', `At most ${cfg.multi.maxRestaurants} restaurants per order.`, 'restaurants_count');
    }
    if (ctx.maxDetourKm > cfg.multi.maxDetourKm) {
      throw new AppError(400, 'DETOUR_TOO_LONG', `The restaurants are ${ctx.maxDetourKm.toFixed(1)} km apart (maximum ${cfg.multi.maxDetourKm} km).`, 'restaurants_count');
    }
  }

  // Base: the zone grid when the module is on, else (or when the zone has no fee and the fallback is on) the formula.
  let zone: DeliveryResult['zone'] = null;
  let base: number;
  if (cfg.zones.enabled) {
    const z = findZone(cfg.zones.rows, ctx.distanceKm);
    if (z && z.fee !== null) {
      zone = { id: z.id, label: z.label };
      base = money(z.fee);
    } else if (cfg.zones.fallbackToFormula) {
      if (z) zone = { id: z.id, label: z.label };
      base = formulaFee(cfg, ctx.distanceKm);
      warnings.push('ZONE_FALLBACK_TO_FORMULA');
    } else {
      throw new AppError(400, 'OUT_OF_RANGE', 'No delivery zone covers this distance.', 'distance_km');
    }
  } else {
    base = formulaFee(cfg, ctx.distanceKm);
  }

  const small = cfg.smallOrderBelow > 0 && ctx.cartAmount < cfg.smallOrderBelow ? cfg.smallOrderFee : 0;

  // Surge applies to the distance fee (the small-order fee is not multiplied), is capped as a whole.
  let surge = 0;
  if (cfg.surge.enabled) {
    const rush = cfg.surge.rushHours.some((w) => inWindow(ctx.now, w));
    if (rush && cfg.surge.rushMultiplier > 1) surge += Math.round(base * (cfg.surge.rushMultiplier - 1));
    if (cfg.surge.rainMode) surge += cfg.surge.rainSurcharge;
    surge = Math.min(surge, cfg.surge.maxSurgeTotal);
  }

  const extraStops = ctx.restaurantsCount > 1 ? (ctx.restaurantsCount - 1) * cfg.multi.extraStopFee : 0;
  return {
    deliveryFeeOriginal: money(base + small + surge + extraStops),
    baseFee: base,
    smallOrderFee: small,
    extraStopsFee: extraStops,
    surge,
    zone,
    warnings,
  };
};
