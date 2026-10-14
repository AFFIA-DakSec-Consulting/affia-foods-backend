/**
 * Pricing engine (Docs/21_pricing_catalog_settlement_contract.md sections 2 and 3). PURE: no database, no clock, no I/O,
 * so every rule can be unit-tested with plain numbers. The settings service (services/settings.ts) loads and stores the values.
 *
 * Money rule: every calculation runs in integer "paise" (historical name: 1/100 of a FCFA, see config/currency.ts). FCFA amounts only
 * enter through `toPaise` and leave through `fromPaise`, so no float is ever compared for equality and a rounding error cannot
 * creep into a total. Amounts typed by admins and restaurants must be whole FCFA (the franc CFA has no centimes).
 *
 * Dish customer price = roundUp(vendorPrice + commission, step)
 *   commission: PERCENT = vendorPrice x value / 100, FLAT = value FCFA
 *   resolution: the dish's own override, else the restaurant's default, else the global default (most specific wins)
 *   rounding:   UP to a multiple of `step` FCFA (0 = no rounding). The difference goes to Kraveo, so
 *               the EFFECTIVE commission is price - vendorPrice.
 */

import { isWholeAmount } from '../config/currency';

// ---------------------------------------------------------------------------------------------------------------------
// Money helpers
// ---------------------------------------------------------------------------------------------------------------------
/** FCFA (at most 2 decimals) -> integer paise (1/100 FCFA). Throws on NaN / Infinity (a bug, never user input: inputs are validated first). */
export const toPaise = (amount: number): number => {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new RangeError(`Not a money amount: ${String(amount)}`);
  return Math.round(amount * 100);
};
/** Integer paise -> FCFA. */
export const fromPaise = (paise: number): number => Math.round(paise) / 100;

/** True when `amount` is a finite number with at most 2 decimals (used for percentages; money typed by a person uses isWholeAmount). */
export const hasAtMostTwoDecimals = (amount: number): boolean => Number.isFinite(amount) && Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-6;

const ceilDiv = (a: number, b: number): number => Math.floor((a + b - 1) / b);

/** Smallest multiple of `stepRupees` that is >= the amount. step <= 0 means "no rounding". Integer math only. */
export const roundUpToStep = (paise: number, stepRupees: number): number => {
  if (!(stepRupees > 0)) return paise;
  const stepPaise = toPaise(stepRupees);
  if (stepPaise <= 0) return paise;
  return ceilDiv(paise, stepPaise) * stepPaise;
};

// ---------------------------------------------------------------------------------------------------------------------
// Settings shapes, defaults and limits
// ---------------------------------------------------------------------------------------------------------------------
export type CommissionType = 'PERCENT' | 'FLAT';
export type CommissionRule = { type: CommissionType; value: number };
export type RuleSource = 'DISH' | 'VENDOR' | 'GLOBAL';

export type FeeLine = { key: string; label: string; amount: number };
export type FeesSettings = {
  baseFee: number;
  lines: FeeLine[];
  extraRestaurantFee: number;
  freeFeeAbove: number;
  smallOrderBelow: number;
  smallOrderFee: number;
  gstOnFeesPercent: number;
  gstOnFoodPercent: number;
  /** Docs/22: most restaurants in one checkout, 1..5 (1 switches multi-restaurant orders off). Missing in a stored row = 3. */
  maxRestaurantsPerOrder: number;
};
export type CommissionSettings = CommissionRule;
export type RoundingSettings = { step: number };
export type SettlementSettings = { time: string; mode: 'MANUAL_PAYOUT' | 'AUTO_PAYOUT'; autoCreate: boolean; holdDays: number };

export type SettingsMap = {
  fees: FeesSettings;
  commission: CommissionSettings;
  rounding: RoundingSettings;
  settlement: SettlementSettings;
};
export type SettingGroup = keyof SettingsMap;
export const SETTING_GROUPS: readonly SettingGroup[] = ['fees', 'commission', 'rounding', 'settlement'];
export const isSettingGroup = (g: unknown): g is SettingGroup => typeof g === 'string' && (SETTING_GROUPS as readonly string[]).includes(g);

