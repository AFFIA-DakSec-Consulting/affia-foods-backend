import type { Registry } from '../../core/modules/module-registry.service';

/** What an order freezes about HOW its price was made (rule 5: changing a setting tomorrow never rewrites history). */
export const buildSnapshot = (registry: Registry, extra: { mode: string; distanceKm: number; restaurantsCount: number; now: Date; warnings: string[]; zone: { id: string; label: string } | null; applied: { promotionId: string | null; subscriptionId: string | null; code: string | null; discount: number }[] }) => {
  const s = registry.snapshot();
  return {
    version: 1,
    mode: extra.mode, // 'shadow' while the legacy engine is the one that charges
    calculated_at: extra.now.toISOString(),
    modules_enabled: s.enabled,
    settings: s.settings,
    distance_km: Math.round(extra.distanceKm * 100) / 100,
    restaurants_count: extra.restaurantsCount,
    zone: extra.zone,
    applied: extra.applied,
    warnings: extra.warnings,
  };
};
