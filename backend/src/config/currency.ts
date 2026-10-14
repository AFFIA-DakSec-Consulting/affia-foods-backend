/**
 * Money for Senegal: the franc CFA (XOF, shown "FCFA"). It has NO minor unit: 1 FCFA is the smallest amount.
 *
 * Internal scale (kept on purpose): every calculation still runs in integers at x100 (`toPaise` / `fromPaise` in
 * services/pricing.ts, the `amountPaise` / `amountInPaise` / `capturedAmountPaise` names, the `paise` columns of the
 * API). The names are historical: read "paise" as "1/100 of a FCFA". That keeps the exact-integer maths and the API
 * contract with the apps unchanged. What changed is the boundary: prices, fees, discounts and payouts are accepted
 * only as WHOLE FCFA (`isWholeAmount`), and everything is shown in FCFA (`fcfa`).
 *
 * Wiring a real XOF payment provider: its amounts are whole FCFA, so divide `amountPaise` by 100 in the provider
 * adapter (services/paymentService.ts) and nowhere else.
 */
export const CURRENCY_CODE = 'XOF';
export const CURRENCY_LABEL = 'FCFA';
/** Internal integer scale: 1 FCFA = 100 internal units. */
export const MINOR_PER_UNIT = 100;
/** Smallest payment the provider layer accepts, in FCFA. */
export const MIN_PAYMENT_FCFA = 100;

/** True for a finite, whole, non-negative-or-negative integer amount of FCFA (no centimes exist). */
export const isWholeAmount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n);

/** `1500` -> `1 500 FCFA` (plain spaces, no decimals). Amounts are rounded to the nearest FCFA for display. */
export const fcfa = (amount: number): string => {
  const rounded = Math.round(amount);
  const grouped = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${rounded < 0 ? '-' : ''}${grouped} ${CURRENCY_LABEL}`;
};

/** Internal units (x100) -> `1 500 FCFA`. */
export const fcfaFromMinor = (minor: number): string => fcfa(minor / MINOR_PER_UNIT);
