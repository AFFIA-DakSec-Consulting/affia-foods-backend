// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { CatalogDishDrawer } from './CatalogDishDrawer';
import { apiService } from '../services/api';
import { changePendingDish, deletedDish, dish, pendingDish, preview as previewOf } from '../test/fixtures';
import { byId, byText, click, flush, mount, type, unmount } from '../test/dom';

const vendors = [{ id: 'v1', name: 'Sharma Dhaba' }, { id: 'v2', name: 'Chai Point' }] as any[];

const open = (item: ReturnType<typeof dish> | null, over: Record<string, unknown> = {}) => {
  const props = { onClose: vi.fn(), onChanged: vi.fn(), onAuthError: vi.fn(), ...over };
  return { props, element: <CatalogDishDrawer open item={item} vendors={vendors} categories={['Rolls']} {...props} /> };
};

let preview: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  preview = vi.spyOn(apiService, 'previewCatalogPrice').mockImplementation(async (input) => previewOf(input.vendorPrice)) as any;
});
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await unmount(); });

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe('live price preview', () => {
  it('asks the server once, 400 ms after the last keystroke, with the typed numbers', async () => {
    vi.useFakeTimers();
    await mount(open(pendingDish()).element);
    await advance(400);
    preview.mockClear();
    await type(byId('dish-price'), '1');
    await type(byId('dish-price'), '12');
    await type(byId('dish-price'), '125.5');
    await advance(399);
    expect(preview).not.toHaveBeenCalled();
    await advance(5);
    expect(preview).toHaveBeenCalledTimes(1);
    expect(preview.mock.calls[0][0]).toEqual({ vendorId: 'v1', vendorPrice: 125.5 });
    expect(document.querySelector('[data-testid="preview-price"]')?.textContent).toBe('137,50 FCFA');
    expect(document.querySelector('[data-testid="preview-commission"]')?.textContent).toBe('12 FCFA');
  });

  it('sends the typed commission override with the preview', async () => {
    vi.useFakeTimers();
    await mount(open(pendingDish()).element);
    await type(byId('dish-commission-mode'), 'PERCENT');
    await type(byId('dish-commission-value'), '10');
    preview.mockClear();
    await advance(500);
    expect(preview.mock.calls[preview.mock.calls.length - 1][0]).toEqual({ vendorId: 'v1', vendorPrice: 100, commissionType: 'PERCENT', commissionValue: 10 });
  });

  it.each(['-5', '12.345', 'abc', '', '0', '1e9', '999999'])('asks nothing for the invalid price %j', async (bad) => {
    vi.useFakeTimers();
    await mount(open(pendingDish()).element);
    await advance(500);
    preview.mockClear();
    await type(byId('dish-price'), bad);
    await advance(1000);
    expect(preview).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Saisissez un prix restaurant valide');
  });

  it('shows a plain error when the preview fails', async () => {
    vi.useFakeTimers();
    preview.mockRejectedValue(new Error('Preview is not available right now.'));
    await mount(open(pendingDish()).element);
    await advance(500);
    expect(document.body.textContent).toContain('Preview is not available right now.');
  });
});

