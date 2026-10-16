/** Tiny strict input readers for the back-office bodies: unknown keys, wrong types and out-of-range values are refused with a 400 naming the field. */
import { AppError } from '../../utils/appError';

export const bad = (field: string, message: string) => new AppError(400, 'BAD_REQUEST', message, field);
export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const onlyKeys = (o: Record<string, unknown>, allowed: readonly string[]) => {
  const extra = Object.keys(o).find((k) => !allowed.includes(k));
  if (extra) throw bad(extra.slice(0, 40), `Unknown field '${extra.slice(0, 40)}'.`);
};
export const str = (o: Record<string, unknown>, k: string, min: number, max: number): string => {
  const v = o[k];
  if (typeof v !== 'string') throw bad(k, `${k} must be a text.`);
  const t = v.trim().replace(/\s+/g, ' ');
  if (t.length < min || t.length > max) throw bad(k, `${k} must be ${min}-${max} characters.`);
  if (/[\u0000-\u001f<>]/.test(t)) throw bad(k, `${k} contains forbidden characters.`);
  return t;
};
export const strOpt = (o: Record<string, unknown>, k: string, max: number): string | null => (o[k] === undefined || o[k] === null ? null : str(o, k, 1, max));
export const int = (o: Record<string, unknown>, k: string, min: number, max: number): number => {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw bad(k, `${k} must be a whole number from ${min} to ${max}.`);
  return v;
};
export const intOpt = (o: Record<string, unknown>, k: string, min: number, max: number): number | null => (o[k] === undefined || o[k] === null ? null : int(o, k, min, max));
export const num = (o: Record<string, unknown>, k: string, min: number, max: number): number => {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || Math.abs(v * 100 - Math.round(v * 100)) > 1e-6) throw bad(k, `${k} must be a number from ${min} to ${max} (at most 2 decimals).`);
  return v;
};
export const numOpt = (o: Record<string, unknown>, k: string, min: number, max: number): number | null => (o[k] === undefined || o[k] === null ? null : num(o, k, min, max));
export const bool = (o: Record<string, unknown>, k: string): boolean => {
  if (typeof o[k] !== 'boolean') throw bad(k, `${k} must be true or false.`);
  return o[k] as boolean;
};
export const oneOf = <T extends string>(o: Record<string, unknown>, k: string, allowed: readonly T[]): T => {
  const v = o[k];
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw bad(k, `${k} must be one of: ${allowed.join(', ')}.`);
  return v as T;
};
export const dateOpt = (o: Record<string, unknown>, k: string): Date | null => {
  const v = o[k];
  if (v === undefined || v === null) return null;
  const d = typeof v === 'string' ? new Date(v) : null;
  if (!d || !Number.isFinite(d.getTime()) || d.getUTCFullYear() < 2020 || d.getUTCFullYear() > 2100) throw bad(k, `${k} must be an ISO 8601 date.`);
  return d;
};
export const idList = (o: Record<string, unknown>, k: string, max: number): string[] => {
  const v = o[k];
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== 'string' || !/^[A-Za-z0-9 _'-]{1,64}$/.test(x))) throw bad(k, `${k} must be a list of at most ${max} short identifiers.`);
  return [...new Set(v as string[])];
};
export const pageOf = (q: { page?: unknown; pageSize?: unknown }) => {
  const p = Number.parseInt(String(q.page ?? '1'), 10);
  const s = Number.parseInt(String(q.pageSize ?? '50'), 10);
  return { page: Number.isFinite(p) && p >= 1 && p <= 10_000 ? p : 1, pageSize: Number.isFinite(s) && s >= 1 && s <= 200 ? s : 50 };
};
