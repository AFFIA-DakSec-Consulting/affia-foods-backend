// @vitest-environment jsdom
// Pre-demo dashboard fixes (WEB-01/02/03/04/09/11/16/18): component smoke tests in jsdom, API calls mocked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ToastProvider } from './ui/Toast';
import { ErrorBoundary } from './ErrorBoundary';
import { NeedsAttentionPanel } from './NeedsAttentionPanel';
import { VendorManager } from './VendorManager';
import { DriverManager } from './DriverManager';
import { OrdersTable } from './OrdersTable';
import { RiderAssignSelect } from './OrderControls';
import { LiveCommandCenter } from './LiveCommandCenter';
import { AttentionEntry, DriverPartner, DriverPin, Order, Vendor } from '../types';

// Leaflet is covered by CampusMap.test.tsx; here the map is a stub that records what it was given.
const mapProps: any[] = [];
vi.mock('./CampusMap', () => ({ default: (props: any) => { mapProps.push(props); return <div data-testid="map-stub" />; } }));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const mount = async (ui: React.ReactElement) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(<ToastProvider>{ui}</ToastProvider>); });
  return host;
};
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); });
const byText = (selector: string, text: string, scope: ParentNode = document) =>
  Array.from(scope.querySelectorAll(selector)).find((el) => el.textContent?.trim() === text) as HTMLElement | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  mapProps.length = 0;
  if (root) await act(async () => { root!.unmount(); });
  host?.remove();
  root = null; host = null;
  document.body.innerHTML = '';
});

const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const order = (id: string, over: Partial<Order> = {}): Order => ({
  id, customerName: 'Asha', vendorName: 'Sharma Dhaba', vendorId: 'v1', items: [], itemsCount: 1, totalAmount: 120, deliveryFee: 10, dropoffHostel: 'BH1',
  status: 'PLACED', paymentStatus: 'PAID', createdAt: ago(10 * 60_000), ...over,
});
const vendor = (over: Partial<Vendor> = {}): Vendor => ({ id: 'v1', name: 'Sharma Dhaba', category: 'North Indian', rating: 4.5, isAcceptingOrders: true, address: 'Ashta road', activeOrdersCount: 0, approvalStatus: 'APPROVED', lat: 23.0745, lng: 76.859, hasLocation: true, ...over });
const rider = (over: Partial<DriverPartner> = {}): DriverPartner => ({
  id: 'p1', userId: 'u1', name: 'Ravi', phone: '9000000001', studentRegNo: '', runnerCode: 'R1', vehicleType: 'Bike', vehicleRegNo: 'MP04', emergencyPhone: '',
  dutyStatus: 'ONLINE', ordersToday: 0, totalEarningsToday: 0, avgCompletionTimeMinutes: 0, onTimeRatePercent: 0, rating: 5, createdAt: ago(0), approvalStatus: 'APPROVED', ...over,
});
const pin = (id: string, over: Partial<DriverPin> = {}): DriverPin => ({ id, name: `Rider ${id}`, lat: 23.0735, lng: 76.859, heading: 0, status: 'IDLE', lastUpdated: new Date().toISOString(), dutyStatus: 'ONLINE', approvalStatus: 'APPROVED', ...over });

describe('WEB-09 ErrorBoundary', () => {
  it('shows a friendly reload screen instead of a blank page', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Boom: React.FC = () => { throw new Error('bad record'); };
    const h = await mount(<ErrorBoundary><Boom /></ErrorBoundary>);
    expect(h.textContent).toContain('Un problème est survenu');
    expect(byText('button', 'Recharger', h)).toBeDefined();
  });
  it('renders the app when nothing fails', async () => {
    const h = await mount(<ErrorBoundary><p>fine</p></ErrorBoundary>);
    expect(h.textContent).toBe('fine');
  });
});