/**
 * A fresh database: one all-in delivery fee of 500 FCFA, 300 FCFA for each extra restaurant, no commission, whole-FCFA prices.
 * The `gst*` setting names are kept for API compatibility with the apps; read them as TVA. Menu prices in Senegal already include
 * TVA, so it is 0% on food; fees carry the 18% TVA.
 */
export const DEFAULT_SETTINGS: SettingsMap = {
  fees: { baseFee: 500, lines: [], extraRestaurantFee: 300, freeFeeAbove: 0, smallOrderBelow: 0, smallOrderFee: 0, gstOnFeesPercent: 18, gstOnFoodPercent: 0, maxRestaurantsPerOrder: 3 },
  commission: { type: 'PERCENT', value: 0 },
  rounding: { step: 1 },
  settlement: { time: '22:00', mode: 'MANUAL_PAYOUT', autoCreate: true, holdDays: 0 },
};
export const cloneDefaults = <G extends SettingGroup>(group: G): SettingsMap[G] => JSON.parse(JSON.stringify(DEFAULT_SETTINGS[group]));

export const LIMITS = {
  maxFee: 5_000,
  /** Docs/22: the flat fee each EXTRA restaurant adds (0..2000 FCFA). */
  maxExtraRestaurantFee: 2_000,
  /** Docs/22: fees.maxRestaurantsPerOrder range. */
  minRestaurantsPerOrder: 1,
  maxRestaurantsPerOrder: 5,
  maxThreshold: 200_000,
  maxPercent: 100,
  maxFlatCommission: 50_000,
  maxFeeLines: 10,
  maxHoldDays: 30,
  roundingSteps: [0, 1, 2, 5, 10, 25, 50, 100] as readonly number[],
};
/** Phase 2 turns this on when a payout provider is connected; until then AUTO_PAYOUT is refused with a clear message. */
export const AUTO_PAYOUT_AVAILABLE = false;

// ---------------------------------------------------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------------------------------------------------
export type Problem = { field: string; message: string };
export type Checked<T> = { ok: true; value: T } | { ok: false; error: Problem };
const bad = (field: string, message: string): { ok: false; error: Problem } => ({ ok: false, error: { field, message } });

/** `type` and `value` as written by an admin: PERCENT 0-100 (at most 2 decimals) or FLAT 0-50000 whole FCFA. */
export const checkCommissionRule = (type: unknown, value: unknown, fieldPrefix = ''): Checked<CommissionRule> => {
  const f = (name: string) => `${fieldPrefix}${name}`;
  if (type !== 'PERCENT' && type !== 'FLAT') return bad(f('type'), 'Commission type must be PERCENT or FLAT.');
  if (typeof value !== 'number' || !Number.isFinite(value)) return bad(f('value'), 'Commission value must be a number.');
  if (value < 0) return bad(f('value'), 'Commission cannot be negative.');
  if (type === 'PERCENT' && !hasAtMostTwoDecimals(value)) return bad(f('value'), 'Commission can have at most 2 decimals.');
  if (type === 'FLAT' && !isWholeAmount(value)) return bad(f('value'), 'A flat commission must be a whole number of FCFA.');
  if (type === 'PERCENT' && value > LIMITS.maxPercent) return bad(f('value'), `A percentage commission cannot be more than ${LIMITS.maxPercent}%.`);
  if (type === 'FLAT' && value > LIMITS.maxFlatCommission) return bad(f('value'), `A flat commission cannot be more than ${LIMITS.maxFlatCommission} FCFA.`);
  return { ok: true, value: { type, value } };
};

/**
 * Optional override as stored on a dish or restaurant: both null (or undefined) = inherit, both set = a rule.
 * Exactly one set is a data error. Returns null for "inherit".
 */
