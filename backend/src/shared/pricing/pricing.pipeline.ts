/**
 * PricingPipeline (KRAVEO_SPEC_MODULES.md 8): delivery -> courier -> marketing -> funding -> guard rails -> snapshot.
 * `orders/` calls compute() and gets a frozen result; it knows nothing about prices or promotions (rule of isolation).
 *
 * Order of the layers is the point of the design: the delivery and courier engines are called FIRST and never receive anything from
 * marketing (rules 2 and 4); marketing only lowers what the customer pays afterwards, and is skipped as a whole when the `marketing`
 * module is off. The loaders below read the database once per run; the engines they feed are pure.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { getRegistry, Registry } from '../../core/modules/module-registry.service';
import { computeDeliveryFee } from '../../modules/delivery/delivery-pricing.engine';
import { computeCourierPayout } from '../../modules/courier/courier-payout.engine';
import { evaluateMarketing, MarketingConfig, MarketingContext, MarketingResult, PromotionRow } from '../../modules/marketing/marketing.engine';
import { buildSnapshot } from './pricing-snapshot';
import type { BonusRow, CourierConfig, CourierResult, DeliveryConfig, DeliveryResult, PricingContext, RushWindow, ZoneRow } from './types';

type Db = Prisma.TransactionClient | typeof prisma;

export type PipelineInput = {
  context: PricingContext;
  vendorIds: string[];
  userId: string | null;
  promoCode: string | null;
  /** Earlier orders of THIS checkout (the shadow run happens after the order exists), excluded from "first order" and use counts. */
  excludeOrderIds?: string[];
  /** Simulator only: force a module on/off to test it BEFORE activating it. */
  overrides?: Record<string, boolean>;
  mode?: string;
};

export type PipelineResult = {
  delivery: DeliveryResult;
  courier: CourierResult;
  marketing: MarketingResult | null;
  deliveryFeeOriginal: number;
  deliveryFeeCustomer: number;
  cartDiscount: number;
  customerTotal: number;
  courierPayout: number;
  deliverySubsidy: number;
  merchantContribution: number;
  promotionId: string | null;
  subscriptionId: string | null;
  snapshot: ReturnType<typeof buildSnapshot>;
};

const monthStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

const makeIsOn = (registry: Registry, overrides?: Record<string, boolean>) => (code: string): boolean => {
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, code)) {
    const o = overrides[code] === true;
    return code === 'marketing' || !code.startsWith('marketing.') ? o : o && makeIsOn(registry, overrides)('marketing');
  }
  if (overrides && code.startsWith('marketing.') && Object.prototype.hasOwnProperty.call(overrides, 'marketing') && overrides.marketing === false) return false;
  return registry.isEnabled(code);
};

const loadZones = async (db: Db, city: string): Promise<ZoneRow[]> => {
  const rows = await db.deliveryZone.findMany({ where: { isActive: true, city: { in: [city, 'default'] } }, orderBy: [{ sortOrder: 'asc' }] });
  const own = rows.filter((z) => z.city === city);
  return (own.length > 0 ? own : rows.filter((z) => z.city === 'default')).map((z) => ({ id: z.id, label: z.label, minKm: z.minKm, maxKm: z.maxKm, fee: z.fee, courierPayout: z.courierPayout }));
};

export const buildDeliveryConfig = (registry: Registry, isOn: (c: string) => boolean, zones: ZoneRow[]): DeliveryConfig => ({
  baseFee: registry.num('delivery.base_pricing', 'base_fee'),
  pricePerKm: registry.num('delivery.base_pricing', 'price_per_km'),
  minFee: registry.num('delivery.base_pricing', 'min_fee'),
  maxFee: registry.num('delivery.base_pricing', 'max_fee'),
  maxDeliveryDistance: registry.num('delivery.base_pricing', 'max_delivery_distance'),
  rounding: registry.num('delivery.base_pricing', 'rounding'),
  smallOrderBelow: registry.num('delivery.base_pricing', 'small_order_below'),
  smallOrderFee: registry.num('delivery.base_pricing', 'small_order_fee'),
  zones: { enabled: isOn('delivery.zone_pricing'), rows: zones, fallbackToFormula: registry.bool('delivery.zone_pricing', 'fallback_to_formula') },
  surge: {
    enabled: isOn('delivery.surge_pricing'),
    rainMode: registry.bool('delivery.surge_pricing', 'rain_mode'),
    rainSurcharge: registry.num('delivery.surge_pricing', 'rain_surcharge'),
    rushMultiplier: registry.num('delivery.surge_pricing', 'rush_multiplier'),
    rushHours: registry.json<RushWindow[]>('delivery.surge_pricing', 'rush_hours'),
    maxSurgeTotal: registry.num('delivery.surge_pricing', 'max_surge_total'),
  },
  multi: {
    enabled: isOn('delivery.multi_restaurant'),
    extraStopFee: registry.num('delivery.multi_restaurant', 'extra_stop_fee'),
    maxRestaurants: registry.num('delivery.multi_restaurant', 'max_restaurants_per_group'),
    maxDetourKm: registry.num('delivery.multi_restaurant', 'max_detour_km'),
  },
});

