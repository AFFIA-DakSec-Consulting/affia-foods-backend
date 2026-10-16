/** Pure engines of the modular platform (KRAVEO_SPEC_MODULES.md 7, 12, 15): no database. */
import { computeDeliveryFee } from '../../src/modules/delivery/delivery-pricing.engine';
import { computeCourierPayout, splitCourierPayout } from '../../src/modules/courier/courier-payout.engine';
import { evaluateMarketing, MarketingConfig, MarketingContext, PromotionRow } from '../../src/modules/marketing/marketing.engine';
import { computeEffective } from '../../src/core/modules/module-registry.service';
import { validateSettingValue, crossCheck } from '../../src/core/modules/settings-validation';
import { validateZones, readPromotion } from '../../src/core/modules/admin-catalogs.service';
import { COUPONS } from '../../src/utils/validation';
import type { CourierConfig, DeliveryConfig, PricingContext } from '../../src/shared/pricing/types';

const zones = [
  { id: 'z1', label: '0-2', minKm: 0, maxKm: 2, fee: 700, courierPayout: 700 },
  { id: 'z2', label: '2-5', minKm: 2, maxKm: 5, fee: 1100, courierPayout: 1000 },
  { id: 'z3', label: '5-8', minKm: 5, maxKm: 8, fee: 1600, courierPayout: 1400 },
  { id: 'z4', label: '8+', minKm: 8, maxKm: null, fee: null, courierPayout: null },
];
const delivery = (o: Partial<DeliveryConfig> = {}): DeliveryConfig => ({
  baseFee: 500, pricePerKm: 150, minFee: 500, maxFee: 5000, maxDeliveryDistance: 10, rounding: 50, smallOrderBelow: 0, smallOrderFee: 0,
  zones: { enabled: false, rows: zones, fallbackToFormula: true },
  surge: { enabled: false, rainMode: false, rainSurcharge: 200, rushMultiplier: 1.2, rushHours: [{ from: '12:00', to: '14:00' }], maxSurgeTotal: 800 },
  multi: { enabled: true, extraStopFee: 300, maxRestaurants: 3, maxDetourKm: 3 }, ...o,
});
const courier = (o: Partial<CourierConfig> = {}): CourierConfig => ({
  mode: 'per_zone', flatAmount: 1000, baseAmount: 400, perKm: 120, minPayout: 700, maxPayout: 10000,
  batch: { enabled: false, extraStopPayout: 250, splitStrategy: 'proportional_to_distance' }, bonuses: { enabled: false, rows: [], rainMode: false }, ...o,
});
const ctx = (o: Partial<PricingContext> = {}): PricingContext => ({ cartAmount: 10000, distanceKm: 4, restaurantsCount: 1, maxDetourKm: 0, now: new Date('2026-10-15T09:00:00Z'), city: 'default', ...o });