export const ruleFromColumns = (type: string | null | undefined, value: number | null | undefined): CommissionRule | null => {
  if ((type !== 'PERCENT' && type !== 'FLAT') || typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return { type, value };
};

/** Most specific wins: dish -> restaurant -> global. */
export const resolveCommission = (
  dish: CommissionRule | null | undefined,
  vendor: CommissionRule | null | undefined,
  global: CommissionRule,
): { rule: CommissionRule; source: RuleSource } => {
  if (dish) return { rule: dish, source: 'DISH' };
  if (vendor) return { rule: vendor, source: 'VENDOR' };
  return { rule: global, source: 'GLOBAL' };
};

/** Customer price in paise BEFORE the rounding step: vendor + commission, rounded up to the next paisa. Exact integer math. */
export const priceBeforeStepPaise = (vendorPaise: number, rule: CommissionRule): number => {
  if (rule.type === 'FLAT') return vendorPaise + toPaise(rule.value);
  const hundredths = toPaise(rule.value); // 12.5% -> 1250 (percent in hundredths)
  return ceilDiv(vendorPaise * (10_000 + hundredths), 10_000);
};

export type DishPrice = {
  vendorPrice: number;
  rule: CommissionRule;
  source: RuleSource;
  /** Customer price, FCFA. */
  price: number;
  /** What the rule alone asks for (before rounding), FCFA. */
  nominalCommission: number;
  /** price - vendorPrice, FCFA: what Kraveo really keeps per unit, rounding included. */
  effectiveCommission: number;
  step: number;
};

export const priceDish = (input: {
  vendorPrice: number;
  dish?: CommissionRule | null;
  vendor?: CommissionRule | null;
  global: CommissionRule;
  step: number;
}): DishPrice => {
  const vendorPaise = toPaise(input.vendorPrice);
  const { rule, source } = resolveCommission(input.dish, input.vendor, input.global);
  const beforeStep = priceBeforeStepPaise(vendorPaise, rule);
  const pricePaise = roundUpToStep(beforeStep, input.step);
  return {
    vendorPrice: fromPaise(vendorPaise),
    rule,
    source,
    price: fromPaise(pricePaise),
    nominalCommission: fromPaise(beforeStep - vendorPaise),
    effectiveCommission: fromPaise(pricePaise - vendorPaise),
    step: input.step,
  };
};

// ---------------------------------------------------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------------------------------------------------
export type FeeBreakdown = {
  version: 1;
  /** The one amount the customer pays as the fee (= Order.deliveryFee). */
  total: number;
  baseFee: number;
  /** True when the base fee was waived because the food subtotal reached `freeFeeAbove`. */
  baseWaived: boolean;
  smallOrderFee: number;
  restaurants: number;
  extraRestaurantFee: number;
  extraRestaurants: number;
  /** The named lines of the base fee (records only: the customer sees one line). Empty when none are configured or the base fee was waived. */
  lines: FeeLine[];
};

/**
 * The all-in fee for an order (Docs/21 section 3).
 *   base fee            baseFee, or 0 when `freeFeeAbove` > 0 and the food subtotal is at or above it
 *   small-order fee     smallOrderFee when `smallOrderBelow` > 0 and the food subtotal is below it
 *   extra restaurants   extraRestaurantFee x (restaurants - 1), always charged (phase 3 only ever passes restaurants > 1)
 * The food subtotal is the customer food total BEFORE any coupon (coupons are paid by Kraveo, they never change the fee).
 */
export const computeFees = (fees: FeesSettings, subtotal: number, restaurants = 1): { total: number; breakdown: FeeBreakdown } => {
  const subtotalPaise = toPaise(subtotal);
  const count = Number.isInteger(restaurants) && restaurants >= 1 ? restaurants : 1;
  const waived = fees.freeFeeAbove > 0 && subtotalPaise >= toPaise(fees.freeFeeAbove);
  const basePaise = waived ? 0 : toPaise(fees.baseFee);
  const smallPaise = fees.smallOrderBelow > 0 && subtotalPaise < toPaise(fees.smallOrderBelow) ? toPaise(fees.smallOrderFee) : 0;
  const extras = count - 1;
  const extraPaise = extras * toPaise(fees.extraRestaurantFee);
  const totalPaise = basePaise + smallPaise + extraPaise;
  return {
    total: fromPaise(totalPaise),
    breakdown: {
      version: 1,
      total: fromPaise(totalPaise),
      baseFee: fromPaise(basePaise),
      baseWaived: waived,
      smallOrderFee: fromPaise(smallPaise),
      restaurants: count,
      extraRestaurantFee: fromPaise(extraPaise),
      extraRestaurants: extras,
      lines: waived ? [] : fees.lines.map((l) => ({ key: l.key, label: l.label, amount: l.amount })),
    },
  };
};

// ---------------------------------------------------------------------------------------------------------------------
// Multi-restaurant orders (Docs/22 section 1): how a group's money is split over its children. Pure, integer paise.
// ---------------------------------------------------------------------------------------------------------------------
/**
 * Splits `totalPaise` over `weights` (>= 0, integers) proportionally with the largest-remainder method, so the parts are integers
 * and add up to `totalPaise` EXACTLY. Ties go to the lowest index. With all weights 0 nothing can be proportional: the first part gets it all.
 */
export const largestRemainderSplit = (totalPaise: number, weights: number[]): number[] => {
  const n = weights.length;
  if (n === 0) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  if (totalPaise <= 0) return weights.map(() => 0);
  if (sum <= 0) return weights.map((_, i) => (i === 0 ? totalPaise : 0));
  const parts = weights.map((w) => Math.floor((totalPaise * w) / sum));
  const rem = weights.map((w, i) => ({ i, r: (totalPaise * w) % sum }));
  let left = totalPaise - parts.reduce((a, b) => a + b, 0);
  rem.sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0 && k < rem.length; k++, left--) parts[rem[k].i] += 1;
  return parts;
};

