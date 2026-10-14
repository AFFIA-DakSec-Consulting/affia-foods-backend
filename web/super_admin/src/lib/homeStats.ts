// Numbers for the dashboard home (no React). Days are counted in Thiès time (Africa/Dakar, UTC+0, no DST).
import { Order } from '../types';

const DAY_MS = 86_400_000;

export const dakarDay = (value: string | number | Date | null | undefined): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
};

export interface DaySummary { orders: number; revenue: number }
export interface HomeStats {
  today: DaySummary;
  yesterday: DaySummary;
  /** Last 7 days, oldest first, today last. */
  week: Array<{ day: string; orders: number; revenue: number }>;
}

/** Orders placed that day (cancelled ones excluded) and the paid amount of those orders. */
export const homeStats = (orders: Order[], now: number): HomeStats => {
  const days = Array.from({ length: 7 }, (_, i) => dakarDay(now - (6 - i) * DAY_MS) as string);
  const byDay = new Map(days.map((day): [string, { day: string; orders: number; revenue: number }] => [day, { day, orders: 0, revenue: 0 }]));
  for (const order of orders) {
    if (order.status === 'CANCELLED') continue;
    const bucket = byDay.get(dakarDay(order.createdAt) ?? '');
    if (!bucket) continue;
    bucket.orders += 1;
    if (order.paymentStatus === 'PAID') bucket.revenue += order.totalAmount;
  }
  const week = days.map((day) => byDay.get(day)!);
  return { today: week[6], yesterday: week[5], week };
};

/** Percentage change vs a previous value; null when there is nothing to compare with. */
export const changePercent = (current: number, previous: number): number | null => (previous > 0 ? Math.round(((current - previous) / previous) * 100) : null);

export const greeting = (now: number): string => {
  const hour = new Date(now).getUTCHours(); // Thiès is UTC+0
  return hour < 5 || hour >= 18 ? 'Bonsoir' : 'Bonjour';
};
