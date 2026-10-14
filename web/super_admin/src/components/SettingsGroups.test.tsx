// @vitest-environment jsdom
// Settings -> Fees for combined orders (Docs/22): fees.maxRestaurantsPerOrder (1..5, 1 = off) and fees.extraRestaurantFee (0..200).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsPanel } from './SettingsPanel';
import { apiService } from '../services/api';
import { byId, byText, click, flush, mount, type, unmount } from '../test/dom';
import { FEES_DEFAULT, rawProviders, settingView } from '../test/fixtures';
import { parseProviders } from '../lib/financeParse';

let fees: Record<string, unknown>;
let save: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  fees = { ...FEES_DEFAULT, futureField: 'keep me' };
  vi.spyOn(apiService, 'fetchSettings').mockImplementation(async (group) => settingView(group, (
    group === 'fees' ? { ...fees } : group === 'commission' ? { type: 'PERCENT', value: 10 } : group === 'settlement' ? { time: '22:00', mode: 'MANUAL_PAYOUT', autoCreate: true, holdDays: 0 } : { step: 1 }) as any) as any);
  vi.spyOn(apiService, 'fetchPayoutProviders').mockResolvedValue(parseProviders(rawProviders())!);
  save = vi.spyOn(apiService, 'saveSettings').mockImplementation(async (_g, value) => ({ value, view: null, changed: true, recalculateRecommended: false, message: 'Saved.' })) as any;
});
afterEach(async () => { vi.restoreAllMocks(); await unmount(); });

const render = async () => { await mount(<SettingsPanel onAuthError={vi.fn()} />); await flush(); };
const saveButton = () => byText('button', 'Enregistrer', document.querySelector('section[aria-label="Frais"]')!) as HTMLButtonElement;
const select = () => byId('fee-max-restaurants') as HTMLSelectElement;
const feesCard = () => document.querySelector('section[aria-label="Frais"]')!.textContent ?? '';

describe('fees: most restaurants in one order', () => {
  it('shows the server value, offers exactly 1 to 5, and explains each choice', async () => {
    fees.maxRestaurantsPerOrder = 4;
    await render();
    expect(select().value).toBe('4');
    expect(Array.from(select().options).map((o) => o.value)).toEqual(['1', '2', '3', '4', '5']);
    expect(Array.from(select().options)[0].textContent).toContain('commandes groupées désactivées');
    expect(feesCard()).toContain('Les clients peuvent regrouper jusqu’à 4 restaurants en un seul paiement : un paiement, un livreur, un code de livraison.');
    expect(feesCard()).toContain('toute la commande est annulée et intégralement remboursée');
    await type(select(), '1');
    expect(feesCard()).toContain('Désactivé : les clients commandent dans un seul restaurant à la fois.');
    expect(select().getAttribute('aria-describedby')).toBe('fee-max-restaurants-msg');
  });

  it('an older stored row without the key shows the server default 3 and Save stays off until something changes', async () => {
    await render();
    expect(select().value).toBe('3');
    expect(saveButton().disabled).toBe(true);
  });

  it('saves the new value as a number together with everything else, keeping unknown fields', async () => {
    await render();
    await type(select(), '1');
    expect(saveButton().disabled).toBe(false);
    await click(saveButton());
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toBe('fees');
    expect(save.mock.calls[0][1]).toMatchObject({ baseFee: 25, extraRestaurantFee: 15, maxRestaurantsPerOrder: 1, futureField: 'keep me' });
    expect(typeof (save.mock.calls[0][1] as any).maxRestaurantsPerOrder).toBe('number');
  });

  it('a stored value outside 1 to 5 stays visible as "not allowed" and cannot be saved', async () => {
    fees.maxRestaurantsPerOrder = 9;
    await render();
    expect(select().value).toBe('9');
    expect(select().options[0].textContent).toContain('non autorisé');
    await type(byId('fee-base'), '26'); // make it dirty
    await click(saveButton());
    expect(save).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('nombre entier de 1 à 5');
    await type(select(), '2');
    await click(saveButton());
    await flush();
    expect(save.mock.calls[0][1]).toMatchObject({ baseFee: 26, maxRestaurantsPerOrder: 2 });
  });
});

describe('fees: extra fee for each additional restaurant', () => {
  it('has a plain explanation with an example and the 0 to 200 range', async () => {
    await render();
    expect(feesCard()).toContain('Ajoutés une fois pour chaque restaurant après le premier');
    expect(feesCard()).toContain('0 à 200');
    expect(feesCard()).toContain('100 FCFA et 3 restaurants ajoutent 200 FCFA');
  });

  it('accepts 0 and 200, refuses 201 (the server limit; other fees keep 500) and never sends it', async () => {
    await render();
    await type(byId('fee-extra'), '201');
    await click(saveButton());
    expect(save).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('ne peut pas dépasser 200');
    await type(byId('fee-extra'), '200');
    await click(saveButton());
    await flush();
    expect(save.mock.calls[0][1]).toMatchObject({ extraRestaurantFee: 200 });
    await type(byId('fee-extra'), '0');
    await click(saveButton());
    await flush();
    expect(save.mock.calls[1][1]).toMatchObject({ extraRestaurantFee: 0 });
  });
});