export type GroupChildMoney = {
  /** Child's own food, customer prices (FCFA). */
  subtotal: number;
  /** Child 0: base fee (+ small-order fee) after the free-fee rule on the COMBINED subtotal; every other child: extraRestaurantFee. */
  fee: number;
  /** Child's share of the coupon discount (largest remainder, paise exact). */
  discount: number;
  /** subtotal + fee - discount. */
  total: number;
};

/**
 * The money of a group: the fee for the COMBINED food subtotal (computeFees knows the extra-restaurant fee), the coupon discount
 * (already computed on the combined subtotal by the caller), and the per-child parts. Invariant, asserted here: the children's totals
 * add up to the group total to the paisa.
 */
export const splitGroupMoney = (fees: FeesSettings, childSubtotals: number[], discount: number): {
  subtotal: number; feeTotal: number; discount: number; total: number; breakdown: FeeBreakdown; children: GroupChildMoney[];
} => {
  const subtotalsP = childSubtotals.map(toPaise);
  const combinedP = subtotalsP.reduce((a, b) => a + b, 0);
  const n = childSubtotals.length;
  const fee = computeFees(fees, fromPaise(combinedP), n);
  const feeP = toPaise(fee.total);
  const extraP = toPaise(fees.extraRestaurantFee);
  const baseP = feeP - (n - 1) * extraP; // base fee + small-order fee (>= 0 by construction)
  const discountP = Math.min(toPaise(discount), combinedP);
  const discParts = largestRemainderSplit(discountP, subtotalsP);
  const children = subtotalsP.map((s, i): GroupChildMoney => {
    const f = i === 0 ? baseP : extraP;
    return { subtotal: fromPaise(s), fee: fromPaise(f), discount: fromPaise(discParts[i]), total: fromPaise(s + f - discParts[i]) };
  });
  const totalP = combinedP + feeP - discountP;
  const sumP = subtotalsP.reduce((a, s, i) => a + s + (i === 0 ? baseP : extraP) - discParts[i], 0);
  if (baseP < 0 || sumP !== totalP) throw new Error(`group money does not add up (${sumP} != ${totalP})`);
  return { subtotal: fromPaise(combinedP), feeTotal: fee.total, discount: fromPaise(discountP), total: fromPaise(totalP), breakdown: fee.breakdown, children };
};

// ---------------------------------------------------------------------------------------------------------------------
// Validation of the setting groups (strict: unknown keys, wrong types and out-of-range values are all refused)
// ---------------------------------------------------------------------------------------------------------------------
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const unknownKeys = (obj: Record<string, unknown>, allowed: readonly string[]): string | null => {
  const extra = Object.keys(obj).find((k) => !allowed.includes(k));
  return extra ?? null;
};

