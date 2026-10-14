// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { CatalogPanel } from './CatalogPanel';
import { apiService, ApiError } from '../services/api';
import { CatalogDish, CatalogPage } from '../lib/catalogParse';
import { dish as fixtureDish, pendingDish, preview } from '../test/fixtures';
import { byText, click, flush, mount, unmount } from '../test/dom';

const dish = (id: string, over: Record<string, unknown> = {}): CatalogDish => fixtureDish({ id, name: `Dish ${id}`, price: 112.5, effectiveCommission: 12.5, ...over });
const page = (items: CatalogDish[], over: Partial<CatalogPage> = {}): CatalogPage => ({ items, page: 1, pageSize: 25, total: items.length, totalPages: 1, hasMore: false, ...over });
const vendors = [{ id: 'v1', name: 'Sharma Dhaba' }, { id: 'v2', name: 'Chai Point' }] as any[];

const render = (over: Record<string, unknown> = {}) => {
  const props = { vendors, query: '', onClearQuery: vi.fn(), onAuthError: vi.fn(), pendingCounts: { pending: 0, changePending: 0, total: 0 }, onPendingChanged: vi.fn(), ...over };
  return { props, element: <CatalogPanel {...(props as any)} /> };
};

afterEach(async () => { vi.restoreAllMocks(); await unmount(); });