describe('WEB-18 confirm before OTP reset and refund retry', () => {
  const entry = (code: string, o: Partial<Order>): AttentionEntry => ({ key: `${code}-1`, orderId: 'o1', order: order('o1', o), problems: [{ code }] });
  const props = (entries: AttentionEntry[], over: Record<string, unknown> = {}) => ({
    entries, serverAvailable: true, loading: false, error: '', checkedAt: Date.now(), onRefresh: () => {}, onOpenOrder: () => {},
    onResetOtpLock: vi.fn(async () => true), onRetryRefund: vi.fn(async () => true), ...over,
  });

  it('Reset OTP lock asks first; Cancel does nothing, Confirm sends it once', async () => {
    const p = props([entry('OTP_LOCKED', { status: 'ARRIVED_AT_GATE', otpLocked: true })]);
    const h = await mount(<NeedsAttentionPanel {...p} />);
    await click(byText('button', 'Réinitialiser le blocage OTP', h)!);
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain('nouveau code de livraison');
    expect(p.onResetOtpLock).not.toHaveBeenCalled();
    await click(byText('button', 'Annuler', dialog)!);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(p.onResetOtpLock).not.toHaveBeenCalled();
    await click(byText('button', 'Réinitialiser le blocage OTP', h)!);
    await click(byText('button', 'Réinitialiser le blocage OTP', document.querySelector('[role="alertdialog"]')!)!);
    await flush();
    expect(p.onResetOtpLock).toHaveBeenCalledTimes(1);
    expect(p.onResetOtpLock).toHaveBeenCalledWith('o1');
  });

  it('Retry refund asks first and Esc says no', async () => {
    const p = props([entry('REFUND_FAILED', { status: 'CANCELLED', paymentStatus: 'PAID', refundStatus: 'FAILED' })]);
    const h = await mount(<NeedsAttentionPanel {...p} />);
    await click(byText('button', 'Relancer le remboursement', h)!);
    expect(document.querySelector('[role="alertdialog"]')!.textContent).toContain('Relancer le remboursement ?');
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(p.onRetryRefund).not.toHaveBeenCalled();
    await click(byText('button', 'Relancer le remboursement', h)!);
    await click(byText('button', 'Relancer le remboursement', document.querySelector('[role="alertdialog"]')!)!);
    await flush();
    expect(p.onRetryRefund).toHaveBeenCalledWith('o1');
  });
});

