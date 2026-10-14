// @vitest-environment jsdom
// Restaurant location in the dashboard (Docs/20 section 1): source badge, Google Maps link, the editor, the Applications
// card ("not provided" / what the restaurant sent) and the needs-attention entry. API calls are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { ToastProvider } from './ui/Toast';
import { VendorLocationEditor } from './VendorLocationEditor';
import { ApplicationsPanel } from './ApplicationsPanel';
import { NeedsAttentionPanel } from './NeedsAttentionPanel';
import { apiService } from '../services/api';
import { Application, Vendor } from '../types';

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
const type = async (el: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  await act(async () => { setter.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); });
};
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); });

afterEach(async () => {
  vi.restoreAllMocks();
  if (root) await act(async () => { root!.unmount(); });
  host?.remove();
  root = null; host = null;
});

const PIN = { lat: 23.0745, lng: 76.859 };

describe('VendorLocationEditor', () => {
  it('no pin: "Not set" badge, no map link, a "Set location" button', async () => {
    const h = await mount(<VendorLocationEditor id="v1" name="Sharma Dhaba" pin={{ lat: 23.0768, lng: 76.8524, hasLocation: false }} />);
    expect(h.textContent).toContain('Non défini');
    expect(h.querySelector('a')).toBeNull();
    expect(h.textContent).toContain('Définir la position');
  });

  it('notSetLabel replaces "Not set" (the Applications card says "Not provided")', async () => {
    const h = await mount(<VendorLocationEditor id="v1" name="X" pin={{ hasLocation: false }} notSetLabel="Non fourni" />);
    expect(h.textContent).toContain('Non fourni');
    expect(h.textContent).not.toContain('Non défini');
  });

  it('a device pin shows coordinates, who/when/how accurate and an Open in Google Maps link', async () => {
    const h = await mount(<VendorLocationEditor id="v1" name="Sharma Dhaba" pin={{ ...PIN, hasLocation: true, locationSource: 'DEVICE', locationSetAt: '2026-10-05T10:00:00.000Z', locationAccuracyM: 12.4 }} />);
    expect(h.textContent).toContain('23.07450, 76.85900');
    expect(h.textContent).toContain('Définie par le restaurant le 5 oct. 2026, environ 12 m');
    const a = h.querySelector('a') as HTMLAnchorElement;
    expect(a.href).toBe('https://www.google.com/maps/search/?api=1&query=23.0745,76.859');
    expect(a.target).toBe('_blank');
    expect(a.rel).toContain('noopener');
    expect(h.textContent).toContain('Modifier');
  });

  it('an admin pin says "Set by admin"', async () => {
    const h = await mount(<VendorLocationEditor id="v1" name="X" pin={{ ...PIN, hasLocation: true, locationSource: 'ADMIN' }} />);
    expect(h.querySelector('[data-pin-kind="ADMIN"]')?.textContent).toBe('Définie par l’admin');
  });

  it('typing coordinates saves through the API and reports the saved pin; a bad value never reaches the server', async () => {
    const saved = { lat: 23.0745, lng: 76.859, hasLocation: true, locationSource: 'ADMIN' as const, locationSetAt: '2026-10-05T10:00:00.000Z', locationAccuracyM: null };
    const spy = vi.spyOn(apiService, 'setVendorLocation').mockResolvedValue(saved);
    const onSaved = vi.fn();
    const h = await mount(<VendorLocationEditor id="v1" name="Sharma Dhaba" pin={{ hasLocation: false }} onSaved={onSaved} />);
    await click(h.querySelector('button')!); // "Définir la position"
    const input = h.querySelector('input') as HTMLInputElement;
    await type(input, '28.6139, 77.2090'); // Delhi
    await act(async () => { h.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(spy).not.toHaveBeenCalled();
    expect(h.textContent).toMatch(/plus de 3 km du campus/);
    await type(input, '23.0745, 76.8590');
    await act(async () => { h.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    await flush();
    expect(spy).toHaveBeenCalledWith('v1', 23.0745, 76.859);
    expect(onSaved).toHaveBeenCalledWith('v1', saved);
  });
});

const application = (over: Partial<Application> & { vendor?: Application['vendor'] } = {}): Application => ({
  id: 'a1', kind: 'VENDOR', userId: 'u1', name: 'Ramesh', phone: '+91 9000000001', status: 'PENDING', rejectionReason: null, selfSignup: true,
  appliedAt: new Date().toISOString(), reviewedAt: null, createdAt: new Date().toISOString(),
  vendor: { name: 'Pending Dhaba', category: 'North Indian', address: 'Ashta road', fssaiNumber: null, isAcceptingOrders: false, lat: 23.0768, lng: 76.8524, hasLocation: false, locationSource: null, locationSetAt: null, locationAccuracyM: null },
  ...over,
});

describe('ApplicationsPanel: the location a pending restaurant sent', () => {
  const counts = { PENDING: 2, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 };
  beforeEach(() => { localStorage.setItem('kraveo_applications_prefs', JSON.stringify({ view: 'grid' })); });

  it('shows the coordinates, accuracy and a Google Maps link when the restaurant sent a pin', async () => {
    vi.spyOn(apiService, 'fetchApplications').mockResolvedValue({ counts, data: [application({ vendor: { ...application().vendor!, ...PIN, hasLocation: true, locationSource: 'DEVICE', locationSetAt: '2026-10-05T10:00:00.000Z', locationAccuracyM: 18 } })] } as any);
    const h = await mount(<ApplicationsPanel refreshKey={0} onChanged={() => {}} onAuthError={() => {}} />);
    await flush();
    expect(h.textContent).toContain('Pending Dhaba');
    expect(h.textContent).toContain('23.07450, 76.85900');
    expect(h.textContent).toContain('Définie par le restaurant le 5 oct. 2026, environ 18 m');
    expect(Array.from(h.querySelectorAll('a')).some((a) => a.href.startsWith('https://www.google.com/maps/search/'))).toBe(true);
    expect(h.textContent).not.toContain('n’a pas envoyé de position');
  });

  it('shows a "not provided" state with a hint and the editor when no pin was sent', async () => {
    vi.spyOn(apiService, 'fetchApplications').mockResolvedValue({ counts, data: [application()] } as any);
    const h = await mount(<ApplicationsPanel refreshKey={0} onChanged={() => {}} onAuthError={() => {}} />);
    await flush();
    expect(h.textContent).toContain('Non fourni');
    expect(h.textContent).toContain('n’a pas envoyé de position');
    expect(h.querySelector('[aria-label="Définir la position de Pending Dhaba"]')).not.toBeNull();
    expect(Array.from(h.querySelectorAll('a')).some((a) => a.href.includes('google.com/maps'))).toBe(false);
  });

  it('an older server (no location fields at all) renders as "not provided", not as a crash', async () => {
    const old = application();
    delete (old.vendor as any).lat; delete (old.vendor as any).lng; delete (old.vendor as any).hasLocation;
    vi.spyOn(apiService, 'fetchApplications').mockResolvedValue({ counts, data: [old] } as any);
    const h = await mount(<ApplicationsPanel refreshKey={0} onChanged={() => {}} onAuthError={() => {}} />);
    await flush();
    expect(h.textContent).toContain('Non fourni');
  });

  it('riders have no map pin block', async () => {
    const rider: Application = { ...application(), id: 'r1', kind: 'DRIVER', vendor: undefined, driver: { runnerCode: 'RUN-1234', vehicleType: 'Bike', vehicleRegNo: 'MP04', emergencyPhone: null, upiId: null } };
    vi.spyOn(apiService, 'fetchApplications').mockResolvedValue({ counts, data: [rider] } as any);
    const h = await mount(<ApplicationsPanel refreshKey={0} onChanged={() => {}} onAuthError={() => {}} />);
    await flush();
    expect(h.textContent).not.toContain('Repère sur la carte');
  });
});

const vendor = (over: Partial<Vendor> = {}): Vendor => ({ id: 'v1', name: 'Sharma Dhaba', category: 'North Indian', rating: 4.5, isAcceptingOrders: true, address: 'Ashta road', activeOrdersCount: 0, approvalStatus: 'APPROVED', ...over });
const attentionProps = { entries: [], serverAvailable: true, loading: false, error: '', checkedAt: Date.now(), onRefresh: () => {}, onOpenOrder: () => {}, onResetOtpLock: async () => true, onRetryRefund: async () => true };

describe('NeedsAttentionPanel: restaurants without a location', () => {
  it('lists them with the specified text and a button to the Vendors tab', async () => {
    const onOpenVendors = vi.fn();
    const h = await mount(<NeedsAttentionPanel {...attentionProps} locationGaps={[vendor(), vendor({ id: 'v2', name: 'Campus Cafe' })]} onOpenVendors={onOpenVendors} />);
    expect(h.textContent).toContain('Sharma Dhaba');
    expect(h.textContent).toContain('Campus Cafe');
    expect((h.textContent!.match(/Aucune position - les livreurs ne peuvent pas s’y rendre/g) ?? []).length).toBe(2);
    expect(h.textContent).toContain('2 sans position');
    expect(h.textContent).not.toContain('Rien à traiter pour le moment');
    await click(h.querySelector('[aria-label="Définir la position de Sharma Dhaba dans l’onglet Restaurants"]')!);
    expect(onOpenVendors).toHaveBeenCalledTimes(1);
  });

  it('nothing to show: the usual empty state, and no location section', async () => {
    const h = await mount(<NeedsAttentionPanel {...attentionProps} />);
    expect(h.textContent).toContain('Rien à traiter pour le moment');
    expect(h.textContent).not.toContain('Restaurants sans position sur la carte');
  });

  it('the search box filters the restaurants too', async () => {
    const h = await mount(<NeedsAttentionPanel {...attentionProps} locationGaps={[vendor(), vendor({ id: 'v2', name: 'Campus Cafe' })]} query="campus" />);
    expect(h.textContent).toContain('Campus Cafe');
    expect(h.textContent).not.toContain('Sharma Dhaba');
  });
});

describe('ApplicationsPanel views', () => {
  const counts = { PENDING: 1, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 };
  it('opens on the cards by default', async () => {
    localStorage.removeItem('kraveo_applications_prefs');
    vi.spyOn(apiService, 'fetchApplications').mockResolvedValue({ counts, data: [application()] } as any);
    const h = await mount(<ApplicationsPanel refreshKey={0} onChanged={() => {}} onAuthError={() => {}} />);
    await flush();
    expect(h.querySelector('table')).toBeNull();
    expect(h.textContent).toContain('Repère sur la carte');
  });

  it('table view: a row with icon actions, and the details open in a side panel', async () => {
    localStorage.setItem('kraveo_applications_prefs', JSON.stringify({ view: 'table' }));
    vi.spyOn(apiService, 'fetchApplications').mockResolvedValue({ counts, data: [application()] } as any);
    const h = await mount(<ApplicationsPanel refreshKey={0} onChanged={() => {}} onAuthError={() => {}} />);
    await flush();
    expect(h.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(h.querySelector('tbody button[aria-label="Approuver"]')).not.toBeNull();
    expect(h.querySelector('tbody button[aria-label="Refuser"]')).not.toBeNull();
    expect(h.textContent).not.toContain('Repère sur la carte');
    await click(h.querySelector('tbody tr')!);
    await flush();
    expect(document.body.textContent).toContain('Repère sur la carte');
  });
});

describe('ApplicationsPanel file check (dossier)', () => {
  const counts = { PENDING: 2, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 };
  const complete = application({ id: 'ok', vendor: { ...application().vendor!, name: 'Dossier Ok', fssaiNumber: 'L-1', hasLocation: true, lat: 14.79, lng: -16.93 } });
  const missing = application({ id: 'ko', vendor: { ...application().vendor!, name: 'Dossier Ko', fssaiNumber: null } });
  it('table: shows the file state and filters on "Documents manquants"', async () => {
    localStorage.setItem('kraveo_applications_prefs', JSON.stringify({ view: 'table' }));
    vi.spyOn(apiService, 'fetchApplications').mockResolvedValue({ counts, data: [complete, missing] } as any);
    const h = await mount(<ApplicationsPanel refreshKey={0} onChanged={() => {}} onAuthError={() => {}} />);
    await flush();
    expect(h.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(h.textContent).toContain('Dossier complet');
    await click(Array.from(h.querySelectorAll('button')).find((b) => b.textContent === 'Documents manquants')!);
    expect(h.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(h.textContent).toContain('Dossier Ko');
    await click(h.querySelector('tbody tr')!);
    await flush();
    expect(document.querySelector('ul[aria-label="Contrôle du dossier"]')!.textContent).toContain('Licence alimentaire (FSSAI)');
  });
});

describe('ApplicationsPanel manual add', () => {
  it('the "Ajouter manuellement" menu offers a restaurant or a rider and opens the form', async () => {
    vi.spyOn(apiService, 'fetchApplications').mockResolvedValue({ counts: { PENDING: 0, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 }, data: [] } as any);
    const h = await mount(<ApplicationsPanel refreshKey={0} onChanged={() => {}} onAuthError={() => {}} />);
    await flush();
    await click(Array.from(h.querySelectorAll('button')).find((b) => b.textContent?.includes('Ajouter manuellement'))!);
    expect(Array.from(h.querySelectorAll('[role="menuitem"]')).map((b) => b.textContent)).toEqual(['Un restaurant', 'Un livreur']);
    await click(Array.from(h.querySelectorAll('[role="menuitem"]')).pop()!);
    await flush();
    expect(document.body.textContent).toContain('Ajouter un livreur');
  });
});