describe('approve', () => {
  it('an invalid price is never sent', async () => {
    const approve = vi.spyOn(apiService, 'approveCatalogItem').mockResolvedValue(null);
    const { element } = open(pendingDish());
    await mount(element);
    await type(byId('dish-price'), '-3');
    await click(byText('button', /^Valider/));
    expect(approve).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('ne peut pas être négative');
  });

  it('sends the changed price and the chosen commission, once even on a double click, then closes', async () => {
    let finish: () => void = () => {};
    const approve = vi.spyOn(apiService, 'approveCatalogItem').mockImplementation(() => new Promise((resolve) => { finish = () => resolve(null); }));
    const { element, props } = open(pendingDish());
    await mount(element);
    await type(byId('dish-price'), '110');
    await type(byId('dish-commission-mode'), 'FLAT');
    await type(byId('dish-commission-value'), '7.5');
    const button = byText('button', /^Valider/)!;
    await click(button);
    await click(button);
    expect(approve).toHaveBeenCalledTimes(1);
    expect(approve).toHaveBeenCalledWith('d1', { vendorPrice: 110, commissionType: 'FLAT', commissionValue: 7.5 });
    await act(async () => { finish(); });
    await flush();
    expect(props.onChanged).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('leaving the commission on default sends no commission fields', async () => {
    const approve = vi.spyOn(apiService, 'approveCatalogItem').mockResolvedValue(null);
    await mount(open(pendingDish()).element);
    await click(byText('button', /^Valider/));
    expect(approve).toHaveBeenCalledWith('d1', {});
  });

  it('a server error is shown in plain words and nothing closes', async () => {
    vi.spyOn(apiService, 'approveCatalogItem').mockRejectedValue(new Error('Commission cannot be more than the price.'));
    const { element, props } = open(pendingDish());
    await mount(element);
    await click(byText('button', /^Valider/));
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Commission cannot be more than the price.');
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onAuthError).toHaveBeenCalled();
  });

  it('other edits are saved before approving', async () => {
    const update = vi.spyOn(apiService, 'updateCatalogItem').mockResolvedValue(null);
    const approve = vi.spyOn(apiService, 'approveCatalogItem').mockResolvedValue(null);
    await mount(open(pendingDish()).element);
    await type(byId('dish-name'), 'Paneer Kathi Roll');
    await click(byText('button', /^Valider/));
    expect(update).toHaveBeenCalledWith('d1', { name: 'Paneer Kathi Roll' });
    expect(approve).toHaveBeenCalledTimes(1);
  });
});

describe('reject', () => {
  it('needs a reason, then a confirm, then sends the reason', async () => {
    const reject = vi.spyOn(apiService, 'rejectCatalogItem').mockResolvedValue(null);
    await mount(open(pendingDish()).element);
    await click(byText('button', 'Refuser…'));
    await click(byText('button', 'Refuser le plat'));
    expect(reject).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('motif court');
    await type(byId('dish-reject-reason'), 'Photo is missing');
    await click(byText('button', 'Refuser le plat'));
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(reject).not.toHaveBeenCalled();
    await click(byText('button', 'Annuler', document.querySelector('[role="alertdialog"]')!));
    expect(reject).not.toHaveBeenCalled();
    await click(byText('button', 'Refuser le plat'));
    await click(byText('button', 'Refuser le plat', document.querySelector('[role="alertdialog"]')!));
    await flush();
    expect(reject).toHaveBeenCalledWith('d1', 'Photo is missing');
  });
});

describe('delete and restore', () => {
  it('delete asks first', async () => {
    const del = vi.spyOn(apiService, 'deleteCatalogItem').mockResolvedValue(null);
    await mount(open(dish()).element);
    await click(byText('button', 'Supprimer'));
    expect(del).not.toHaveBeenCalled();
    await click(byText('button', 'Annuler'));
    expect(del).not.toHaveBeenCalled();
    await click(byText('button', 'Supprimer'));
    await click(byText('button', 'Supprimer le plat'));
    await flush();
    expect(del).toHaveBeenCalledWith('d1');
  });

  it('a deleted dish can be restored and its fields are locked', async () => {
    const restore = vi.spyOn(apiService, 'restoreCatalogItem').mockResolvedValue(null);
    await mount(open(deletedDish()).element);
    expect((byId('dish-name') as HTMLInputElement).disabled).toBe(true);
    expect(byText('button', 'Supprimer')).toBeUndefined();
    await click(byText('button', 'Restaurer le plat'));
    await flush();
    expect(restore).toHaveBeenCalledWith('d1');
  });
});

describe('price change request', () => {
  it('shows the old and requested price and accepts with applyPending', async () => {
    const approve = vi.spyOn(apiService, 'approveCatalogItem').mockResolvedValue(null);
    await mount(open(changePendingDish()).element);
    expect(document.body.textContent).toContain('demande à changer le prix de 100 FCFA à 120 FCFA');
    await click(byText('button', 'Accepter le changement de prix'));
    await flush();
    expect(approve).toHaveBeenCalledWith('d1', { applyPending: true });
  });
});

describe('edit and create', () => {
  it('save sends only what changed; a cleared commission override is sent as null', async () => {
    const update = vi.spyOn(apiService, 'updateCatalogItem').mockResolvedValue(null);
    await mount(open(dish({ commissionOverride: { type: 'PERCENT', value: 10 } })).element);
    await type(byId('dish-commission-mode'), 'INHERIT');
    await click(byText('button', 'Enregistrer les modifications'));
    await flush();
    expect(update).toHaveBeenCalledWith('d1', { commissionType: null, commissionValue: null });
  });

  it('Save is disabled until something changes', async () => {
    await mount(open(dish()).element);
    expect((byText('button', 'Enregistrer les modifications') as HTMLButtonElement).disabled).toBe(true);
  });

  it('create needs a restaurant, a name, a category and a valid price, then posts them', async () => {
    const create = vi.spyOn(apiService, 'createCatalogItem').mockResolvedValue(null);
    await mount(open(null).element);
    await click(byText('button', 'Ajouter le plat'));
    expect(create).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Choisissez le restaurant');
    await type(byId('dish-vendor'), 'v2');
    await type(byId('dish-name'), 'Masala Chai');
    await type(byId('dish-category'), 'Tea');
    await type(byId('dish-price'), '15.50');
    await click(byText('button', 'Ajouter le plat'));
    await flush();
    expect(create).toHaveBeenCalledWith({ vendorId: 'v2', name: 'Masala Chai', category: 'Tea', isVeg: true, isAvailable: true, vendorPrice: 15.5 });
  });

  it('a photo address that is not http(s) is refused', async () => {
    const create = vi.spyOn(apiService, 'createCatalogItem').mockResolvedValue(null);
    await mount(open(null).element);
    await type(byId('dish-vendor'), 'v1');
    await type(byId('dish-name'), 'Masala Chai');
    await type(byId('dish-category'), 'Tea');
    await type(byId('dish-price'), '15');
    await type(byId('dish-image'), 'javascript:alert(1)');
    await click(byText('button', 'Ajouter le plat'));
    expect(create).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('commençant par https://');
  });
});

describe('declining a price change (reject on a CHANGE_PENDING dish)', () => {
  it('needs a reason and a confirm, then calls reject; the dish is not offered a plain Reject', async () => {
    const reject = vi.spyOn(apiService, 'rejectCatalogItem').mockResolvedValue(null);
    await mount(open(changePendingDish()).element);
    expect(byText('button', 'Refuser…')).toBeUndefined();
    await click(byText('button', 'Refuser le changement…'));
    await click(byText('button', 'Refuser le changement', document.querySelector('section[aria-label="Refuser le changement de prix"]')!));
    expect(reject).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('motif court');
    await type(byId('dish-reject-reason'), 'Too expensive for campus');
    await click(byText('button', 'Refuser le changement', document.querySelector('section[aria-label="Refuser le changement de prix"]')!));
    const confirmDialog = document.querySelector('[role="alertdialog"]')!;
    expect(confirmDialog.textContent).toContain('reste en ligne à 100 FCFA');
    await click(byText('button', 'Refuser le changement', confirmDialog));
    await flush();
    expect(reject).toHaveBeenCalledWith('d1', 'Too expensive for campus');
  });

  it('a reason over 200 letters is refused before anything is sent', async () => {
    const reject = vi.spyOn(apiService, 'rejectCatalogItem').mockResolvedValue(null);
    await mount(open(changePendingDish()).element);
    await click(byText('button', 'Refuser le changement…'));
    const box = byId('dish-reject-reason') as HTMLTextAreaElement;
    box.removeAttribute('maxlength'); // jsdom does not enforce it on programmatic input; the code must
    await type(box, 'x'.repeat(201));
    await click(byText('button', 'Refuser le changement', document.querySelector('section[aria-label="Refuser le changement de prix"]')!));
    expect(reject).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('moins de 200');
  });

  it('a live dish with no pending change cannot be rejected from the drawer (the server answers 409 NOT_PENDING)', async () => {
    await mount(open(dish()).element);
    expect(byText('button', 'Refuser…')).toBeUndefined();
    expect(byText('button', 'Refuser le changement…')).toBeUndefined();
    expect(byId('dish-reject-reason')).toBeNull();
  });

  it('a server refusal is shown in plain words', async () => {
    vi.spyOn(apiService, 'rejectCatalogItem').mockRejectedValue(new Error('This dish is live and has no change waiting.'));
    const { element, props } = open(changePendingDish());
    await mount(element);
    await click(byText('button', 'Refuser le changement…'));
    await type(byId('dish-reject-reason'), 'No thanks');
    await click(byText('button', 'Refuser le changement', document.querySelector('section[aria-label="Refuser le changement de prix"]')!));
    await click(byText('button', 'Refuser le changement', document.querySelector('[role="alertdialog"]')!));
    await flush();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('no change waiting');
    expect(props.onClose).not.toHaveBeenCalled();
  });
});

describe('real response details', () => {
  it('shows where the commission comes from and what rounding added', async () => {
    vi.useFakeTimers();
    preview.mockImplementation(async (input: any) => previewOf(input.vendorPrice, { price: input.vendorPrice + 14, commission: 14, nominalCommission: 12, roundingStep: 5, rule: { type: 'PERCENT', value: 12, source: 'VENDOR' } }));
    await mount(open(dish()).element);
    await advance(500);
    const rule = document.querySelector('[data-testid="preview-rule"]')!.textContent!;
    expect(rule).toContain('12% (ce restaurant)');
    expect(rule).toContain('multiple supérieur de 5 FCFA');
    expect(rule).toContain('l’arrondi ajoute 2 FCFA');
  });

  it('says so when the stored price is out of date', async () => {
    await mount(open(dish({ price: 110, computedPrice: 112, priceIsStale: true })).element);
    expect(document.body.textContent).toContain('donneraient 112 FCFA, mais les clients paient encore 110 FCFA');
  });

  it('the commission rule in use is shown for a dish that inherits', async () => {
    await mount(open(dish({ commission: { type: 'FLAT', value: 7, source: 'VENDOR' } })).element);
    expect(document.body.textContent).toContain('Utilise 7 FCFA fixe (ce restaurant)');
  });

  it('a photo cannot be emptied on an existing dish (the server requires an http link)', async () => {
    const update = vi.spyOn(apiService, 'updateCatalogItem').mockResolvedValue(null);
    await mount(open(dish()).element);
    await type(byId('dish-image'), '');
    await click(byText('button', 'Enregistrer les modifications'));
    expect(update).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('doit avoir une photo');
  });
});
