import { describe, expect, it } from 'vitest';
import { activeClientsOf, oldestWaitDays, partnerFigures, restaurantFigures, riderFigures, share } from './platformStats';
import type { DriverPartner, Vendor } from '../types';

const vendor = (over: Partial<Vendor> = {}): Vendor => ({ id: 'v', name: 'V', category: 'c', rating: 0, isAcceptingOrders: false, address: 'a', activeOrdersCount: 0, approvalStatus: 'APPROVED', ...over });
const rider = (over: Partial<DriverPartner> = {}): DriverPartner => ({ id: 'r', name: 'R', phone: '', studentRegNo: '', runnerCode: '', vehicleType: '', vehicleRegNo: '', emergencyPhone: '', dutyStatus: 'OFFLINE', ordersToday: 0, totalEarningsToday: 0, avgCompletionTimeMinutes: 0, onTimeRatePercent: 0, rating: 0, createdAt: '', approvalStatus: 'APPROVED', ...over });

describe('partnerFigures', () => {
  it('counts every decision for restaurants and riders, and both together', () => {
    const f = partnerFigures(
      [vendor({ approvalStatus: 'PENDING' }), vendor({ approvalStatus: 'APPROVED' }), vendor({ approvalStatus: 'REJECTED' })],
      [rider({ approvalStatus: 'PENDING' }), rider({ approvalStatus: 'PENDING' }), rider({ approvalStatus: 'SUSPENDED' })],
    );
    expect(f.restaurants).toEqual({ PENDING: 1, APPROVED: 1, REJECTED: 1, SUSPENDED: 0 });
    expect(f.riders).toEqual({ PENDING: 2, APPROVED: 0, REJECTED: 0, SUSPENDED: 1 });
    expect(f.all.PENDING).toBe(3);
    expect(f.registered).toBe(6);
  });
  it('treats a row without a status as approved (created by the team)', () => {
    expect(partnerFigures([vendor({ approvalStatus: undefined })], []).restaurants.APPROVED).toBe(1);
  });
});

describe('restaurantFigures', () => {
  it('splits approved restaurants into open and closed and ignores the ones still waiting', () => {
    const f = restaurantFigures([vendor({ isAcceptingOrders: true }), vendor(), vendor({ approvalStatus: 'PENDING', isAcceptingOrders: true })]);
    expect(f).toMatchObject({ approved: 2, open: 1, closed: 1 });
  });
  it('counts sheets that are not complete and restaurants without a real pin', () => {
    const f = restaurantFigures([vendor()]);
    expect(f.incompleteSheet).toBe(1);
    expect(f.withoutPin).toBe(1);
  });
});

describe('riderFigures', () => {
  it('splits approved riders by duty', () => {
    const f = riderFigures([rider({ dutyStatus: 'ONLINE' }), rider({ dutyStatus: 'IN_TRANSIT' }), rider(), rider({ approvalStatus: 'PENDING', dutyStatus: 'ONLINE' })]);
    expect(f).toEqual({ approved: 3, online: 1, inTransit: 1, offline: 1 });
  });
});

describe('helpers', () => {
  it('reads active clients under either name', () => {
    expect(activeClientsOf({ activeClients: 12, activeStudents: 0 })).toBe(12);
    expect(activeClientsOf({ activeStudents: 7 })).toBe(7);
  });
  it('gives the oldest wait only when the list is complete', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    const list = [{ appliedAt: '2026-10-12T12:00:00Z' }, { appliedAt: '2026-10-14T12:00:00Z' }];
    expect(oldestWaitDays(list, 2, now)).toBe(3);
    expect(oldestWaitDays(list, 500, now)).toBeNull();
    expect(oldestWaitDays([], 0, now)).toBeNull();
  });
  it('shares', () => { expect(share(1, 4)).toBe(25); expect(share(1, 0)).toBe(0); });
});
