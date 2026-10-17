// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { PlatformOverview } from './PlatformOverview';
import { ApiError, apiService } from '../services/api';
import { byText, click, flush, mount, unmount } from '../test/dom';
import type { DriverPartner, Vendor } from '../types';

afterEach(async () => { vi.restoreAllMocks(); await unmount(); });

const vendor = (over: Partial<Vendor> = {}): Vendor => ({ id: 'v', name: 'V', category: 'c', rating: 0, isAcceptingOrders: false, address: 'a', activeOrdersCount: 0, approvalStatus: 'APPROVED', ...over });
const rider = (over: Partial<DriverPartner> = {}): DriverPartner => ({ id: 'r', name: 'R', phone: '', studentRegNo: '', runnerCode: '', vehicleType: '', vehicleRegNo: '', emergencyPhone: '', dutyStatus: 'OFFLINE', ordersToday: 0, totalEarningsToday: 0, avgCompletionTimeMinutes: 0, onTimeRatePercent: 0, rating: 0, createdAt: '', approvalStatus: 'APPROVED', ...over });
const analytics: any = { range: { from: '', to: '' }, grossOrderVolume: 125000, orderCount: 48, averageDeliveryMinutes: 27.5, activeStudents: 0, activeClients: 31, cancellationRate: 6.3, hourlyOrders: [], hostelOrders: [], generatedAt: '' };
const summary: any = { range: { from: '2026-10-09', to: '2026-10-15', days: 7 }, orders: 40, foodGross: 100000, vendorAmount: 80000, commission: 20000, feesCollected: 9000, discounts: 0, platformRevenue: 29000, customerPaid: 120000, refunds: { count: 2, amount: 6000 }, settledAmount: 50000, unsettledAmount: 30000, paidOutAmount: 40000 };

const mockApi = () => {
  vi.spyOn(apiService, 'fetchApplications').mockResolvedValue({ counts: { PENDING: 3, APPROVED: 5, REJECTED: 1, SUSPENDED: 0 }, data: [] });
  vi.spyOn(apiService, 'fetchCustomers').mockResolvedValue({ total: 812, nextCursor: null, data: [] });
  vi.spyOn(apiService, 'fetchAnalytics').mockResolvedValue(analytics);
  vi.spyOn(apiService, 'fetchFinanceSummary').mockResolvedValue(summary);
};
const baseProps = { dishesToApprove: 2, settlementsToPay: 1, alerts: 0, onNavigate: () => {} };

describe('PlatformOverview', () => {
  it('shows registrations by decision for restaurants and riders, from the complete lists', async () => {
    mockApi();
    const h = await mount(<PlatformOverview {...baseProps} vendors={[vendor({ approvalStatus: 'PENDING' }), vendor(), vendor({ approvalStatus: 'REJECTED' })]} driverPartners={[rider({ approvalStatus: 'PENDING' }), rider({ approvalStatus: 'PENDING' })]} />);
    await flush();
    const section = h.querySelector('section[aria-label="Inscriptions"]')!;
    expect(section.textContent).toContain('Inscrits au total');
    const rows = Array.from(section.querySelectorAll('tbody tr')).map((tr) => tr.textContent);
    expect(rows[0]).toContain('Restaurants');
    expect(rows[1]).toContain('Livreurs');
    // restaurants: 1 pending, 1 approved, 1 refused, 0 suspended, 3 in total ; riders: 2 pending, 2 in total
    expect(Array.from(section.querySelectorAll('tbody tr')[0].querySelectorAll('td')).map((td) => td.textContent)).toEqual(['1', '1', '1', '0', '3']);
    expect(Array.from(section.querySelectorAll('tbody tr')[1].querySelectorAll('td')).map((td) => td.textContent)).toEqual(['2', '0', '0', '0', '2']);
  });

  it('shows the totals the server computed (all orders, all customers), not a count of loaded orders', async () => {
    mockApi();
    const h = await mount(<PlatformOverview {...baseProps} vendors={[]} driverPartners={[]} />);
    await flush();
    expect(h.textContent).toContain('48');           // orders of the period
    expect(h.textContent).toContain('6.3 %');         // cancellations
    expect(h.textContent).toContain('27.5 min');
    expect(h.textContent).toContain('812');           // customers registered, server total
    expect(h.textContent).toContain('31');            // active clients (the server calls the field activeClients)
    expect(h.textContent).toContain('29 000 FCFA');   // platform revenue
  });

  it('asks the server again, with the new period, when a period is chosen', async () => {
    mockApi();
    const analyticsCall = vi.spyOn(apiService, 'fetchAnalytics').mockResolvedValue(analytics);
    const h = await mount(<PlatformOverview {...baseProps} vendors={[]} driverPartners={[]} />);
    await flush();
    expect(analyticsCall).toHaveBeenLastCalledWith('7d');
    await click(byText('button', 'Aujourd’hui', h)!);
    await flush();
    expect(analyticsCall).toHaveBeenLastCalledWith('today');
  });

  it('shows an error with a retry for the block that failed, never an invented zero', async () => {
    mockApi();
    vi.spyOn(apiService, 'fetchAnalytics').mockRejectedValue(new ApiError(500, 'Erreur serveur'));
    const h = await mount(<PlatformOverview {...baseProps} vendors={[]} driverPartners={[]} />);
    await flush();
    const orders = h.querySelector('section[aria-label^="Commandes"]')!;
    expect(orders.textContent).toContain('Erreur serveur');
    expect(byText('button', 'Réessayer', orders)).toBeTruthy();
    expect(h.querySelector('section[aria-label^="Argent"]')!.textContent).toContain('29 000 FCFA'); // the other blocks are unaffected
  });

  it('lists what waits for a decision and leads to the right screen', async () => {
    mockApi();
    const onNavigate = vi.fn();
    const h = await mount(<PlatformOverview {...baseProps} onNavigate={onNavigate} alerts={4} vendors={[vendor({ approvalStatus: 'PENDING' })]} driverPartners={[]} />);
    await flush();
    const todo = h.querySelector('section[aria-label="À traiter par l’équipe"]')!;
    expect(todo.textContent).toContain('inscription(s) à valider');
    expect(todo.textContent).toContain('alerte(s)');
    await click(byText('button', /plat\(s\) à approuver/, todo)!);
    expect(onNavigate).toHaveBeenCalledWith('catalog');
  });
});