describe('delivery engine', () => {
  test('spec 7.1: 4 km = 500 + 4 x 150 = 1100', () => expect(computeDeliveryFee(delivery(), ctx()).deliveryFeeOriginal).toBe(1100));
  test('price_per_km = 0 reproduces today: a flat fee whatever the distance', () => {
    const cfg = delivery({ pricePerKm: 0, rounding: 1, minFee: 0 });
    expect([1, 4, 9].map((km) => computeDeliveryFee(cfg, ctx({ distanceKm: km })).deliveryFeeOriginal)).toEqual([500, 500, 500]);
  });
  test('zones use the grid, fall back to the formula past the last zone, and clamp/round the formula', () => {
    const cfg = delivery({ zones: { enabled: true, rows: zones, fallbackToFormula: true } });
    expect(computeDeliveryFee(cfg, ctx({ distanceKm: 4 })).deliveryFeeOriginal).toBe(1100);
    expect(computeDeliveryFee(cfg, ctx({ distanceKm: 9 })).warnings).toContain('ZONE_FALLBACK_TO_FORMULA');
    expect(computeDeliveryFee(delivery({ rounding: 50 }), ctx({ distanceKm: 1.1 })).deliveryFeeOriginal).toBe(650);
    expect(() => computeDeliveryFee(delivery({ zones: { enabled: true, rows: zones, fallbackToFormula: false } }), ctx({ distanceKm: 9 }))).toThrow(/zone/i);
  });
  test('out of range, too many restaurants, long detour are refused; extra stops are charged', () => {
    expect(() => computeDeliveryFee(delivery(), ctx({ distanceKm: 11 }))).toThrow(/beyond/);
    expect(() => computeDeliveryFee(delivery(), ctx({ restaurantsCount: 4 }))).toThrow(/At most 3/);
    expect(() => computeDeliveryFee(delivery(), ctx({ restaurantsCount: 2, maxDetourKm: 4 }))).toThrow(/apart/);
    expect(computeDeliveryFee(delivery(), ctx({ restaurantsCount: 3, maxDetourKm: 1 })).extraStopsFee).toBe(600);
  });
  test('surge: rush multiplier + rain, capped as a whole; small-order fee is not multiplied', () => {
    const on = delivery({ surge: { ...delivery().surge, enabled: true, rainMode: true } });
    const rush = computeDeliveryFee(on, ctx({ now: new Date('2026-10-15T12:30:00Z') }));
    expect(rush.surge).toBe(Math.min(Math.round(1100 * 0.2) + 200, 800));
    expect(computeDeliveryFee(on, ctx({ now: new Date('2026-10-15T16:00:00Z') })).surge).toBe(200);
    expect(computeDeliveryFee(delivery({ smallOrderBelow: 3000, smallOrderFee: 200 }), ctx({ cartAmount: 2000 })).smallOrderFee).toBe(200);
  });
});

