// Pricing helpers for the Catalog and Settings sections (Docs/21 sections 2-4, 6).
// Money is typed as text and parsed here: a number is accepted only when it is plain digits with at most 2 decimals and
// inside a sane range, so NaN, negatives, "1e9" and 3-decimal values can never reach a save button.
// The server stays authoritative; these limits only stop obvious mistakes early. Adjust them here in one place.

export type CommissionType = 'PERCENT' | 'FLAT';

export const MAX_DISH_PRICE = 10_000;
// Same limits as the backend (services/pricing.ts LIMITS, utils/catalog.ts MAX_MENU_PRICE).
export const MAX_FLAT_COMMISSION = 5_000;
export const MAX_FEE = 500;
export const MAX_THRESHOLD = 10_000;
/** Docs/22: the flat fee each extra restaurant adds (server LIMITS.maxExtraRestaurantFee) and the allowed restaurants per order (1 = off). */
export const MAX_EXTRA_RESTAURANT_FEE = 200;
export const MIN_RESTAURANTS_PER_ORDER = 1;
export const MAX_RESTAURANTS_PER_ORDER = 5;
export const DEFAULT_RESTAURANTS_PER_ORDER = 3;

export const ROUNDING_STEPS = [0, 1, 2, 5, 10] as const;
export type RoundingStep = (typeof ROUNDING_STEPS)[number];

/** Whole paise, so sums and comparisons never touch float noise. */
export const toPaise = (rupees: number): number => Math.round(rupees * 100);

/** French grouping with a plain space ("1 500"), so the text is the same in every browser and in tests. */
export const frNumber = (value: number, opts?: Intl.NumberFormatOptions): string => value.toLocaleString('fr-FR', opts).replace(/[\u202f\u00a0]/g, ' ');