const money = (obj: Record<string, unknown>, key: string, max: number, label: string, unit = ' FCFA'): Checked<number> => {
  const v = obj[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return bad(key, `${label} must be a number.`);
  if (v < 0) return bad(key, `${label} cannot be negative.`);
  if (unit === '') {
    if (!hasAtMostTwoDecimals(v)) return bad(key, `${label} can have at most 2 decimals.`);
  } else if (!isWholeAmount(v)) return bad(key, `${label} must be a whole number of FCFA.`);
  if (v > max) return bad(key, `${label} cannot be more than ${max}${unit || '%'}.`);
  return { ok: true, value: v };
};

const FEE_KEYS = ['baseFee', 'lines', 'extraRestaurantFee', 'freeFeeAbove', 'smallOrderBelow', 'smallOrderFee', 'gstOnFeesPercent', 'gstOnFoodPercent', 'maxRestaurantsPerOrder'] as const;
const LINE_KEY_RE = /^[a-z][a-z0-9_]{0,29}$/;

export const validateFees = (raw: unknown): Checked<FeesSettings> => {
  if (!isPlainObject(raw)) return bad('fees', 'Fees must be an object.');
  const extra = unknownKeys(raw, FEE_KEYS);
  if (extra) return bad(extra, `Unknown fee setting '${extra.slice(0, 40)}'.`);
  const baseFee = money(raw, 'baseFee', LIMITS.maxFee, 'The fee');
  if (!baseFee.ok) return baseFee;
  const extraFee = money(raw, 'extraRestaurantFee', LIMITS.maxExtraRestaurantFee, 'The extra-restaurant fee');
  if (!extraFee.ok) return extraFee;
  const freeAbove = money(raw, 'freeFeeAbove', LIMITS.maxThreshold, 'The free-fee limit');
  if (!freeAbove.ok) return freeAbove;
  const smallBelow = money(raw, 'smallOrderBelow', LIMITS.maxThreshold, 'The small-order limit');
  if (!smallBelow.ok) return smallBelow;
  const smallFee = money(raw, 'smallOrderFee', LIMITS.maxFee, 'The small-order fee');
  if (!smallFee.ok) return smallFee;
  const gstFees = money(raw, 'gstOnFeesPercent', 100, 'TVA on fees', '');
  if (!gstFees.ok) return gstFees;
  const gstFood = money(raw, 'gstOnFoodPercent', 100, 'TVA on food', '');
  if (!gstFood.ok) return gstFood;
  // Missing (a row stored before Docs/22) = the default 3, so an old row keeps validating and behaves like the default.
  const maxRaw = raw.maxRestaurantsPerOrder === undefined ? DEFAULT_SETTINGS.fees.maxRestaurantsPerOrder : raw.maxRestaurantsPerOrder;
  if (typeof maxRaw !== 'number' || !Number.isInteger(maxRaw) || maxRaw < LIMITS.minRestaurantsPerOrder || maxRaw > LIMITS.maxRestaurantsPerOrder) {
    return bad('maxRestaurantsPerOrder', `The most restaurants per order must be a whole number from ${LIMITS.minRestaurantsPerOrder} to ${LIMITS.maxRestaurantsPerOrder} (1 turns multi-restaurant orders off).`);
  }
  if (freeAbove.value > 0 && smallBelow.value > freeAbove.value) {
    return bad('smallOrderBelow', 'The small-order limit cannot be higher than the free-fee limit (an order cannot be both free and small).');
  }
  if (smallBelow.value > 0 && smallFee.value === 0) return bad('smallOrderFee', 'Set a small-order fee, or set the small-order limit to 0 to turn it off.');

  const rawLines = raw.lines;
  if (!Array.isArray(rawLines)) return bad('lines', 'Lines must be a list (it can be empty).');
  if (rawLines.length > LIMITS.maxFeeLines) return bad('lines', `At most ${LIMITS.maxFeeLines} fee lines.`);
  const lines: FeeLine[] = [];
  const seen = new Set<string>();
  let sumPaise = 0;
  for (let i = 0; i < rawLines.length; i++) {
    const l = rawLines[i];
    if (!isPlainObject(l)) return bad(`lines[${i}]`, 'Each line needs a key, a label and an amount.');
    const bad2 = unknownKeys(l, ['key', 'label', 'amount']);
    if (bad2) return bad(`lines[${i}].${bad2}`, `Unknown field '${bad2.slice(0, 40)}' in a fee line.`);
    if (typeof l.key !== 'string' || !LINE_KEY_RE.test(l.key)) return bad(`lines[${i}].key`, 'A line key is lower case letters, digits and _ (starts with a letter, up to 30).');
    if (seen.has(l.key)) return bad(`lines[${i}].key`, `The line key '${l.key}' is used twice.`);
    seen.add(l.key);
    if (typeof l.label !== 'string' || !l.label.trim() || l.label.trim().length > 40) return bad(`lines[${i}].label`, 'A line label is required (up to 40 characters).');
    const amount = money(l, 'amount', LIMITS.maxFee, 'A line amount');
    if (!amount.ok) return bad(`lines[${i}].amount`, amount.error.message);
    sumPaise += toPaise(amount.value);
    lines.push({ key: l.key, label: l.label.trim().replace(/\s+/g, ' '), amount: amount.value });
  }
  if (lines.length > 0 && sumPaise !== toPaise(baseFee.value)) {
    return bad('lines', `The lines add up to ${fromPaise(sumPaise)} FCFA but the fee is ${baseFee.value} FCFA. They must be equal.`);
  }
  return {
    ok: true,
    value: {
      baseFee: baseFee.value,
      lines,
      extraRestaurantFee: extraFee.value,
      freeFeeAbove: freeAbove.value,
      smallOrderBelow: smallBelow.value,
      smallOrderFee: smallFee.value,
      gstOnFeesPercent: gstFees.value,
      gstOnFoodPercent: gstFood.value,
      maxRestaurantsPerOrder: maxRaw,
    },
  };
};

export const validateCommissionSetting = (raw: unknown): Checked<CommissionSettings> => {
  if (!isPlainObject(raw)) return bad('commission', 'Commission must be an object.');
  const extra = unknownKeys(raw, ['type', 'value']);
  if (extra) return bad(extra, `Unknown commission setting '${extra.slice(0, 40)}'.`);
  return checkCommissionRule(raw.type, raw.value);
};

export const validateRounding = (raw: unknown): Checked<RoundingSettings> => {
  if (!isPlainObject(raw)) return bad('rounding', 'Rounding must be an object.');
  const extra = unknownKeys(raw, ['step']);
  if (extra) return bad(extra, `Unknown rounding setting '${extra.slice(0, 40)}'.`);
  if (typeof raw.step !== 'number' || !LIMITS.roundingSteps.includes(raw.step)) {
    return bad('step', `Rounding step must be one of ${LIMITS.roundingSteps.join(', ')} (0 = no rounding).`);
  }
  return { ok: true, value: { step: raw.step } };
};

export const validateSettlement = (raw: unknown): Checked<SettlementSettings> => {
  if (!isPlainObject(raw)) return bad('settlement', 'Settlement must be an object.');
  const extra = unknownKeys(raw, ['time', 'mode', 'autoCreate', 'holdDays']);
  if (extra) return bad(extra, `Unknown settlement setting '${extra.slice(0, 40)}'.`);
  if (typeof raw.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.time)) return bad('time', 'Settlement time must be HH:MM (24 hour, Dakar time), for example 22:00.');
  if (raw.mode !== 'MANUAL_PAYOUT' && raw.mode !== 'AUTO_PAYOUT') return bad('mode', 'Settlement mode must be MANUAL_PAYOUT or AUTO_PAYOUT.');
  if (raw.mode === 'AUTO_PAYOUT' && !AUTO_PAYOUT_AVAILABLE) return bad('mode', 'Automatic payout is not available yet: no payout provider is connected. Use MANUAL_PAYOUT.');
  if (typeof raw.autoCreate !== 'boolean') return bad('autoCreate', 'autoCreate must be true or false.');
  if (typeof raw.holdDays !== 'number' || !Number.isInteger(raw.holdDays) || raw.holdDays < 0 || raw.holdDays > LIMITS.maxHoldDays) {
    return bad('holdDays', `holdDays must be a whole number from 0 to ${LIMITS.maxHoldDays}.`);
  }
  return { ok: true, value: { time: raw.time, mode: raw.mode, autoCreate: raw.autoCreate, holdDays: raw.holdDays } };
};

export const validateSettingGroup = <G extends SettingGroup>(group: G, raw: unknown): Checked<SettingsMap[G]> => {
  switch (group) {
    case 'fees': return validateFees(raw) as Checked<SettingsMap[G]>;
    case 'commission': return validateCommissionSetting(raw) as Checked<SettingsMap[G]>;
    case 'rounding': return validateRounding(raw) as Checked<SettingsMap[G]>;
    case 'settlement': return validateSettlement(raw) as Checked<SettingsMap[G]>;
    default: return bad('group', 'Unknown settings group.');
  }
};
