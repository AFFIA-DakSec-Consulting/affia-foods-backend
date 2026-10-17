// @vitest-environment jsdom
// App wiring for combined orders (Docs/22): opening a sibling from the drawer, cancelling the whole group (what the admin is told, list refresh),
// moving the whole group to another rider. API and socket are mocked; the fixtures are the real shapes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';

vi.mock('socket.io-client', () => ({ io: () => ({ on: vi.fn(), emit: vi.fn(), connect: vi.fn(), disconnect: vi.fn() }) }));
vi.mock('./components/CampusMap', () => ({ default: () => null }));

import { App } from './App';
import { ToastProvider } from './components/ui/Toast';
import { ApiError, apiService } from './services/api';
import { normalizeOrder } from './types';
import { parseGroupView } from './lib/groupView';
import { parseCancelOutcome } from './lib/orderGroups';
import { GROUP_ID, GROUP_ORDER_IDS, rawGroupCancel, rawGroupOrder, rawGroupView } from './test/fixtures';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const mount = async () => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<ToastProvider><App /></ToastProvider>); });
  return host;
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = (el: Element | null | undefined) => act(async () => { (el as HTMLElement).click(); });
const byText = (selector: string, text: string | RegExp, scope: ParentNode = document) =>
  Array.from(scope.querySelectorAll(selector)).find((el) => (typeof text === 'string' ? el.textContent?.trim() === text : text.test(el.textContent ?? ''))) as HTMLElement | undefined;
const code = (id: string) => `#${id.slice(-6).toUpperCase()}`;

const rider = { id: 'p1', userId: 'u1', name: 'Ravi', phone: '9', studentRegNo: '', runnerCode: 'R1', vehicleType: 'Bike', vehicleRegNo: 'MP', emergencyPhone: '', dutyStatus: 'ONLINE', ordersToday: 0, totalEarningsToday: 0, avgCompletionTimeMinutes: 0, onTimeRatePercent: 0, rating: 5, createdAt: new Date().toISOString(), approvalStatus: 'APPROVED' } as any;
const parts = () => [normalizeOrder(rawGroupOrder(0)), normalizeOrder(rawGroupOrder(1, { status: 'ACCEPTED' }))];

const mockApi = () => {
  vi.spyOn(apiService, 'validateSession').mockResolvedValue({ id: 'a1', name: 'Admin', phone: '1', role: 'ADMIN' } as any);
  const fetchOrderPage = vi.spyOn(apiService, 'fetchOrderPage').mockResolvedValue({ orders: parts(), nextCursor: null });
  vi.spyOn(apiService, 'fetchVendors').mockResolvedValue([]);
  vi.spyOn(apiService, 'fetchLiveCounts').mockResolvedValue({ inProgress: 0, awaitingRestaurant: 0, preparing: 0, readyForPickup: 0, onTheWay: 0, withoutRider: 0, stuck: 0, awaitingPayment: 0 });
  vi.spyOn(apiService, 'fetchDrivers').mockResolvedValue([rider]);
  vi.spyOn(apiService, 'fetchDriverLocations').mockResolvedValue([]);
  vi.spyOn(apiService, 'fetchNeedsAttention').mockResolvedValue({ available: true, entries: [] });
  vi.spyOn(apiService, 'fetchApplications').mockResolvedValue({ counts: { PENDING: 0, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 }, data: [] } as any);
  vi.spyOn(apiService, 'fetchCampus').mockResolvedValue(null);
  const fetchOrderGroup = vi.spyOn(apiService, 'fetchOrderGroup').mockResolvedValue(parseGroupView(rawGroupView())!);
  return { fetchOrderPage, fetchOrderGroup };
};

beforeEach(() => { localStorage.clear(); localStorage.setItem('kraveo_admin_token', 'stored-admin-token-123'); });
afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await act(async () => { root!.unmount(); });
  host?.remove();
  root = null; host = null;
  document.body.innerHTML = '';
  localStorage.clear();
});

const openFirst = async () => {
  const h = await mount();
  await flush();
  await click(h.querySelector(`button[aria-label="Ouvrir la commande ${code(GROUP_ORDER_IDS[0])}"]`));
  await flush();
  return h;
};

