/**
 * Local time. Kraveo runs in Senegal (Africa/Dakar = GMT, UTC+00:00, no daylight saving), but the server may run in any time
 * zone, so anything a human reads as "today" or "14:00" is computed with this fixed offset instead of the server's zone.
 * To move the product to another country change this one number (milliseconds ahead of UTC).
 */
export const LOCAL_OFFSET_MS = 0;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The instant at which the Africa/Dakar calendar day containing `d` started. */
export const startOfLocalDay = (d: Date): Date => new Date(Math.floor((d.getTime() + LOCAL_OFFSET_MS) / DAY_MS) * DAY_MS - LOCAL_OFFSET_MS);

/** The hour of day (0-23) on the Africa/Dakar clock. */
export const localHour = (d: Date): number => new Date(d.getTime() + LOCAL_OFFSET_MS).getUTCHours();

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `YYYY-MM-DD` on the Africa/Dakar calendar for the instant `d`. */
export const localDateString = (d: Date): string => new Date(d.getTime() + LOCAL_OFFSET_MS).toISOString().slice(0, 10);

/** True for a real calendar date written as `YYYY-MM-DD` (2026-02-30 is not). */
export const isLocalDateString = (s: unknown): s is string => {
  if (typeof s !== 'string') return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), da = Number(m[3]);
  if (y < 2000 || y > 2100) return false;
  const t = new Date(Date.UTC(y, mo - 1, da));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === da;
};

/** The instant at which the local calendar day `YYYY-MM-DD` starts (00:00 local). Call isLocalDateString first. */
export const localDayStartOf = (date: string): Date => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - LOCAL_OFFSET_MS);
};

/** The instant of `HH:MM` local on the local day `YYYY-MM-DD`. */
export const localInstant = (date: string, hhmm: string): Date => {
  const [h, mi] = hhmm.split(':').map(Number);
  return new Date(localDayStartOf(date).getTime() + (h * 60 + mi) * 60_000);
};

/** `date` plus `days` calendar days, as `YYYY-MM-DD` (pure calendar arithmetic, no daylight saving in Senegal). */
export const addLocalDays = (date: string, days: number): string => localDateString(new Date(localDayStartOf(date).getTime() + days * 86_400_000 + 12 * 3_600_000));
