import { describe, expect, it } from 'vitest';
import { boardOf, dayFigures, firstName, hourlySales, minutesSince, profileProgress, restaurantOrders, topDishes, waitLabel } from './restaurantStats';
import type { Order, Vendor } from '../types';

const NOW = Date.parse('2026-10-14T13:30:00Z');
const order = (id: string, over: Partial<Order> = {}): Order => ({
  id, vendorId: 'v1', vendorName: 'Chez Awa', customerName: 'Ibrahima Ndiaye', items: [{ name: 'Thiéboudienne', quantity: 2, price: 3000 }], itemsCount: 2, totalAmount: 7000, deliveryFee: 500,
  dropoffHostel: 'Escale', status: 'PLACED', paymentStatus: 'PAID', createdAt: '2026-10-14T12:00:00Z', vendorSubtotal: 5000, ...over,
} as Order);

describe('restaurant dashboard figures', () => {
  it('only the restaurant\'s own paid orders reach it', () => {
    const list = [order('a'), order('b', { vendorId: 'v2' }), order('c', { paymentStatus: 'PENDING' })];
    expect(restaurantOrders(list, 'v1').map((o) => o.id)).toEqual(['a']);
  });

  it('puts each order in the right column, oldest first', () => {
    const board = boardOf([order('new2', { createdAt: '2026-10-14T12:10:00Z' }), order('new1'), order('cook', { status: 'PREPARING' }), order('acc', { status: 'ACCEPTED' }), order('rdy', { status: 'READY_FOR_PICKUP' }), order('way', { status: 'PICKED_UP' })]);
    expect(board.fresh.map((o) => o.id)).toEqual(['new1', 'new2']);
    expect(board.cooking.map((o) => o.id).sort()).toEqual(['acc', 'cook']);
    expect(board.ready.map((o) => o.id)).toEqual(['rdy']);
  });

  it('counts the day in what the restaurant earns, leaving cancelled orders out', () => {
    const f = dayFigures([order('a'), order('b', { vendorSubtotal: 3000 }), order('c', { status: 'CANCELLED' }), order('old', { createdAt: '2026-10-13T12:00:00Z' })], '2026-10-14');
    expect(f).toEqual({ orders: 2, sales: 8000, average: 4000, knownSales: true });
  });

  it('says when the money is unknown (older server) instead of inventing it', () => {
    const f = dayFigures([order('a', { vendorSubtotal: undefined })], '2026-10-14');
    expect(f.knownSales).toBe(false);
    expect(f.average).toBeNull();
  });

  it('sales by hour and favourite dishes', () => {
    const list = [order('a'), order('b', { createdAt: '2026-10-14T13:05:00Z', items: [{ name: 'Yassa', quantity: 3, price: 2500 }], vendorSubtotal: 7500 })];
    const hours = hourlySales(list, '2026-10-14');
    expect(hours[12]).toBe(5000);
    expect(hours[13]).toBe(7500);
    expect(topDishes(list, '2026-10-14')).toEqual([{ name: 'Yassa', quantity: 3 }, { name: 'Thiéboudienne', quantity: 2 }]);
  });

  it('profile checklist and percentage', () => {
    const v = { id: 'v1', name: 'x', category: 'x', rating: 0, isAcceptingOrders: true, address: 'x', activeOrdersCount: 0, logoUrl: 'https://x/l.png', description: 'Bon', phone: null, openingHours: null, hasLocation: true, lat: 14.79, lng: -16.93 } as Vendor;
    const p = profileProgress(v);
    expect(p.percent).toBe(60);
    expect(p.steps.filter((s) => !s.done).map((s) => s.key)).toEqual(['phone', 'hours']);
  });

  it('minutes and first names', () => {
    expect(minutesSince('2026-10-14T13:10:30Z', NOW)).toBe(19);
    expect(minutesSince(undefined, NOW)).toBe(0);
    expect(firstName('Ibrahima Ndiaye')).toBe('Ibrahima');
  });

  it('writes a wait the way people read it', () => {
    expect([0, 12, 59, 60, 200, 1439, 3273].map(waitLabel)).toEqual(['À l’instant', '12 min', '59 min', '1 h', '3 h 20', '23 h 59', '2 j']);
  });
});