describe('WEB-01 / WEB-18 VendorManager', () => {
  const orders = [order('1'), order('2', { status: 'PREPARING' }), order('3', { status: 'DELIVERED' }), order('4', { vendorId: 'v2', status: 'PLACED' })];

  it('"Active orders" is counted from the loaded orders, not the missing server field', async () => {
    const h = await mount(<VendorManager vendors={[vendor(), vendor({ id: 'v2', name: 'Campus Cafe' }), vendor({ id: 'v3', name: 'Quiet Kitchen' })]} orders={orders} onToggleVendor={() => {}} />);
    const cards = Array.from(h.querySelectorAll('article'));
    const active = (name: string) => cards.find((c) => c.textContent?.includes(name))!.textContent!.match(/Commandes en cours(\d+)/)?.[1];
    expect(active('Sharma Dhaba')).toBe('2');
    expect(active('Campus Cafe')).toBe('1');
    expect(active('Quiet Kitchen')).toBe('0');
  });

  it('the switch is disabled while that restaurant\'s request is running', async () => {
    const onToggle = vi.fn();
    const h = await mount(<VendorManager vendors={[vendor()]} orders={orders} busyVendorIds={new Set(['v1'])} onToggleVendor={onToggle} />);
    const sw = h.querySelector('[role="switch"]') as HTMLButtonElement;
    expect(sw.disabled).toBe(true);
    await click(sw);
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe('WEB-02 DriverManager shows only numbers that are computed', () => {
  it('no payouts, completion time, on-time rate or default rating; trips today come from delivered orders (India time)', async () => {
    // a seeded/fabricated roster row: 8 trips, 320 rupees, 12 min, 90 percent, rating 4.2
    const seeded = rider({ ordersToday: 8, totalEarningsToday: 320, avgCompletionTimeMinutes: 12, onTimeRatePercent: 90, rating: 4.2 });
    const orders = [
      order('1', { status: 'DELIVERED', driverId: 'u1', deliveredAt: ago(60_000) }),
      order('2', { status: 'DELIVERED', driverId: 'u1', deliveredAt: ago(2 * 60_000) }),
      order('3', { status: 'DELIVERED', driverId: 'u1', deliveredAt: ago(3 * 24 * 3600_000) }),
      order('4', { status: 'DELIVERED', driverId: 'someone-else', deliveredAt: ago(60_000) }),
    ];
    localStorage.setItem("kraveo_drivers_prefs", JSON.stringify({ view: "grid" }));
    const h = await mount(<DriverManager drivers={[seeded]} orders={orders} now={NOW} />);
    for (const gone of ['Versement', 'Durée moyenne', 'Ponctualité', 'Note', '320 FCFA', '4.2', '5.0', '4,2', '5,0']) expect(h.textContent).not.toContain(gone);
    const tile = Array.from(h.querySelectorAll('section[aria-label="Résumé des livreurs"] > *')).find((el) => el.textContent?.includes('Courses du jour'))!;
    expect(tile.textContent).toContain('2');
    expect(tile.textContent).not.toContain('8');
    expect(h.querySelector('[aria-label="Ouvrir le détail de Ravi"]')!.textContent).toContain('Courses du jour2');
    await click(h.querySelector('[aria-label="Ouvrir le détail de Ravi"]')!);
    const drawer = document.querySelector('[role="dialog"]')!;
    expect(drawer.textContent).toContain('Courses du jour');
    for (const gone of ['Gagné aujourd’hui', 'Durée moyenne', 'Taux de ponctualité', '320 FCFA']) expect(drawer.textContent).not.toContain(gone);
  });

  it('with no orders loaded the count is an honest 0, never the stored number', async () => {
    localStorage.setItem("kraveo_drivers_prefs", JSON.stringify({ view: "grid" }));
    const h = await mount(<DriverManager drivers={[rider({ ordersToday: 8 })]} now={NOW} />);
    expect(h.querySelector('[aria-label="Ouvrir le détail de Ravi"]')!.textContent).toContain('Courses du jour0');
  });
});

describe('WEB-03 OrdersTable "Load older"', () => {
  const base = { attentionIds: new Set<string>(), onAdvance: () => {}, onOpenOrder: () => {}, now: NOW };
  it('is offered only when the server has more, calls the handler, and the count says "loaded"', async () => {
    const onLoadOlder = vi.fn();
    const h = await mount(<OrdersTable {...base} orders={[order('1')]} hasMore onLoadOlder={onLoadOlder} />);
    expect(h.textContent).toContain('sur 1 commande chargée');
    await click(byText('button', 'Charger les commandes plus anciennes', h)!);
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });
  it('no button when everything is loaded', async () => {
    const h = await mount(<OrdersTable {...base} orders={[order('1')]} hasMore={false} onLoadOlder={() => {}} />);
    expect(byText('button', 'Charger les commandes plus anciennes', h)).toBeUndefined();
  });
});

describe('WEB-04 rider options', () => {
  it('a rider already on a delivery cannot be picked; an offline rider can (the admin is asked first)', async () => {
    const riders = [rider({ id: 'p1', name: 'Busy Bee', dutyStatus: 'IN_TRANSIT' }), rider({ id: 'p2', userId: 'u2', name: 'Sleepy', dutyStatus: 'OFFLINE' }), rider({ id: 'p3', userId: 'u3', name: 'Ready', dutyStatus: 'ONLINE' })];
    const h = await mount(<RiderAssignSelect order={order('o1')} riders={riders} onReassign={() => {}} />);
    const opt = (text: string) => Array.from(h.querySelectorAll('option')).find((o) => o.textContent?.startsWith(text)) as HTMLOptionElement;
    expect(opt('Busy Bee').disabled).toBe(true);
    expect(opt('Sleepy').disabled).toBe(false);
    expect(opt('Ready').disabled).toBe(false);
  });
});

describe('WEB-11 / WEB-16 live map inputs', () => {
  const props = (over: Record<string, unknown> = {}) => ({ drivers: [] as DriverPin[], orders: [] as Order[], driverPartners: [] as DriverPartner[], vendors: [] as Vendor[], onReassignDriver: async () => true, ...over });
  const lastMap = () => mapProps[mapProps.length - 1];

  it('only approved restaurants with a real pin are drawn', async () => {
    await mount(<LiveCommandCenter {...props({ vendors: [vendor({ id: 'a', name: 'Live Dhaba' }), vendor({ id: 'b', name: 'Suspended Dhaba', approvalStatus: 'SUSPENDED' }), vendor({ id: 'c', name: 'Pending Dhaba', approvalStatus: 'PENDING' }), vendor({ id: 'd', name: 'Rejected Dhaba', approvalStatus: 'REJECTED' })] })} />);
    await flush();
    expect(lastMap().vendors.map((v: any) => v.name)).toEqual(['Live Dhaba']);
  });

  it('ghost, offline and unapproved riders are not tracked or counted; on-duty riders are', async () => {
    const drivers = [
      pin('u1'),
      pin('off', { dutyStatus: 'OFFLINE' }),
      pin('sus', { approvalStatus: 'SUSPENDED' }),
      pin('ghost', { dutyStatus: undefined, approvalStatus: null, lastUpdated: ago(3 * 3600_000) }),
    ];
    const h = await mount(<LiveCommandCenter {...props({ drivers, driverPartners: [rider({ userId: 'u1' })] })} />);
    await flush();
    expect(lastMap().riders.map((r: any) => r.id)).toEqual(['u1']);
    expect(h.textContent).toContain('1 livreur sur la carte');
    const list = h.querySelector('ul[aria-label="Livreurs suivis"]')!;
    expect(list.querySelectorAll('li')).toHaveLength(1);
  });

  it('WEB-08: "Avg delivery time" uses deliveredAt, not a later updatedAt', async () => {
    const delivered = order('d1', { status: 'DELIVERED', createdAt: ago(60 * 60_000), deliveredAt: ago(40 * 60_000), updatedAt: ago(1_000) }); // 20 min
    const h = await mount(<LiveCommandCenter {...props({ orders: [delivered] })} />);
    await flush();
    const tile = Array.from(h.querySelectorAll('section[aria-label="Chiffres clés"] > *')).find((el) => el.textContent?.includes('Délai moyen de livraison'))!;
    expect(tile.textContent).toContain('De la commande à la livraison, 1 livrée');
  });
});

describe('DriverManager table view', () => {
  it('is the default view: one selectable row per rider, sortable, with pagination', async () => {
    localStorage.removeItem('kraveo_drivers_prefs');
    const riders = Array.from({ length: 12 }, (_, i) => rider({ id: `r${i}`, name: `Livreur ${String(i).padStart(2, '0')}` }));
    const h = await mount(<DriverManager drivers={riders} now={NOW} />);
    expect(h.querySelectorAll('tbody tr')).toHaveLength(10);
    expect(h.textContent).toContain('1–10 sur 12');
    await click(byText('button', '2', h)!);
    expect(h.querySelectorAll('tbody tr')).toHaveLength(2);
    await click(h.querySelector('tbody input[type="checkbox"]')!);
    expect(h.textContent).toContain('1 livreur sélectionné');
  });
});

describe('VendorManager list view', () => {
  it('list view: one row per restaurant, the open switch stays in the row, details open in a side panel', async () => {
    localStorage.setItem('kraveo_vendors_prefs', JSON.stringify({ view: 'table' }));
    const toggle = vi.fn();
    const h = await mount(<VendorManager vendors={[vendor({ id: 'a', name: 'Alpha' }), vendor({ id: 'b', name: 'Bravo' })]} onToggleVendor={toggle} />);
    expect(h.querySelectorAll('tbody tr')).toHaveLength(2);
    await click(h.querySelector('tbody [role="switch"], tbody button[aria-label$="accepte les commandes"]')!);
    expect(toggle).toHaveBeenCalledWith('a');
    await click(h.querySelector('tbody tr')!);
    await flush();
    expect(document.body.textContent).toContain('Ouvert aux commandes');
    localStorage.removeItem('kraveo_vendors_prefs');
  });
});
