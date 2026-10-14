// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { RestaurantDashboard } from './RestaurantDashboard';
import { click, mount, unmount } from '../test/dom';
import type { Order, Vendor } from '../types';

const NOW = Date.parse('2026-10-14T13:30:00Z');
const vendor = (over: Partial<Vendor> = {}): Vendor => ({ id: 'v1', name: 'Chez Awa', category: 'Sénégalais', rating: 4.5, isAcceptingOrders: true, address: 'Thiès', activeOrdersCount: 0, logoUrl: null, description: null, phone: null, openingHours: { wed: [{ open: '08:00', close: '23:00' }] }, ...over });
const order = (id: string, over: Partial<Order> = {}): Order => ({
  id, vendorId: 'v1', vendorName: 'Chez Awa', customerName: 'Ibrahima Ndiaye', items: [{ name: 'Thiéboudienne', quantity: 2, price: 3000 }], itemsCount: 2, totalAmount: 7000, deliveryFee: 500,
  dropoffHostel: 'Escale', status: 'PLACED', paymentStatus: 'PAID', createdAt: '2026-10-14T13:20:00Z', vendorSubtotal: 5000, ...over,
} as Order);

afterEach(async () => { vi.restoreAllMocks(); await unmount(); });
const props = (over: Record<string, unknown> = {}) => ({ vendors: [vendor()], orders: [] as Order[], vendorId: 'v1', onVendorChange: () => {}, now: NOW, onAdvance: vi.fn(), onToggleOpen: vi.fn(), onOpenOrder: vi.fn(), onNavigate: vi.fn(), ...over });
const btn = (h: HTMLElement, text: string) => Array.from(h.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) as HTMLButtonElement;

describe('RestaurantDashboard', () => {
  it('is calm with no order: a greeting, open state, empty columns and what to fill in', async () => {
    const h = await mount(<RestaurantDashboard {...props()} />);
    expect(h.textContent).toContain('Chez Awa');
    expect(h.textContent).toContain('Vous prenez des commandes');
    expect(h.textContent).toContain('Aujourd’hui : 08:00 – 23:00');
    expect(h.textContent).toContain('Aucune nouvelle commande');
    expect(h.textContent).toContain('Complétez votre fiche');
    expect(h.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('20');
    // it sits right under the welcome card, before the order columns
    const labels = Array.from(h.querySelectorAll('section[aria-label]')).map((s) => s.getAttribute('aria-label'));
    expect(labels.indexOf('Compléter votre fiche')).toBeGreaterThan(labels.indexOf('Bienvenue'));
    expect(labels.indexOf('Compléter votre fiche')).toBeLessThan(labels.indexOf('Nouvelles'));
  });

  it('puts each paid order in its column and shows only what the restaurant earns, never the customer total', async () => {
    const orders = [order('new1'), order('cook1', { status: 'ACCEPTED' }), order('cook2', { status: 'PREPARING' }), order('rdy1', { status: 'READY_FOR_PICKUP', driverName: 'Moussa Ba' }), order('unpaid', { paymentStatus: 'PENDING' }), order('other', { vendorId: 'v9' })];
    const h = await mount(<RestaurantDashboard {...props({ orders })} />);
    const sections = Array.from(h.querySelectorAll('section[aria-label]'));
    const col = (name: string) => sections.find((s) => s.getAttribute('aria-label') === name)!;
    expect(col('Nouvelles').querySelectorAll('article')).toHaveLength(1);
    expect(col('En cuisine').querySelectorAll('article')).toHaveLength(2);
    expect(col('Prêtes').querySelectorAll('article')).toHaveLength(1);
    expect(col('Prêtes').textContent).toContain('Moussa');
    expect(h.textContent).toContain('Ibrahima');
    expect(h.textContent).not.toContain('Ndiaye');
    expect(h.textContent).toContain('5 000 FCFA');
    expect(h.textContent).not.toContain('7 000 FCFA');
    expect(h.querySelector('[role="alert"]')!.textContent).toContain('1 nouvelle commande');
  });

  it('one big button per step: Accepter, Commencer, C’est prêt; Refuser opens the panel', async () => {
    const onAdvance = vi.fn();
    const onOpenOrder = vi.fn();
    const orders = [order('new1'), order('cook1', { status: 'ACCEPTED' }), order('cook2', { status: 'PREPARING' })];
    const h = await mount(<RestaurantDashboard {...props({ orders, onAdvance, onOpenOrder })} />);
    await click(btn(h, 'Accepter'));
    expect(onAdvance).toHaveBeenCalledWith('new1', 'ACCEPTED');
    await click(btn(h, 'Commencer'));
    expect(onAdvance).toHaveBeenCalledWith('cook1', 'PREPARING');
    await click(btn(h, 'C’est prêt'));
    expect(onAdvance).toHaveBeenCalledWith('cook2', 'READY_FOR_PICKUP');
    await click(btn(h, 'Refuser'));
    expect(onOpenOrder).toHaveBeenCalledWith('new1');
  });

  it('the big switch opens or closes the restaurant', async () => {
    const onToggleOpen = vi.fn();
    const h = await mount(<RestaurantDashboard {...props({ onToggleOpen, vendors: [vendor({ isAcceptingOrders: false })] })} />);
    expect(h.textContent).toContain('Vous êtes fermé');
    await click(h.querySelector('[role="switch"]')!);
    expect(onToggleOpen).toHaveBeenCalledWith('v1');
  });

  it('says "-" for money it does not know instead of inventing it', async () => {
    const h = await mount(<RestaurantDashboard {...props({ orders: [order('a', { vendorSubtotal: undefined })] })} />);
    expect(h.textContent).toContain('Montant indisponible pour le moment');
  });

  it('each missing step is one tap to the right page, and the reminder can be hidden', async () => {
    localStorage.clear();
    const onNavigate = vi.fn();
    const h = await mount(<RestaurantDashboard {...props({ onNavigate, vendors: [vendor({ openingHours: null })] })} />);
    await click(btn(h, 'Définir les horaires'));
    expect(onNavigate).toHaveBeenCalledWith('r-hours');
    await click(btn(h, 'Ajouter un logo'));
    expect(onNavigate).toHaveBeenCalledWith('r-profile');
    await click(h.querySelector('button[aria-label="Masquer ce rappel"]')!);
    expect(h.textContent).not.toContain('Complétez votre fiche');
    localStorage.clear();
  });
});