/** FCFA with decimals only when they exist: 1500 -> "1 500 FCFA", 120.5 -> "120,50 FCFA". */
export const rupees = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const paise = toPaise(value);
  const whole = paise % 100 === 0;
  const text = frNumber(paise / 100, whole ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${text} FCFA`;
};

export type ParsedNumber = { ok: true; value: number } | { ok: false; message: string };

const PLAIN_AMOUNT = /^\d{1,7}(\.\d{1,2})?$/;

/** Parses typed text into a non-negative number with at most 2 decimals, within [min, max]. */
export const parseAmount = (text: string, opts: { label: string; min?: number; max: number; allowZero?: boolean }): ParsedNumber => {
  const { label, max, allowZero = true } = opts;
  const min = opts.min ?? 0;
  const clean = text.trim();
  if (clean === '') return { ok: false, message: `Indiquez ${label}.` };
  if (/^-/.test(clean)) return { ok: false, message: `${capitalise(label)} : la valeur ne peut pas être négative.` };
  if (/^\d+\.\d{3,}$/.test(clean)) return { ok: false, message: `${capitalise(label)} : 2 décimales au maximum.` };
  if (!PLAIN_AMOUNT.test(clean)) return { ok: false, message: `${capitalise(label)} : saisissez un nombre simple, comme 1500 ou 1500.50.` };
  const value = Number(clean);
  if (!Number.isFinite(value)) return { ok: false, message: `${capitalise(label)} : ce n’est pas un nombre.` };
  if (!allowZero && value === 0) return { ok: false, message: `${capitalise(label)} : la valeur doit être supérieure à 0.` };
  if (value < min) return { ok: false, message: `${capitalise(label)} : la valeur doit être d’au moins ${min}.` };
  if (value > max) return { ok: false, message: `${capitalise(label)} : la valeur ne peut pas dépasser ${frNumber(max)}.` };
  return { ok: true, value: toPaise(value) / 100 };
};

const capitalise = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

export const parseVendorPrice = (text: string): ParsedNumber => parseAmount(text, { label: 'le prix du restaurant', max: MAX_DISH_PRICE, allowZero: false });

/** A commission value: PERCENT is 0-100, FLAT is an FCFA amount. */
export const parseCommissionValue = (type: CommissionType, text: string): ParsedNumber => (type === 'PERCENT'
  ? parseAmount(text, { label: 'le pourcentage de commission', max: 100 })
  : parseAmount(text, { label: 'la commission fixe', max: MAX_FLAT_COMMISSION }));

export const commissionLabel = (type: CommissionType | null | undefined, value: number | null | undefined): string => {
  if (!type || value === null || value === undefined) return 'Par défaut';
  return type === 'PERCENT' ? `${trimZeros(value)}%` : `${rupees(value)} fixe`;
};

const trimZeros = (value: number): string => String(Number(value.toFixed(2)));

/** Whole or decimal amount text for an input box (no currency symbol, no grouping). */
export const amountText = (value: number | null | undefined): string => (value === null || value === undefined || !Number.isFinite(value) ? '' : String(Number((Math.round(value * 100) / 100).toFixed(2))));

export const isHttpUrl = (text: string): boolean => {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
};

// ───────────────────────────── Settings groups ─────────────────────────────

export interface FeeLine { key: string; label: string; amount: number }

/** The server accepts only keys like `delivery_fee`: lower case, starts with a letter, up to 30 characters. */
export const LINE_KEY_RE = /^[a-z][a-z0-9_]{0,29}$/;

export interface FeesSettings {
  baseFee: number;
  lines: FeeLine[];
  extraRestaurantFee: number;
  freeFeeAbove: number;
  smallOrderBelow: number;
  smallOrderFee: number;
  gstOnFeesPercent: number;
  gstOnFoodPercent: number;
  /** Docs/22: most restaurants in one order, 1..5 (1 = multi-restaurant orders are off). */
  maxRestaurantsPerOrder: number;
}

/** What the fees form holds while the admin types: everything is text, lines carry a local row id. */
export interface FeesForm {
  baseFee: string;
  /** `key` is kept for lines that came from the server, so renaming the label does not change the key. */
  lines: Array<{ rowId: number; key?: string; label: string; amount: string }>;
  extraRestaurantFee: string;
  freeFeeAbove: string;
  smallOrderBelow: string;
  smallOrderFee: string;
  gstOnFeesPercent: string;
  gstOnFoodPercent: string;
  /** Whole number text, "1".."5". */
  maxRestaurantsPerOrder: string;
}

export type FeesErrors = Partial<Record<keyof Omit<FeesForm, 'lines'> | 'lines', string>> & { lineErrors?: Record<number, { label?: string; amount?: string }> };

const lineKey = (label: string, preferred: string | undefined, taken: Set<string>): string => {
  if (preferred && LINE_KEY_RE.test(preferred) && !taken.has(preferred)) { taken.add(preferred); return preferred; }
  let base = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'line';
  if (!/^[a-z]/.test(base)) base = `l_${base}`;
  base = base.slice(0, 26);
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}_${n++}`;
  taken.add(key);
  return key;
};

/** The server takes a whole number from 1 to 5 (backend services/pricing.ts validateFees); 3.5, "abc", 0 and 6 are refused. */
export const parseRestaurantsPerOrder = (text: string): ParsedNumber => {
  const clean = text.trim();
  const range = `un nombre entier de ${MIN_RESTAURANTS_PER_ORDER} à ${MAX_RESTAURANTS_PER_ORDER} (1 désactive les commandes multi-restaurants)`;
  if (!/^\d{1,3}$/.test(clean)) return { ok: false, message: `Le nombre maximum de restaurants par commande doit être ${range}.` };
  const value = Number(clean);
  if (value < MIN_RESTAURANTS_PER_ORDER || value > MAX_RESTAURANTS_PER_ORDER) return { ok: false, message: `Le nombre maximum de restaurants par commande doit être ${range}.` };
  return { ok: true, value };
};

export interface ValidatedFees { ok: boolean; errors: FeesErrors; value?: FeesSettings; lineTotal: number }

