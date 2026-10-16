/**
 * Steps 3, 4 and 5 of the pipeline (KRAVEO_SPEC_MODULES.md 7.9 - 7.16, 8, 15.5): promotions, who funds them, guard rails. PURE.
 * RULE 4: this layer runs AFTER the base calculation and only lowers what the customer pays; the delivery and courier engines never
 * import it. The pipeline skips this whole file when the `marketing` module is off.
 */
import { money } from '../../shared/pricing/money';

export type PromotionRow = {
  id: string;
  moduleCode: string;
  name: string;
  code: string | null;
  type: 'FREE_DELIVERY' | 'PERCENT_OFF_DELIVERY' | 'FIXED_OFF_DELIVERY' | 'PERCENT_OFF_CART' | 'FIXED_OFF_CART';
  value: number | null;
  fundedBy: 'PLATFORM' | 'MERCHANT' | 'SPLIT';
  merchantSharePct: number;
  minCartAmount: number | null;
  maxDistanceKm: number | null;
  maxDiscountAmount: number | null;
  eligibleCities: string[];
  eligibleMerchants: string[];
  firstOrderOnly: boolean;
  requiresRedemption: boolean;
  maxUsesTotal: number | null;
  maxUsesPerUser: number | null;
  budgetTotal: number | null;
  budgetSpent: number;
  startsAt: Date | null;
  endsAt: Date | null;
  priority: number;
  stackable: boolean;
};

export type SubscriptionOffer = { subscriptionId: string; minCartAmount: number | null; maxDistanceKm: number | null; quotaLeft: number | null };

export type MarketingConfig = {
  /** Effective state (own flag AND parent AND requirements) of each sub-module. */
  enabled: { freeDelivery: boolean; promoCodes: boolean; firstOrder: boolean; subscription: boolean; merchantFunded: boolean };
  allowStacking: boolean;
  /** marketing.free_delivery.max_subsidy_per_order */
  maxSubsidyPerOrder: number;
  /** What is left of marketing.free_delivery.monthly_budget this month (null = no limit). */
  monthlyBudgetLeft: number | null;
  /** marketing.merchant_funded.max_merchant_share_pct */
  maxMerchantSharePct: number;
};

export type MarketingContext = {
  cartAmount: number;
  deliveryFeeOriginal: number;
  distanceKm: number;
  city: string;
  vendorIds: string[];
  now: Date;
  isFirstOrder: boolean;
  /** Code typed by the customer, already normalised (upper case) or null. */
  promoCode: string | null;
  promotions: PromotionRow[];
  /** Earlier non-cancelled uses of each promotion by THIS customer (by orders carrying its code). */
  userUses: Record<string, number>;
  totalUses: Record<string, number>;
  /** Unused coin redemptions of this customer (KRAVEO20 style codes). */
  redemptionsAvailable: number;
  subscription: SubscriptionOffer | null;
};

export type Applied = {
  promotionId: string | null;
  subscriptionId: string | null;
  name: string;
  code: string | null;
  kind: 'DELIVERY' | 'CART';
  discount: number;
  merchantShare: number;
  platformShare: number;
};

export type MarketingResult = {
  applied: Applied[];
  cartDiscount: number;
  deliveryDiscount: number;
  /** delivery_fee_customer = max(0, original - deliveryDiscount) */
  deliveryFeeCustomer: number;
  merchantContribution: number;
  /** delivery_subsidy = total discount - merchant_contribution */
  deliverySubsidy: number;
  /** Why a code the customer typed gave nothing (shown to the customer), or null. */
  codeProblem: string | null;
  rejected: { promotionId: string; reason: string }[];
};

const isDelivery = (t: PromotionRow['type']) => t === 'FREE_DELIVERY' || t === 'PERCENT_OFF_DELIVERY' || t === 'FIXED_OFF_DELIVERY';
const moduleOn = (cfg: MarketingConfig, m: string): boolean =>
  m === 'marketing.free_delivery' ? cfg.enabled.freeDelivery : m === 'marketing.promo_codes' ? cfg.enabled.promoCodes : m === 'marketing.first_order' ? cfg.enabled.firstOrder : false;