describe('courier engine (rule 2: independent of the customer)', () => {
  test('spec example: zone 2-5 km pays 1000, whatever the customer pays', () => {
    expect(computeCourierPayout(courier(), zones, ctx()).courierPayout).toBe(1000);
  });
  test('the input has no fee or discount: a free delivery cannot change it', () => {
    const a = computeCourierPayout(courier(), zones, ctx());
    const b = computeCourierPayout(courier(), zones, ctx({ cartAmount: 99999 }));
    expect(a.courierPayout).toBe(b.courierPayout);
  });
  test('modes, floor and cap', () => {
    expect(computeCourierPayout(courier({ mode: 'flat' }), zones, ctx()).courierPayout).toBe(1000);
    expect(computeCourierPayout(courier({ mode: 'per_km' }), zones, ctx()).courierPayout).toBe(880);
    expect(computeCourierPayout(courier({ mode: 'per_km', minPayout: 900 }), zones, ctx({ distanceKm: 0 })).courierPayout).toBe(900);
    expect(computeCourierPayout(courier({ mode: 'flat', flatAmount: 90000, maxPayout: 5000 }), zones, ctx()).courierPayout).toBe(5000);
    expect(computeCourierPayout(courier(), zones, ctx({ distanceKm: 9 })).courierPayout).toBe(1480); // last zone has no amount: per_km fallback
  });
  test('batch pays one tour + extra stops, not two full runs; bonuses by condition; split adds up exactly', () => {
    const batch = courier({ batch: { enabled: true, extraStopPayout: 250, splitStrategy: 'proportional_to_distance' } });
    expect(computeCourierPayout(batch, zones, ctx({ restaurantsCount: 2 })).courierPayout).toBe(1250);
    expect(computeCourierPayout(courier(), zones, ctx({ restaurantsCount: 2 })).courierPayout).toBe(1000);
    const night = courier({ bonuses: { enabled: true, rainMode: true, rows: [
      { id: 'b1', name: 'Nuit', triggerType: 'NIGHT', amount: 300, conditions: { from: '22:00', to: '06:00' } },
      { id: 'b2', name: 'Pluie', triggerType: 'RAIN', amount: 200, conditions: null },
      { id: 'b3', name: 'Manuel', triggerType: 'MANUAL', amount: 999, conditions: null },
    ] } });
    expect(computeCourierPayout(night, zones, ctx({ now: new Date('2026-10-15T23:00:00Z') })).courierPayout).toBe(1500);
    expect(computeCourierPayout(night, zones, ctx({ now: new Date('2026-10-15T12:00:00Z') })).courierPayout).toBe(1200);
    const parts = splitCourierPayout(1000, 'proportional_to_distance', [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(splitCourierPayout(1001, 'equal', [5, 1, 9]).reduce((a, b) => a + b, 0)).toBe(1001);
  });
});

const promo = (o: Partial<PromotionRow>): PromotionRow => ({
  id: 'p', moduleCode: 'marketing.promo_codes', name: 'P', code: null, type: 'FIXED_OFF_CART', value: 0, fundedBy: 'PLATFORM', merchantSharePct: 0, minCartAmount: null, maxDistanceKm: null,
  maxDiscountAmount: null, eligibleCities: [], eligibleMerchants: [], firstOrderOnly: false, requiresRedemption: false, maxUsesTotal: null, maxUsesPerUser: 1, budgetTotal: null,
  budgetSpent: 0, startsAt: null, endsAt: null, priority: 0, stackable: false, ...o,
});
const mcfg = (o: Partial<MarketingConfig> = {}): MarketingConfig => ({
  enabled: { freeDelivery: true, promoCodes: true, firstOrder: true, subscription: true, merchantFunded: true }, allowStacking: false, maxSubsidyPerOrder: 1200, monthlyBudgetLeft: null, maxMerchantSharePct: 50, ...o,
});
const mctx = (o: Partial<MarketingContext> = {}): MarketingContext => ({
  cartAmount: 10000, deliveryFeeOriginal: 1100, distanceKm: 4, city: 'default', vendorIds: ['v1'], now: new Date('2026-10-15T09:00:00Z'), isFirstOrder: false, promoCode: null, promotions: [],
  userUses: {}, totalUses: {}, redemptionsAvailable: 0, subscription: null, ...o,
});

describe('marketing engine', () => {
  test('spec section 12: free delivery 1100, restaurant pays 27.27% = 300, platform 800, customer pays 0', () => {
    const p = promo({ id: 'fd', moduleCode: 'marketing.free_delivery', type: 'FREE_DELIVERY', fundedBy: 'SPLIT', merchantSharePct: 300 / 1100 * 100 > 50 ? 50 : 27.27, minCartAmount: 8000, maxDistanceKm: 5 });
    const r = evaluateMarketing(mcfg(), mctx({ promotions: [p] }));
    expect(r.deliveryFeeCustomer).toBe(0);
    expect(r.merchantContribution).toBe(299); // floor(1100 x 27.27%): the platform keeps the rounding
    expect(r.deliverySubsidy).toBe(801);
    expect(r.deliverySubsidy + r.merchantContribution).toBe(1100);
  });
  test('guard rails: subsidy cap, budget, monthly budget, min cart, distance make a promotion NOT apply', () => {
    const fd = promo({ id: 'fd', moduleCode: 'marketing.free_delivery', type: 'FREE_DELIVERY' });
    expect(evaluateMarketing(mcfg({ maxSubsidyPerOrder: 1000 }), mctx({ promotions: [fd] })).applied).toHaveLength(0);
    expect(evaluateMarketing(mcfg({ monthlyBudgetLeft: 500 }), mctx({ promotions: [fd] })).applied).toHaveLength(0);
    expect(evaluateMarketing(mcfg(), mctx({ promotions: [{ ...fd, budgetTotal: 1000, budgetSpent: 0 }] })).applied).toHaveLength(0);
    expect(evaluateMarketing(mcfg(), mctx({ promotions: [{ ...fd, minCartAmount: 20000 }] })).applied).toHaveLength(0);
    expect(evaluateMarketing(mcfg(), mctx({ promotions: [{ ...fd, maxDistanceKm: 3 }] })).applied).toHaveLength(0);
    expect(evaluateMarketing(mcfg(), mctx({ promotions: [fd] })).deliveryFeeCustomer).toBe(0);
  });
  test('module switches: a promotion of a disabled sub-module never applies', () => {
    const fd = promo({ moduleCode: 'marketing.free_delivery', type: 'FREE_DELIVERY' });
    expect(evaluateMarketing(mcfg({ enabled: { ...mcfg().enabled, freeDelivery: false } }), mctx({ promotions: [fd] })).applied).toHaveLength(0);
  });
  test('merchant funding is ignored when marketing.merchant_funded is off, and capped by the setting', () => {
    const p = promo({ type: 'FIXED_OFF_DELIVERY', value: 400, fundedBy: 'SPLIT', merchantSharePct: 90, code: 'X' });
    const on = evaluateMarketing(mcfg(), mctx({ promotions: [p], promoCode: 'X' }));
    expect(on.merchantContribution).toBe(200); // capped at 50%
    const off = evaluateMarketing(mcfg({ enabled: { ...mcfg().enabled, merchantFunded: false } }), mctx({ promotions: [p], promoCode: 'X' }));
    expect(off.merchantContribution).toBe(0);
  });
  test('most advantageous wins; stacking only with the setting, both stackable, different kinds', () => {
    const cart = promo({ id: 'a', code: 'A', type: 'FIXED_OFF_CART', value: 500, stackable: true });
    const del = promo({ id: 'b', code: 'B', type: 'FIXED_OFF_DELIVERY', value: 300, stackable: true });
    const one = evaluateMarketing(mcfg(), mctx({ promotions: [cart, del], promoCode: 'A' }));
    expect(one.applied.map((a) => a.promotionId)).toEqual(['a']); // B was not typed
    const auto = [{ ...cart, code: null, budgetTotal: 100000 }, { ...del, code: null, budgetTotal: 100000 }];
    expect(evaluateMarketing(mcfg(), mctx({ promotions: auto })).applied).toHaveLength(1);
    const both = evaluateMarketing(mcfg({ allowStacking: true }), mctx({ promotions: auto }));
    expect(both.cartDiscount + both.deliveryDiscount).toBe(800);
  });
  test('legacy coupons keep their exact numbers (BIENVENUE, KRAVEO50, KRAVEO20)', () => {
    const bienvenue = promo({ id: 'bv', moduleCode: 'marketing.first_order', code: 'BIENVENUE', type: 'PERCENT_OFF_CART', value: 20, minCartAmount: 2500, maxDiscountAmount: 1000, firstOrderOnly: true });
    const k50 = promo({ id: 'k50', code: 'KRAVEO50', type: 'FIXED_OFF_CART', value: 1000, minCartAmount: 3500, maxDiscountAmount: 1000 });
    const k20 = promo({ id: 'k20', code: 'KRAVEO20', type: 'FIXED_OFF_CART', value: 500, minCartAmount: 2000, maxDiscountAmount: 500, requiresRedemption: true, maxUsesPerUser: null });
    for (const cart of [1999, 2000, 2499, 2500, 3499, 3500, 4999, 5000, 5001, 12345]) {
      const check = (p: PromotionRow, code: string, extra: Partial<MarketingContext>) => {
        const legacy = COUPONS[code];
        const r = evaluateMarketing(mcfg(), mctx({ cartAmount: cart, promotions: [p], promoCode: code, ...extra }));
        expect(r.cartDiscount).toBe(cart >= legacy.minSubtotal ? legacy.discount(cart) : 0);
      };
      check(bienvenue, 'BIENVENUE', { isFirstOrder: true });
      check(k50, 'KRAVEO50', {});
      check(k20, 'KRAVEO20', { redemptionsAvailable: 1 });
    }
    expect(evaluateMarketing(mcfg(), mctx({ promotions: [bienvenue], promoCode: 'BIENVENUE', isFirstOrder: false })).codeProblem).toMatch(/first order/);
    expect(evaluateMarketing(mcfg(), mctx({ promotions: [k50], promoCode: 'KRAVEO50', userUses: { k50: 1 } })).codeProblem).toMatch(/already used/);
    expect(evaluateMarketing(mcfg(), mctx({ promotions: [k20], promoCode: 'KRAVEO20' })).codeProblem).toMatch(/Coins/);
  });
  test('subscription: free delivery within plan limits and quota', () => {
    const sub = { subscriptionId: 's1', minCartAmount: 3000, maxDistanceKm: 6, quotaLeft: 1 };
    expect(evaluateMarketing(mcfg(), mctx({ subscription: sub })).deliveryFeeCustomer).toBe(0);
    expect(evaluateMarketing(mcfg(), mctx({ subscription: { ...sub, quotaLeft: 0 } })).deliveryFeeCustomer).toBe(1100);
    expect(evaluateMarketing(mcfg(), mctx({ subscription: { ...sub, minCartAmount: 20000 } })).deliveryFeeCustomer).toBe(1100);
  });
});

describe('module registry dependencies', () => {
  const m = (code: string, o: Partial<Parameters<typeof computeEffective>[0][number]> = {}) => ({ code, parentCode: null, isEnabled: true, isCore: false, requires: [] as string[], requiresMode: 'ALL', ...o });
  test('marketing OFF disables every marketing.* module whatever their own flag; ANY and ALL requirements', () => {
    const e = computeEffective([m('marketing', { isEnabled: false }), m('marketing.free_delivery', { parentCode: 'marketing', requires: ['marketing'] }), m('marketing.promo_codes', { parentCode: 'marketing', requires: ['marketing'] }),
      m('marketing.merchant_funded', { parentCode: 'marketing', requires: ['marketing.free_delivery', 'marketing.promo_codes'], requiresMode: 'ANY' }), m('delivery.base_pricing', { isCore: true, isEnabled: false })]);
    expect([...e.entries()].filter(([c]) => c.startsWith('marketing')).every(([, on]) => !on)).toBe(true);
    expect(e.get('delivery.base_pricing')).toBe(true); // core is always on
    const e2 = computeEffective([m('marketing'), m('marketing.free_delivery', { parentCode: 'marketing', isEnabled: false }), m('marketing.promo_codes', { parentCode: 'marketing' }),
      m('marketing.merchant_funded', { parentCode: 'marketing', requires: ['marketing.free_delivery', 'marketing.promo_codes'], requiresMode: 'ANY' })]);
    expect(e2.get('marketing.merchant_funded')).toBe(true);
    const e3 = computeEffective([m('a', { requires: ['b'] }), m('b', { requires: ['a'] })]);
    expect(e3.get('a')).toBe(false); // a cycle never turns anything on
  });
});

describe('input validation', () => {
  const meta = (valueType: string, o: Record<string, unknown> = {}) => ({ key: 'k', valueType, minValue: null, maxValue: null, options: null, ...o }) as any;
  test('settings: type, whole FCFA, range, options, json shape', () => {
    expect(() => validateSettingValue(meta('money'), 10.5)).toThrow(/whole/);
    expect(() => validateSettingValue(meta('money', { maxValue: 100 }), 101)).toThrow(/maximum/);
    expect(() => validateSettingValue(meta('money'), -1)).toThrow();
    expect(() => validateSettingValue(meta('number'), 'x')).toThrow();
    expect(() => validateSettingValue(meta('number'), Number.NaN)).toThrow();
    expect(() => validateSettingValue(meta('boolean'), 'true')).toThrow();
    expect(() => validateSettingValue(meta('string', { options: ['a', 'b'] }), 'c')).toThrow(/Allowed/);
    expect(validateSettingValue(meta('string', { options: ['a'] }), 'a')).toBe('a');
    expect(() => validateSettingValue({ ...meta('json'), key: 'rush_hours' }, [{ from: '25:00', to: '14:00' }])).toThrow();
    expect(() => validateSettingValue({ ...meta('json'), key: 'rush_hours' }, [{ from: '12:00', to: '14:00', x: 1 }])).toThrow();
    expect(() => validateSettingValue({ ...meta('json'), key: 'unknown_json' }, {})).toThrow();
    expect(() => crossCheck('delivery.base_pricing', { min_fee: 900, max_fee: 500 })).toThrow(/minimum/);
    expect(() => crossCheck('courier.base_payout', { min_payout: 900, max_payout: 500 })).toThrow();
  });
  test('zones must start at 0, be contiguous, and only the last one is open', () => {
    const ok = { zones: [{ label: 'a', minKm: 0, maxKm: 2, fee: 700, courierPayout: 700 }, { label: 'b', minKm: 2, maxKm: null, fee: null, courierPayout: null }] };
    expect(validateZones(ok).zones).toHaveLength(2);
    expect(() => validateZones({ zones: [{ label: 'a', minKm: 1, maxKm: 2, fee: 1, courierPayout: 1 }] })).toThrow(/start at 0/);
    expect(() => validateZones({ zones: [{ label: 'a', minKm: 0, maxKm: 2, fee: 1, courierPayout: 1 }, { label: 'b', minKm: 3, maxKm: null, fee: 1, courierPayout: 1 }] })).toThrow(/contiguous/);
    expect(() => validateZones({ zones: [{ label: 'a', minKm: 0, maxKm: null, fee: 1, courierPayout: 1 }, { label: 'b', minKm: 2, maxKm: null, fee: 1, courierPayout: 1 }] })).toThrow();
    expect(() => validateZones({ zones: [{ label: 'a', minKm: 0, maxKm: 2, fee: 99999999, courierPayout: 1 }] })).toThrow();
    expect(() => validateZones({ zones: [{ label: '<b>', minKm: 0, maxKm: null, fee: 1, courierPayout: 1 }] })).toThrow(/forbidden/);
    expect(() => validateZones({ zones: ok.zones, extra: 1 })).toThrow(/Unknown/);
  });
  test('promotions: code format, percent range, funding cap, dates, automatic promotions must be bounded', () => {
    const base = { moduleCode: 'marketing.promo_codes', type: 'FIXED_OFF_CART', value: 500, name: 'Test', description: 'Test promo', code: 'abc-1' };
    expect(readPromotion(base, 50).code).toBe('ABC-1');
    expect(() => readPromotion({ ...base, code: 'a b' }, 50)).toThrow(/code/);
    expect(() => readPromotion({ ...base, type: 'PERCENT_OFF_CART', value: 150 }, 50)).toThrow();
    expect(() => readPromotion({ ...base, type: 'FREE_DELIVERY', value: 10 }, 50)).toThrow();
    expect(() => readPromotion({ ...base, fundedBy: 'SPLIT', merchantSharePct: 80 }, 50)).toThrow(/cannot fund/);
    expect(() => readPromotion({ ...base, startsAt: '2026-10-10T00:00:00Z', endsAt: '2026-10-01T00:00:00Z' }, 50)).toThrow(/after/);
    expect(() => readPromotion({ ...base, code: null }, 50)).toThrow(/budget/);
    expect(() => readPromotion({ ...base, moduleCode: 'marketing' }, 50)).toThrow();
    expect(() => readPromotion({ ...base, requiresRedemption: true }, 50)).toThrow(/coin/);
  });
});