describe('CatalogPanel', () => {
  it('opens on every dish (no status filter, page 1), shows prices with paise and the queue numbers on the tabs', async () => {
    const fetchCatalog = vi.spyOn(apiService, 'fetchCatalog').mockResolvedValue(page([pendingDish({ id: 'a', name: 'Dish a', price: 112.5, effectiveCommission: 12.5 })]));
    const { element } = render({ pendingCounts: { pending: 3, changePending: 2, total: 5 } });
    const host = await mount(element);
    await flush();
    expect(fetchCatalog).toHaveBeenCalledWith({ status: '', vendorId: '', q: '', page: 1 });
    expect(host.textContent).toContain('Dish a');
    expect(host.textContent).toContain('112,50 FCFA');
    expect(host.textContent).toContain('En attente de validation');
    expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toContain('Tous les plats');
    expect(byText('button', /^À valider/, host)!.textContent).toContain('3');
    expect(byText('button', /^Changements de prix/, host)!.textContent).toContain('2'); // the badge splits new dishes and price-change requests
    expect(byText('button', /^En ligne/, host)!.textContent).toContain('0'); // a tab not opened yet shows 0
  });

  it('filters go to the server: status chip, restaurant, search (debounced), and reset the page', async () => {
    const fetchCatalog = vi.spyOn(apiService, 'fetchCatalog').mockResolvedValue(page([dish('a')], { hasMore: true, totalPages: 3, total: 60 }));
    const { element } = render();
    const host = await mount(element);
    await flush();
    await click(host.querySelector('button[aria-label="Page suivante"]')!);
    await flush();
    expect(fetchCatalog.mock.calls[fetchCatalog.mock.calls.length - 1][0]).toMatchObject({ page: 2 });
    await click(byText('button', /^En ligne/, host));
    await flush();
    expect(fetchCatalog.mock.calls[fetchCatalog.mock.calls.length - 1][0]).toMatchObject({ status: 'LIVE', page: 1 });
    const select = host.querySelector('#catalog-vendor-filter') as HTMLSelectElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, 'v2'); select.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
    expect(fetchCatalog.mock.calls[fetchCatalog.mock.calls.length - 1][0]).toMatchObject({ vendorId: 'v2', page: 1 });
  });

  it('a search from the header is sent as q after a short wait', async () => {
    vi.useFakeTimers();
    const fetchCatalog = vi.spyOn(apiService, 'fetchCatalog').mockResolvedValue(page([dish('a')]));
    const { props } = render();
    const host = await mount(<CatalogPanel {...(props as any)} query="roll" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(fetchCatalog).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(fetchCatalog).toHaveBeenCalledWith({ status: '', vendorId: '', q: 'roll', page: 1 });
    expect(host.textContent).toContain('1 plat pour');
    vi.useRealTimers();
  });

  it('empty queue says so and offers all dishes', async () => {
    vi.spyOn(apiService, 'fetchCatalog').mockResolvedValue(page([]));
    const host = await mount(render().element);
    await flush();
    await click(byText('button', /^À valider/, host));
    await flush();
    expect(host.textContent).toContain('Rien en attente de validation');
    expect(byText('button', 'Afficher tous les plats', host)).toBeDefined();
  });

  it('shows the error in plain words, lets the admin retry, and passes the error up for logout handling', async () => {
    const fetchCatalog = vi.spyOn(apiService, 'fetchCatalog').mockRejectedValueOnce(new ApiError(500, 'The catalog is unavailable.')).mockResolvedValue(page([dish('a')]));
    const { element, props } = render();
    const host = await mount(element);
    await flush();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('The catalog is unavailable.');
    expect(props.onAuthError).toHaveBeenCalled();
    await click(byText('button', 'Réessayer', host));
    await flush();
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain('Dish a');
  });

  it('the availability switch flips at once and rolls back when the server refuses', async () => {
    vi.spyOn(apiService, 'fetchCatalog').mockResolvedValue(page([dish('a')]));
    let fail: (e: Error) => void = () => {};
    vi.spyOn(apiService, 'updateCatalogItem').mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
    const host = await mount(render().element);
    await flush();
    const sw = () => host.querySelector('table [role="switch"]') as HTMLButtonElement;
    expect(sw().getAttribute('aria-checked')).toBe('true');
    await click(sw());
    expect(sw().getAttribute('aria-checked')).toBe('false');
    expect(sw().disabled).toBe(true); // busy guard
    await act(async () => { fail(new Error('Nope')); });
    await flush();
    expect(sw().getAttribute('aria-checked')).toBe('true');
    expect(document.body.textContent).toContain('Disponibilité non modifiée');
  });

  it('opening a row shows the drawer, and a change reloads the list and the sidebar badge', async () => {
    const fetchCatalog = vi.spyOn(apiService, 'fetchCatalog').mockResolvedValue(page([pendingDish({ id: 'a', name: 'Dish a', price: 112.5, effectiveCommission: 12.5 })]));
    vi.spyOn(apiService, 'previewCatalogPrice').mockResolvedValue(preview(100));
    vi.spyOn(apiService, 'approveCatalogItem').mockResolvedValue(null);
    const { element, props } = render();
    const host = await mount(element);
    await flush();
    await click(host.querySelector('tr[aria-label="Ouvrir Dish a"]'));
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await click(byText('button', /^Valider/, document.body));
    await flush();
    expect(props.onPendingChanged).toHaveBeenCalledTimes(1);
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('Add dish opens the empty form', async () => {
    vi.spyOn(apiService, 'fetchCatalog').mockResolvedValue(page([dish('a')]));
    const host = await mount(render().element);
    await flush();
    await click(byText('button', 'Ajouter un plat', host));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Ajouter un plat');
  });

  it('loads the list once on mount', async () => {
    const fetchCatalog = vi.spyOn(apiService, 'fetchCatalog').mockResolvedValue(page([dish('a')]));
    const { props } = render();
    await mount(<CatalogPanel {...(props as any)} />);
    await flush();
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });
});

describe('real response details', () => {
  it('a dish whose stored price is out of date shows what today\'s rules give', async () => {
    vi.spyOn(apiService, 'fetchCatalog').mockResolvedValue(page([dish('a', { price: 110, computedPrice: 112, priceIsStale: true })]));
    const host = await mount(render().element);
    await flush();
    expect(host.querySelector('table')?.textContent).toContain('bientôt 112 FCFA');
  });

  it('shows the commission rule and where it comes from, and a requested price', async () => {
    vi.spyOn(apiService, 'fetchCatalog').mockResolvedValue(page([dish('a', { commission: { type: 'FLAT', value: 7, source: 'DISH' }, effectiveCommission: 7, status: 'CHANGE_PENDING', pendingVendorPrice: 120 })]));
    const host = await mount(render().element);
    await flush();
    const table = host.querySelector('table')!.textContent!;
    expect(table).toContain('7 FCFA (7 FCFA fixe · ce plat)');
    expect(table).toContain('demande 120 FCFA');
    expect(table).toContain('Changement de prix en attente');
  });
});