/** Validates the fees form; `value` is set only when every field is fine and the named lines add up to the all-in fee. */
export const validateFees = (form: FeesForm): ValidatedFees => {
  const errors: FeesErrors = {};
  const num = (field: keyof Omit<FeesForm, 'lines'>, label: string, max: number): number | null => {
    const parsed = parseAmount(String(form[field]), { label, max });
    if (!parsed.ok) { errors[field] = parsed.message; return null; }
    return parsed.value;
  };
  const baseFee = num('baseFee', 'les frais tout compris', MAX_FEE);
  const extraRestaurantFee = num('extraRestaurantFee', 'les frais par restaurant supplémentaire', MAX_EXTRA_RESTAURANT_FEE);
  const maxRestaurants = parseRestaurantsPerOrder(String(form.maxRestaurantsPerOrder));
  if (!maxRestaurants.ok) errors.maxRestaurantsPerOrder = maxRestaurants.message;
  const freeFeeAbove = num('freeFeeAbove', 'le montant de livraison gratuite (0 = désactivé)', MAX_THRESHOLD);
  const smallOrderBelow = num('smallOrderBelow', 'le seuil de petite commande (0 = désactivé)', MAX_THRESHOLD);
  const smallOrderFee = num('smallOrderFee', 'les frais de petite commande', MAX_FEE);
  const gstOnFeesPercent = num('gstOnFeesPercent', 'le pourcentage de TVA sur les frais', 100);
  const gstOnFoodPercent = num('gstOnFoodPercent', 'le pourcentage de TVA sur les plats', 100);

  const lineErrors: Record<number, { label?: string; amount?: string }> = {};
  if (form.lines.length > 10) errors.lines = '10 lignes au maximum.';
  const lines: FeeLine[] = [];
  const taken = new Set<string>();
  let lineTotalPaise = 0;
  for (const row of form.lines) {
    const rowErrors: { label?: string; amount?: string } = {};
    if (row.label.trim().length < 2) rowErrors.label = 'Donnez un nom à cette ligne.';
    else if (row.label.trim().length > 40) rowErrors.label = 'Le nom doit faire moins de 40 caractères.';
    const amount = parseAmount(row.amount, { label: 'le montant de la ligne', max: MAX_FEE });
    if (!amount.ok) rowErrors.amount = amount.message;
    if (rowErrors.label || rowErrors.amount) lineErrors[row.rowId] = rowErrors;
    if (amount.ok) lineTotalPaise += toPaise(amount.value);
    if (!rowErrors.label && amount.ok) lines.push({ key: lineKey(row.label, row.key, taken), label: row.label.trim(), amount: amount.value });
  }
  if (Object.keys(lineErrors).length > 0) errors.lineErrors = lineErrors;
  if (form.lines.length > 0 && baseFee !== null && lineTotalPaise !== toPaise(baseFee) && Object.keys(lineErrors).length === 0) {
    errors.lines = `Le total des lignes est de ${rupees(lineTotalPaise / 100)} mais les frais tout compris sont de ${rupees(baseFee)}. Les deux doivent être égaux.`;
  }
  const lineTotal = lineTotalPaise / 100;
  const ok = Object.keys(errors).length === 0;
  if (!ok) return { ok, errors, lineTotal };
  return {
    ok,
    errors,
    lineTotal,
    value: {
      baseFee: baseFee as number, lines, extraRestaurantFee: extraRestaurantFee as number, freeFeeAbove: freeFeeAbove as number,
      smallOrderBelow: smallOrderBelow as number, smallOrderFee: smallOrderFee as number,
      gstOnFeesPercent: gstOnFeesPercent as number, gstOnFoodPercent: gstOnFoodPercent as number,
      maxRestaurantsPerOrder: (maxRestaurants as { ok: true; value: number }).value,
    },
  };
};

export interface CommissionSettings { type: CommissionType; value: number }

export const validateCommissionSetting = (type: CommissionType, text: string): { ok: true; value: CommissionSettings } | { ok: false; message: string } => {
  const parsed = parseCommissionValue(type, text);
  return parsed.ok ? { ok: true, value: { type, value: parsed.value } } : { ok: false, message: parsed.message };
};

export const isRoundingStep = (value: unknown): value is RoundingStep => value === 0 || value === 1 || value === 5;
