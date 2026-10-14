// Numbers for the restaurant dashboard (no React). A restaurant sees ONLY what it earns: never the customer price,
// the fees or the commission (Docs/21). Days are Thiès days (Africa/Dakar, UTC+0).
import { Order, Vendor } from '../types';
import { dakarDay } from './homeStats';
import { vendorHasRealPin } from './campus';
import { isTerminal } from './orders';

/** A restaurant only receives paid orders (contract 1.2): unpaid ones are waiting on the customer. */
export const restaurantOrders = (orders: Order[], vendorId: string): Order[] =>
  orders.filter((o) => o.vendorId === vendorId && o.paymentStatus === 'PAID');

export interface RestaurantBoard {
  /** Paid, waiting for the restaurant to accept. */
  fresh: Order[];
  /** Accepted, or being cooked. */
  cooking: Order[];
  /** Ready, waiting for the rider (or already on the way, until delivered). */
  ready: Order[];
}

export const boardOf = (orders: Order[]): RestaurantBoard => ({
  fresh: orders.filter((o) => o.status === 'PLACED').sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
  cooking: orders.filter((o) => o.status === 'ACCEPTED' || o.status === 'PREPARING').sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
  ready: orders.filter((o) => o.status === 'READY_FOR_PICKUP').sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
});

export interface DayFigures { orders: number; sales: number; average: number | null; knownSales: boolean }

/** Orders placed on a given day (cancelled ones left out) and what the restaurant earns on them. */
export const dayFigures = (orders: Order[], day: string): DayFigures => {
  const todays = orders.filter((o) => o.status !== 'CANCELLED' && dakarDay(o.createdAt) === day);
  const withMoney = todays.filter((o) => typeof o.vendorSubtotal === 'number');
  const sales = withMoney.reduce((sum, o) => sum + (o.vendorSubtotal as number), 0);
  return { orders: todays.length, sales, average: withMoney.length ? Math.round(sales / withMoney.length) : null, knownSales: todays.length === 0 || withMoney.length === todays.length };
};

/** Hourly sales of one day: 24 buckets (Thiès hour), in what the restaurant earns. */
export const hourlySales = (orders: Order[], day: string): number[] => {
  const buckets = Array.from({ length: 24 }, () => 0);
  for (const o of orders) {
    if (o.status === 'CANCELLED' || dakarDay(o.createdAt) !== day) continue;
    buckets[new Date(o.createdAt).getUTCHours()] += typeof o.vendorSubtotal === 'number' ? o.vendorSubtotal : 0;
  }
  return buckets;
};

/** Dishes ordered the most on a day, by quantity. */
export const topDishes = (orders: Order[], day: string, limit = 5): Array<{ name: string; quantity: number }> => {
  const totals = new Map<string, number>();
  for (const o of orders) {
    if (o.status === 'CANCELLED' || dakarDay(o.createdAt) !== day) continue;
    for (const item of o.items ?? []) totals.set(item.name, (totals.get(item.name) ?? 0) + item.quantity);
  }
  return Array.from(totals, ([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'fr')).slice(0, limit);
};

export interface ProfileStep { key: string; label: string; done: boolean; tab: 'r-profile' | 'r-hours' }

/** What is left to fill in on the restaurant's page, as a checklist with a percentage. */
export const profileProgress = (v: Vendor): { steps: ProfileStep[]; percent: number } => {
  const steps: ProfileStep[] = [
    { key: 'logo', label: 'Ajouter un logo', done: Boolean(v.logoUrl), tab: 'r-profile' },
    { key: 'description', label: 'Écrire une description', done: Boolean(v.description?.trim()), tab: 'r-profile' },
    { key: 'phone', label: 'Indiquer un téléphone', done: Boolean(v.phone), tab: 'r-profile' },
    { key: 'hours', label: 'Définir les horaires', done: Boolean(v.openingHours && Object.keys(v.openingHours).length > 0), tab: 'r-hours' },
    { key: 'pin', label: 'Placer le restaurant sur la carte', done: vendorHasRealPin(v), tab: 'r-profile' },
  ];
  return { steps, percent: Math.round((steps.filter((s) => s.done).length / steps.length) * 100) };
};

/** Whole minutes since a moment, never negative. */
export const minutesSince = (iso: string | null | undefined, now: number): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60_000)) : 0;
};

/** A wait in words people read at a glance: "À l'instant", "12 min", "3 h 20", "2 j". */
export const waitLabel = (minutes: number): string => {
  if (minutes < 1) return 'À l’instant';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 24 * 60) { const h = Math.floor(minutes / 60); const m = minutes % 60; return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`; }
  return `${Math.floor(minutes / (24 * 60))} j`;
};

export const activeCount = (orders: Order[]): number => orders.filter((o) => !isTerminal(o.status)).length;

/** First name only: a restaurant never sees the customer's full name. */
export const firstName = (full: string): string => full.trim().split(/\s+/)[0] || 'Client';