export const buildCourierConfig = async (db: Db, registry: Registry, isOn: (c: string) => boolean): Promise<CourierConfig> => {
  const bonusesOn = isOn('courier.bonuses');
  const rows = bonusesOn ? await db.courierBonus.findMany({ where: { isActive: true } }) : [];
  const bonuses: BonusRow[] = rows.map((b) => ({ id: b.id, name: b.name, triggerType: b.triggerType, amount: b.amount, conditions: b.conditions && typeof b.conditions === 'object' && !Array.isArray(b.conditions) ? (b.conditions as Record<string, unknown>) : null }));
  return {
    mode: registry.str('courier.base_payout', 'mode') as CourierConfig['mode'],
    flatAmount: registry.num('courier.base_payout', 'flat_amount'),
    baseAmount: registry.num('courier.base_payout', 'base_amount'),
    perKm: registry.num('courier.base_payout', 'per_km'),
    minPayout: registry.num('courier.base_payout', 'min_payout'),
    maxPayout: registry.num('courier.base_payout', 'max_payout'),
    batch: {
      enabled: isOn('courier.batch_payout'),
      extraStopPayout: registry.num('courier.batch_payout', 'extra_stop_payout'),
      splitStrategy: registry.str('courier.batch_payout', 'split_strategy') as CourierConfig['batch']['splitStrategy'],
    },
    bonuses: { enabled: bonusesOn, rows: bonuses, rainMode: registry.bool('delivery.surge_pricing', 'rain_mode') },
  };
};

const toPromotionRow = (p: Prisma.PromotionGetPayload<{}>): PromotionRow => ({
  id: p.id, moduleCode: p.moduleCode, name: p.name, code: p.code, type: p.type as PromotionRow['type'], value: p.value,
  fundedBy: p.fundedBy as PromotionRow['fundedBy'], merchantSharePct: p.merchantSharePct, minCartAmount: p.minCartAmount, maxDistanceKm: p.maxDistanceKm,
  maxDiscountAmount: p.maxDiscountAmount, eligibleCities: p.eligibleCities, eligibleMerchants: p.eligibleMerchants, firstOrderOnly: p.firstOrderOnly,
  requiresRedemption: p.requiresRedemption, maxUsesTotal: p.maxUsesTotal, maxUsesPerUser: p.maxUsesPerUser, budgetTotal: p.budgetTotal, budgetSpent: p.budgetSpent,
  startsAt: p.startsAt, endsAt: p.endsAt, priority: p.priority, stackable: p.stackable,
});

