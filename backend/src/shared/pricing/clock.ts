import { LOCAL_OFFSET_MS } from '../../utils/time';
import type { RushWindow } from './types';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
export const isHHMM = (v: unknown): v is string => typeof v === 'string' && HHMM.test(v);
const toMin = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Minutes since local midnight (Dakar) of an instant. */
export const localMinutes = (d: Date): number => {
  const l = new Date(d.getTime() + LOCAL_OFFSET_MS);
  return l.getUTCHours() * 60 + l.getUTCMinutes();
};

/** True when `now` is inside [from, to). A window that crosses midnight (22:00 -> 06:00) is supported. from == to means the whole day. */
export const inWindow = (now: Date, w: RushWindow): boolean => {
  if (!isHHMM(w.from) || !isHHMM(w.to)) return false;
  const m = localMinutes(now);
  const a = toMin(w.from);
  const b = toMin(w.to);
  if (a === b) return true;
  return a < b ? m >= a && m < b : m >= a || m < b;
};
