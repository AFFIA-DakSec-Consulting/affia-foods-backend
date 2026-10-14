import { AppError } from './appError';
import { addLocalDays, isLocalDateString, localDateString, localDayStartOf } from './time';

export type LocalRange = {
  /** First and last local day, inclusive, `YYYY-MM-DD`. */
  from: string;
  to: string;
  /** The same window as instants: [start, end). `end` is the start of the day after `to`. */
  start: Date;
  end: Date;
  days: number;
};

/**
 * `from` / `to` query parameters as Africa/Dakar calendar days (`YYYY-MM-DD`, both inclusive). Defaults to the last `defaultDays`
 * days ending today; refuses a malformed date, a reversed range and a range longer than `maxDays`.
 */
export const parseLocalRange = (fromRaw: unknown, toRaw: unknown, opts: { defaultDays: number; maxDays: number; now?: Date }): LocalRange => {
  const one = (v: unknown, field: string): string | undefined => {
    if (v === undefined || v === '') return undefined;
    if (typeof v !== 'string' || !isLocalDateString(v)) throw new AppError(400, 'BAD_REQUEST', `${field} must be a date written YYYY-MM-DD.`, field);
    return v;
  };
  const toD = one(toRaw, 'to') ?? localDateString(opts.now ?? new Date());
  const fromD = one(fromRaw, 'from') ?? addLocalDays(toD, -(opts.defaultDays - 1));
  if (fromD > toD) throw new AppError(400, 'BAD_REQUEST', 'from cannot be after to.', 'from');
  const start = localDayStartOf(fromD);
  const end = localDayStartOf(addLocalDays(toD, 1));
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (days > opts.maxDays) throw new AppError(400, 'BAD_REQUEST', `The date range cannot be longer than ${opts.maxDays} days.`, 'from');
  return { from: fromD, to: toD, start, end, days };
};

/** 1-based page and bounded page size from query strings. */
export const parsePaging = (pageRaw: unknown, sizeRaw: unknown, defaults = { size: 25, max: 100 }): { page: number; pageSize: number } => {
  const num = (v: unknown): number | undefined => (typeof v === 'string' && /^\d{1,6}$/.test(v) ? Number.parseInt(v, 10) : undefined);
  const pageSize = Math.min(Math.max(num(sizeRaw) ?? defaults.size, 1), defaults.max);
  const page = Math.min(Math.max(num(pageRaw) ?? 1, 1), 100_000);
  return { page, pageSize };
};