/** The money a promotion would take off, before funding and guard rails. */
export const rawDiscount = (p: Pick<PromotionRow, 'type' | 'value' | 'maxDiscountAmount'>, cart: number, fee: number): number => {
  let d: number;
  switch (p.type) {
    case 'FREE_DELIVERY': d = fee; break;
    case 'PERCENT_OFF_DELIVERY': d = Math.floor((fee * (p.value ?? 0)) / 100); break;
    case 'FIXED_OFF_DELIVERY': d = Math.min(p.value ?? 0, fee); break;
    case 'PERCENT_OFF_CART': d = Math.floor((cart * (p.value ?? 0)) / 100); break;
    default: d = Math.min(p.value ?? 0, cart);
  }
  if (p.maxDiscountAmount !== null) d = Math.min(d, p.maxDiscountAmount);
  return money(d);
};

/** Funding split of one discount: the restaurant's share is a percentage, rounded DOWN (the platform keeps the remainder). */
export const fundDiscount = (cfg: MarketingConfig, p: Pick<PromotionRow, 'fundedBy' | 'merchantSharePct'>, discount: number): { merchantShare: number; platformShare: number } => {
  if (p.fundedBy === 'PLATFORM' || !cfg.enabled.merchantFunded) return { merchantShare: 0, platformShare: discount };
  const pct = Math.min(p.merchantSharePct, cfg.maxMerchantSharePct);
  const merchantShare = Math.min(discount, Math.floor((discount * pct) / 100));
  return { merchantShare, platformShare: discount - merchantShare };
};

type Candidate = { row: PromotionRow | null; applied: Applied; precedence: number };

