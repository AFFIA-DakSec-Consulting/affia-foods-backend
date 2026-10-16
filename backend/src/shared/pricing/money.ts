/**
 * Money helpers of the modular pricing engines (KRAVEO_SPEC_MODULES.md 15.7): whole FCFA integers only, ONE rounding helper.
 * Nothing here knows about modules, settings or the database.
 */
import { largestRemainderSplit } from '../../services/pricing';

/** Largest amount any single money value of the engines may reach (a guard against a runaway setting, not a business rule). */
export const MAX_MONEY = 100_000_000;

/** Integer FCFA, never negative, never above MAX_MONEY. Throws on NaN/Infinity (a bug, never user input: inputs are validated first). */
export const money = (n: number): number => {
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new RangeError(`Not a money amount: ${String(n)}`);
  return Math.min(MAX_MONEY, Math.max(0, Math.round(n)));
};

/** Rounds to the nearest multiple of `step` (step <= 1 = whole FCFA). */
export const roundToMultiple = (n: number, step: number): number => {
  const s = Number.isFinite(step) && step > 1 ? Math.round(step) : 1;
  return money(Math.round(n / s) * s);
};

export const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Splits a whole-FCFA total over weights with the largest-remainder method: the parts add up to the total EXACTLY. Ties: lowest index. */
export const splitProportional = (total: number, weights: number[]): number[] => {
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? Math.round(x * 1000) : 0));
  return largestRemainderSplit(money(total), w);
};
