// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act } from 'react';
import { VendorProfileEditor } from './VendorProfileEditor';
import { RestaurantProfilePage } from './RestaurantProfilePage';
import { apiService } from '../services/api';
import { click, flush, mount, type, unmount } from '../test/dom';
import type { Vendor } from '../types';

const vendor = (over: Partial<Vendor> = {}): Vendor => ({ id: 'v1', name: 'Chez Awa', category: 'Sénégalais', rating: 4.5, isAcceptingOrders: true, address: 'Thiès', activeOrdersCount: 0, bannerImage: 'https://x.test/b.jpg', logoUrl: null, description: null, phone: null, openingHours: null, ...over });
const saved = { bannerImage: 'https://x.test/b.jpg', logoUrl: null, description: 'Les meilleurs thiéboudiennes', phone: null, openingHours: null, eta: null, pickupNotes: null };

afterEach(async () => { vi.restoreAllMocks(); await unmount(); });
const saveButton = (h: HTMLElement) => Array.from(h.querySelectorAll('button')).find((b) => b.textContent?.includes('Enregistrer')) as HTMLButtonElement;

describe('VendorProfileEditor', () => {
  it('starts clean, enables Enregistrer once something changed, and sends only the change', async () => {
    const update = vi.spyOn(apiService, 'updateVendorProfile').mockResolvedValue(saved);
    const onSaved = vi.fn();
    const h = await mount(<VendorProfileEditor vendor={vendor()} onSaved={onSaved} />);
    expect(saveButton(h).disabled).toBe(true);
    expect(h.textContent).toContain('Tout est enregistré');
    await type(h.querySelector('#vp-description')!, 'Les meilleurs thiéboudiennes');
    expect(h.textContent).toContain('Modifications non enregistrées');
    await click(saveButton(h));
    await flush();
    expect(update).toHaveBeenCalledWith('v1', { description: 'Les meilleurs thiéboudiennes' });
    expect(onSaved).toHaveBeenCalledWith('v1', saved);
  });

  it('shows the problem and does not call the server when a field is invalid', async () => {
    const update = vi.spyOn(apiService, 'updateVendorProfile').mockResolvedValue(saved);
    const h = await mount(<VendorProfileEditor vendor={vendor()} onSaved={() => {}} />);
    await type(h.querySelector('#vp-phone')!, '123');
    await click(saveButton(h));
    expect(update).not.toHaveBeenCalled();
    expect(h.textContent).toContain('mobile sénégalais');
  });

  it('opening hours: open a day, add an evening period, and the preview says Ouvert / Fermé', async () => {
    const update = vi.spyOn(apiService, 'updateVendorProfile').mockResolvedValue(saved);
    const h = await mount(<VendorProfileEditor vendor={vendor()} onSaved={() => {}} />);
    await click(h.querySelector('[role="switch"][aria-label="Lundi : ouvert"]')!);
    expect(h.querySelectorAll('input[type="time"]')).toHaveLength(2);
    await click(Array.from(h.querySelectorAll('button')).find((b) => b.textContent?.includes('Ajouter une plage'))!);
    expect(h.querySelectorAll('input[type="time"]')).toHaveLength(4);
    // 08:00-22:00 then 18:00-23:00 overlap: refused before any request
    await click(saveButton(h));
    expect(update).not.toHaveBeenCalled();
    expect(h.textContent).toContain('se chevauchent');
    await type(h.querySelector('input[aria-label="Lundi : fermeture, plage 1"]')!, '14:00');
    await click(saveButton(h));
    await flush();
    expect(update).toHaveBeenCalledWith('v1', { openingHours: { mon: [{ open: '08:00', close: '14:00' }, { open: '18:00', close: '23:00' }] } });
  });

  it('can show only some blocks (the restaurant space has a page for hours)', async () => {
    const h = await mount(<VendorProfileEditor vendor={vendor()} sections={['hours']} onSaved={() => {}} />);
    expect(h.textContent).toContain('Horaires d’ouverture');
    expect(h.textContent).not.toContain('Présentation');
    expect(h.querySelector('section[aria-label="Aperçu de la boutique"]')).toBeNull();
  });
});