export const evaluateMarketing = (cfg: MarketingConfig, ctx: MarketingContext): MarketingResult => {
  const rejected: MarketingResult['rejected'] = [];
  const candidates: Candidate[] = [];
  let codeProblem: string | null = null;
  let budgetLeft = cfg.monthlyBudgetLeft;

  // 15.5 evaluation order: subscription -> first order -> free delivery -> codes. Precedence breaks a tie in "most advantageous".
  if (cfg.enabled.subscription && ctx.subscription) {
    const s = ctx.subscription;
    const ok = (s.minCartAmount === null || ctx.cartAmount >= s.minCartAmount) && (s.maxDistanceKm === null || ctx.distanceKm <= s.maxDistanceKm) && (s.quotaLeft === null || s.quotaLeft > 0);
    if (ok && ctx.deliveryFeeOriginal > 0) {
      const d = ctx.deliveryFeeOriginal;
      candidates.push({ row: null, precedence: 4, applied: { promotionId: null, subscriptionId: s.subscriptionId, name: 'Abonnement', code: null, kind: 'DELIVERY', discount: d, merchantShare: 0, platformShare: d } });
    }
  }

  for (const p of ctx.promotions) {
    const reject = (reason: string) => {
      rejected.push({ promotionId: p.id, reason });
      if (p.code && p.code === ctx.promoCode) codeProblem = codeProblem ?? reason;
    };
    if (!moduleOn(cfg, p.moduleCode)) { reject('MODULE_OFF'); continue; }
    if (p.code !== null && p.code !== ctx.promoCode) continue; // a code the customer did not type is not a candidate at all
    if (p.startsAt && ctx.now < p.startsAt) { reject(`${p.code ?? p.name} is not active yet.`); continue; }
    if (p.endsAt && ctx.now >= p.endsAt) { reject(`${p.code ?? p.name} has expired.`); continue; }
    if (p.minCartAmount !== null && ctx.cartAmount < p.minCartAmount) { reject(`${p.code ?? p.name} needs an order of at least ${p.minCartAmount} FCFA.`); continue; }
    if (p.maxDistanceKm !== null && ctx.distanceKm > p.maxDistanceKm) { reject(`${p.code ?? p.name} does not apply this far away.`); continue; }
    if (p.eligibleCities.length > 0 && !p.eligibleCities.includes(ctx.city)) { reject(`${p.code ?? p.name} is not available in this city.`); continue; }
    if (p.eligibleMerchants.length > 0 && !ctx.vendorIds.every((v) => p.eligibleMerchants.includes(v))) { reject(`${p.code ?? p.name} is not available at these restaurants.`); continue; }
    if (p.firstOrderOnly && !ctx.isFirstOrder) { reject(`${p.code ?? p.name} is only for your first order.`); continue; }
    const used = ctx.userUses[p.id] ?? 0;
    if (p.requiresRedemption) {
      if (ctx.redemptionsAvailable - used <= 0) { reject(`${p.code ?? p.name} needs Kraveo Coins: redeem them first, then use the code.`); continue; }
    } else if (p.maxUsesPerUser !== null && used >= p.maxUsesPerUser) { reject(`You have already used ${p.code ?? p.name}.`); continue; }
    if (p.maxUsesTotal !== null && (ctx.totalUses[p.id] ?? 0) >= p.maxUsesTotal) { reject(`${p.code ?? p.name} is no longer available.`); continue; }

    const discount = rawDiscount(p, ctx.cartAmount, ctx.deliveryFeeOriginal);
    if (discount <= 0) { reject('NO_DISCOUNT'); continue; }
    const { merchantShare, platformShare } = fundDiscount(cfg, p, discount);

    // Step 5 guard rails: they make a promotion NOT apply (never silently shrink it).
    if (p.budgetTotal !== null && p.budgetSpent + platformShare > p.budgetTotal) { reject(`${p.code ?? p.name} budget is used up.`); continue; }
    if (p.type === 'FREE_DELIVERY' && platformShare > cfg.maxSubsidyPerOrder) { reject('SUBSIDY_CAP'); continue; }
    if (p.moduleCode === 'marketing.free_delivery' && budgetLeft !== null && platformShare > budgetLeft) { reject('MONTHLY_BUDGET'); continue; }

    const precedence = p.moduleCode === 'marketing.first_order' ? 3 : p.moduleCode === 'marketing.free_delivery' ? 2 : 1;
    candidates.push({ row: p, precedence, applied: { promotionId: p.id, subscriptionId: null, name: p.name, code: p.code, kind: isDelivery(p.type) ? 'DELIVERY' : 'CART', discount, merchantShare, platformShare } });
  }

  // Most advantageous for the customer; ties: higher priority, then evaluation order.
  const sorted = [...candidates].sort((a, b) => b.applied.discount - a.applied.discount || (b.row?.priority ?? 0) - (a.row?.priority ?? 0) || b.precedence - a.precedence);
  const chosen: Candidate[] = [];
  if (sorted.length > 0) {
    chosen.push(sorted[0]);
    // Stacking only when the setting allows it, both are stackable, and they lower different things (one delivery, one cart).
    if (cfg.allowStacking && sorted[0].row?.stackable) {
      const other = sorted.find((c) => c !== sorted[0] && c.row?.stackable && c.applied.kind !== sorted[0].applied.kind);
      if (other) chosen.push(other);
    }
  }
  if (budgetLeft !== null) budgetLeft -= chosen.filter((c) => c.row?.moduleCode === 'marketing.free_delivery').reduce((a, c) => a + c.applied.platformShare, 0);

  const applied = chosen.map((c) => c.applied);
  const sum = (kind: Applied['kind']) => applied.filter((a) => a.kind === kind).reduce((s, a) => s + a.discount, 0);
  const cartDiscount = Math.min(sum('CART'), ctx.cartAmount);
  const deliveryDiscount = Math.min(sum('DELIVERY'), ctx.deliveryFeeOriginal);
  const total = cartDiscount + deliveryDiscount;
  const merchantContribution = Math.min(applied.reduce((s, a) => s + a.merchantShare, 0), total);
  return {
    applied,
    cartDiscount,
    deliveryDiscount,
    deliveryFeeCustomer: Math.max(0, ctx.deliveryFeeOriginal - deliveryDiscount),
    merchantContribution,
    deliverySubsidy: total - merchantContribution,
    codeProblem: applied.length === 0 ? codeProblem : null,
    rejected,
  };
};