describe('combined orders in the app', () => {
  it('opening an order loads its group once; clicking a sibling opens that order in the same drawer', async () => {
    const api = mockApi();
    await openFirst();
    expect(api.fetchOrderGroup).toHaveBeenCalledTimes(1);
    expect(api.fetchOrderGroup.mock.calls[0][0]).toBe(GROUP_ID);
    expect(document.querySelector('[role="dialog"]')!.textContent).toContain(`Commande ${code(GROUP_ORDER_IDS[0])}`);
    await click(document.querySelector('[data-testid="group-panel"] button[aria-label^="Ouvrir la commande"]'));
    await flush();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain(`Commande ${code(GROUP_ORDER_IDS[1])}`);
    expect(dialog.querySelector('li[aria-current="true"]')!.textContent).toContain('Kitchen 2');
    expect(api.fetchOrderGroup).toHaveBeenCalledTimes(1); // same group: not loaded again
  });

  it('cancel: confirm dialog, then the server answer says how many orders were cancelled, and the list is reloaded so the other part shows as cancelled', async () => {
    const api = mockApi();
    const cancel = vi.spyOn(apiService, 'cancelOrderWithResult').mockResolvedValue({
      order: normalizeOrder(rawGroupCancel().data), outcome: parseCancelOutcome(rawGroupCancel()),
    });
    await openFirst();
    await click(byText('button', /Annuler toute la commande groupée/));
    const reason = document.getElementById('admin-cancel-reason') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(reason, 'Kitchen 2 is closed');
      reason.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const pagesBefore = api.fetchOrderPage.mock.calls.length;
    await click(document.querySelector('button[type="submit"][form="admin-cancel-form"]'));
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('Cela annule TOUTE la commande groupée (les 2 restaurants) et rembourse intégralement le client.');
    await click(byText('button', 'Annuler les 2 commandes', dialog));
    await flush();
    expect(cancel).toHaveBeenCalledWith(GROUP_ORDER_IDS[0], 'Kitchen 2 is closed');
    expect(document.body.textContent).toContain('Commande groupée annulée');
    expect(document.body.textContent).toContain('2 commandes annulées (toute la commande groupée). Le client est remboursé intégralement et automatiquement.');
    expect(api.fetchOrderPage.mock.calls.length).toBeGreaterThan(pagesBefore);
  });

  it('cancel of an already cancelled group: says nothing changed', async () => {
    mockApi();
    vi.spyOn(apiService, 'cancelOrderWithResult').mockResolvedValue({
      order: normalizeOrder(rawGroupCancel().data), outcome: parseCancelOutcome(rawGroupCancel({ cancelledOrders: 0, message: 'This order was already cancelled.' })),
    });
    await openFirst();
    await click(byText('button', /Annuler toute la commande groupée/));
    const reason = document.getElementById('admin-cancel-reason') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(reason, 'Again');
      reason.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(document.querySelector('button[type="submit"][form="admin-cancel-form"]'));
    await click(byText('button', 'Annuler les 2 commandes', document.querySelector('[role="alertdialog"]')!));
    await flush();
    expect(document.body.textContent).toContain('Déjà annulée');
    expect(document.body.textContent).toContain('rien n’a changé');
  });

  it('a cancel the server refuses shows its message in the form and does not claim success', async () => {
    mockApi();
    vi.spyOn(apiService, 'cancelOrderWithResult').mockRejectedValue(new ApiError(409, 'A delivered order cannot be cancelled.', 'ORDER_CLOSED'));
    await openFirst();
    await click(byText('button', /Annuler toute la commande groupée/));
    const reason = document.getElementById('admin-cancel-reason') as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(reason, 'Too late');
      reason.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(document.querySelector('button[type="submit"][form="admin-cancel-form"]'));
    await click(byText('button', 'Annuler les 2 commandes', document.querySelector('[role="alertdialog"]')!));
    await flush();
    expect(document.body.textContent).toContain('La commande n’a pas été annulée : A delivered order cannot be cancelled.');
    expect(document.body.textContent).not.toContain('Commande groupée annulée');
  });

  it('assigning a rider says it moves the whole group, and the list is reloaded', async () => {
    const api = mockApi();
    const reassign = vi.spyOn(apiService, 'reassignOrderDriver').mockResolvedValue(normalizeOrder(rawGroupOrder(0, { driverId: 'u1', driver: { id: 'u1', name: 'Ravi', phone: '9' } })));
    const h = await mount();
    await flush();
    const select = h.querySelector(`select[aria-label="Assigner le livreur de la commande ${code(GROUP_ORDER_IDS[0])}"]`) as HTMLSelectElement;
    expect(select).not.toBeNull();
    const pagesBefore = api.fetchOrderPage.mock.calls.length;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'p1');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(reassign).toHaveBeenCalledWith(GROUP_ORDER_IDS[0], 'p1', false);
    expect(document.body.textContent).toContain('Ravi prend en charge les 2 commandes de la commande groupée.');
    expect(api.fetchOrderPage.mock.calls.length).toBeGreaterThan(pagesBefore);
  });

  it('assigning an offline rider to a group asks first and the question says the whole group moves', async () => {
    mockApi();
    vi.spyOn(apiService, 'fetchDrivers').mockResolvedValue([{ ...rider, dutyStatus: 'OFFLINE' }]);
    const reassign = vi.spyOn(apiService, 'reassignOrderDriver');
    const h = await mount();
    await flush();
    const select = h.querySelector(`select[aria-label="Assigner le livreur de la commande ${code(GROUP_ORDER_IDS[0])}"]`) as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'p1');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('Ce livreur est hors ligne. L’assigner quand même ?');
    expect(dialog.textContent).toContain('les 2 commandes passent toutes à ce livreur');
    expect(reassign).not.toHaveBeenCalled();
  });
});