const loadMarketing = async (db: Db, registry: Registry, isOn: (c: string) => boolean, input: PipelineInput, delivery: DeliveryResult): Promise<MarketingResult> => {
  const { context: c } = input;
  const cfg: MarketingConfig = {
    enabled: { freeDelivery: isOn('marketing.free_delivery'), promoCodes: isOn('marketing.promo_codes'), firstOrder: isOn('marketing.first_order'), subscription: isOn('marketing.subscription'), merchantFunded: isOn('marketing.merchant_funded') },
    allowStacking: registry.bool('marketing.promo_codes', 'allow_stacking'),
    maxSubsidyPerOrder: registry.num('marketing.free_delivery', 'max_subsidy_per_order'),
    monthlyBudgetLeft: null,
    maxMerchantSharePct: registry.num('marketing.merchant_funded', 'max_merchant_share_pct'),
  };
  const modules = [cfg.enabled.freeDelivery && 'marketing.free_delivery', cfg.enabled.promoCodes && 'marketing.promo_codes', cfg.enabled.firstOrder && 'marketing.first_order'].filter(Boolean) as string[];
  const promoRows = modules.length === 0 ? [] : await db.promotion.findMany({ where: { isActive: true, moduleCode: { in: modules }, OR: [{ code: null }, ...(input.promoCode ? [{ code: input.promoCode }] : [])] } });
  const exclude = input.excludeOrderIds ?? [];
  const userId = input.userId;
  const userUses: Record<string, number> = {};
  const totalUses: Record<string, number> = {};
  let isFirstOrder = true;
  let redemptionsAvailable = 0;
  let subscription: MarketingContext['subscription'] = null;
  if (userId) {
    isFirstOrder = (await db.order.count({ where: { customerId: userId, status: { not: 'CANCELLED' }, id: { notIn: exclude } } })) === 0;
    for (const p of promoRows) {
      if (!p.code) continue;
      userUses[p.id] = await db.order.count({ where: { customerId: userId, couponCode: p.code, status: { not: 'CANCELLED' }, id: { notIn: exclude } } });
    }
    redemptionsAvailable = (await db.user.findUnique({ where: { id: userId }, select: { kraveo20Redeemed: true } }))?.kraveo20Redeemed ?? 0;
    if (cfg.enabled.subscription) {
      const grace = registry.num('marketing.subscription', 'grace_period_days');
      const sub = await db.subscription.findFirst({ where: { userId, status: 'ACTIVE', startsAt: { lte: c.now }, endsAt: { gte: new Date(c.now.getTime() - grace * 86_400_000) }, plan: { isActive: true } }, include: { plan: true }, orderBy: { endsAt: 'desc' } });
      if (sub) subscription = { subscriptionId: sub.id, minCartAmount: sub.plan.minCartAmount, maxDistanceKm: sub.plan.maxDistanceKm, quotaLeft: sub.plan.freeDeliveriesQuota === null ? null : sub.plan.freeDeliveriesQuota - sub.deliveriesUsed };
    }
  }
  for (const p of promoRows) {
    if (p.maxUsesTotal !== null && p.code) totalUses[p.id] = await db.order.count({ where: { couponCode: p.code, status: { not: 'CANCELLED' }, id: { notIn: exclude } } });
    else if (p.maxUsesTotal !== null) totalUses[p.id] = await db.promotionRedemption.count({ where: { promotionId: p.id } });
  }
  if (cfg.enabled.freeDelivery) {
    const budget = registry.num('marketing.free_delivery', 'monthly_budget');
    const spent = await db.promotionRedemption.aggregate({ where: { createdAt: { gte: monthStart(c.now) }, promotion: { moduleCode: 'marketing.free_delivery' } }, _sum: { platformShare: true } });
    cfg.monthlyBudgetLeft = Math.max(0, budget - (spent._sum.platformShare ?? 0));
  }
  return evaluateMarketing(cfg, {
    cartAmount: c.cartAmount, deliveryFeeOriginal: delivery.deliveryFeeOriginal, distanceKm: c.distanceKm, city: c.city, vendorIds: input.vendorIds, now: c.now,
    isFirstOrder, promoCode: input.promoCode, promotions: promoRows.map(toPromotionRow), userUses, totalUses, redemptionsAvailable, subscription,
  });
};

export const computePricing = async (input: PipelineInput, db: Db = prisma): Promise<PipelineResult> => {
  const registry = await getRegistry();
  const isOn = makeIsOn(registry, input.overrides);
  const ctx = input.context;
  const zones = await loadZones(db, ctx.city);

  // STEP 1: customer base cost. STEP 2: courier payout. Neither can see marketing (rules 2 and 4).
  const delivery = computeDeliveryFee(buildDeliveryConfig(registry, isOn, zones), ctx);
  const courier = computeCourierPayout(await buildCourierConfig(db, registry, isOn), zones, ctx);

  // STEPS 3-5: marketing layer, skipped when the parent switch is off.
  const marketing = isOn('marketing') ? await loadMarketing(db, registry, isOn, input, delivery) : null;
  const cartDiscount = marketing?.cartDiscount ?? 0;
  const deliveryFeeCustomer = marketing ? marketing.deliveryFeeCustomer : delivery.deliveryFeeOriginal;
  const applied = marketing?.applied ?? [];
  const warnings = [...delivery.warnings];
  const snapshot = buildSnapshot(registry, { mode: input.mode ?? 'shadow', distanceKm: ctx.distanceKm, restaurantsCount: ctx.restaurantsCount, now: ctx.now, warnings, zone: delivery.zone, applied });
  if (input.overrides) (snapshot as Record<string, unknown>).overrides = input.overrides;
  return {
    delivery, courier, marketing,
    deliveryFeeOriginal: delivery.deliveryFeeOriginal,
    deliveryFeeCustomer,
    cartDiscount,
    customerTotal: ctx.cartAmount - cartDiscount + deliveryFeeCustomer,
    courierPayout: courier.courierPayout,
    deliverySubsidy: marketing?.deliverySubsidy ?? 0,
    merchantContribution: marketing?.merchantContribution ?? 0,
    promotionId: applied.find((a) => a.promotionId)?.promotionId ?? null,
    subscriptionId: applied.find((a) => a.subscriptionId)?.subscriptionId ?? null,
    snapshot,
  };
};