describe('VendorProfileEditor: address, preparation and pictures', () => {
  it('the restaurant enters its address, rider notes and preparation time, and only those are sent', async () => {
    const update = vi.spyOn(apiService, 'updateVendorProfile').mockResolvedValue(saved);
    const h = await mount(<VendorProfileEditor vendor={vendor()} onSaved={() => {}} />);
    await type(h.querySelector('#vp-address-input')!, 'Rue 10, Randoulène, Thiès');
    await type(h.querySelector('#vp-pickup')!, 'Porte bleue');
    await click(Array.from(h.querySelectorAll('[role="group"][aria-label="Temps courants"] button')).find((b) => b.textContent?.startsWith('15–25'))!);
    await click(saveButton(h));
    await flush();
    expect(update).toHaveBeenCalledWith('v1', { address: 'Rue 10, Randoulène, Thiès', pickupNotes: 'Porte bleue', eta: '15-25 min' });
  });

  it('refuses a missing address before calling the server', async () => {
    const update = vi.spyOn(apiService, 'updateVendorProfile').mockResolvedValue(saved);
    const h = await mount(<VendorProfileEditor vendor={vendor()} onSaved={() => {}} />);
    await type(h.querySelector('#vp-address-input')!, '');
    await click(saveButton(h));
    expect(update).not.toHaveBeenCalled();
    expect(h.textContent).toContain('Indiquez l’adresse du restaurant');
  });

  it('uploads a picked image, shows it, and keeps it for the next save', async () => {
    const upload = vi.spyOn(apiService, 'uploadVendorImage').mockResolvedValue('http://localhost:5001/static/uploads/vendors/v1-logo-abc.png');
    const update = vi.spyOn(apiService, 'updateVendorProfile').mockResolvedValue(saved);
    const h = await mount(<VendorProfileEditor vendor={vendor()} onSaved={() => {}} />);
    const file = new File([new Uint8Array(20)], 'logo.png', { type: 'image/png' });
    const input = h.querySelector('input[aria-label="Choisir le logo"]') as HTMLInputElement;
    await act(async () => { Object.defineProperty(input, 'files', { value: [file], configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true })); });
    await flush();
    expect(upload).toHaveBeenCalledWith('v1', 'logo', expect.anything());
    expect(h.textContent).toContain('Modifications non enregistrées');
    await click(saveButton(h));
    await flush();
    expect(update).toHaveBeenCalledWith('v1', { logoUrl: 'http://localhost:5001/static/uploads/vendors/v1-logo-abc.png' });
  });

  it('refuses a file that is not a picture, without calling the server', async () => {
    const upload = vi.spyOn(apiService, 'uploadVendorImage').mockResolvedValue('x');
    const h = await mount(<VendorProfileEditor vendor={vendor()} onSaved={() => {}} />);
    const input = h.querySelector('input[aria-label="Choisir la photo de couverture"]') as HTMLInputElement;
    await act(async () => { Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.pdf', { type: 'application/pdf' })], configurable: true }); input.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(upload).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Image non acceptée');
  });
});

describe('VendorProfileEditor: the map preview', () => {
  it('shows a map picture when the restaurant has a position, and an invitation when it has none', async () => {
    const withPin = await mount(<VendorProfileEditor vendor={vendor({ lat: 14.79, lng: -16.93, hasLocation: true })} sections={['address']} onSaved={() => {}} />);
    expect(withPin.querySelector('[role="img"][aria-label^="Aperçu de la carte"]')).not.toBeNull();
    expect(withPin.querySelectorAll('img[src^="https://tile.openstreetmap.org/16/"]')).toHaveLength(9);
    await unmount();
    const without = await mount(<VendorProfileEditor vendor={vendor({ hasLocation: false })} sections={['address']} onSaved={() => {}} />);
    expect(without.querySelector('[role="img"][aria-label^="Aperçu de la carte"]')).toBeNull();
    expect(without.textContent).toContain('Pas encore de position sur la carte');
  });
});

describe('RestaurantProfilePage', () => {
  it('lets the admin pick the restaurant to fill in', async () => {
    const h = await mount(<RestaurantProfilePage title="Profil du restaurant" subtitle="x" sections={['identity']} vendors={[vendor({ id: 'b', name: 'Bravo' }), vendor({ id: 'a', name: 'Alpha' })]} onSaved={() => {}} />);
    const select = h.querySelector('#profile-vendor') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Alpha', 'Bravo']);
    expect(h.textContent).toContain('Alpha');
  });
  it('says so when there is no restaurant', async () => {
    const h = await mount(<RestaurantProfilePage title="Profil" subtitle="x" sections={['identity']} vendors={[]} onSaved={() => {}} />);
    expect(h.textContent).toContain('Aucun restaurant pour l’instant');
  });
});