// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { AccountPage, SettingsHub, SettingsSoonPage } from './SettingsHub';
import { ADMIN_HUB, ADMIN_SETTINGS_PAGES, RESTAURANT_HUB } from '../lib/settingsCatalog';
import { isSoon, navItem } from '../lib/navigation';
import { click, mount, type, unmount } from '../test/dom';
import { pathForTab, tabForPath } from '../lib/navigation';

afterEach(async () => { await unmount(); });
const profile = { id: '1', name: 'Aminata Diop', phone: '771234567', role: 'ADMIN' as const };

describe('SettingsHub', () => {
  it('shows the sections as cards, marks the ones without a screen "Bientôt", and opens a page on click', async () => {
    const onNavigate = vi.fn();
    const h = await mount(<SettingsHub onNavigate={onNavigate} adminProfile={profile} onLogout={() => {}} />);
    expect(Array.from(h.querySelectorAll('h2')).map((e) => e.textContent)).toEqual(ADMIN_HUB.map((section) => section.title));
    const fees = Array.from(h.querySelectorAll('button')).find((b) => b.textContent?.includes('Frais & commission'))!;
    expect(fees.textContent).not.toContain('Bientôt');
    const templates = Array.from(h.querySelectorAll('button')).find((b) => b.textContent?.includes('Modèles de messages'))!;
    expect(templates.textContent).toContain('Bientôt');
    await click(fees);
    expect(onNavigate).toHaveBeenCalledWith('settings-fees');
  });

  it('search filters the cards and says so when nothing matches', async () => {
    const h = await mount(<SettingsHub onNavigate={() => {}} adminProfile={profile} onLogout={() => {}} />);
    await type(h.querySelector('input[type="search"]')!, 'frais');
    expect(h.textContent).toContain('Frais & commission');
    expect(h.textContent).not.toContain('Documents légaux');
    await type(h.querySelector('input[type="search"]')!, 'zzzz');
    expect(h.textContent).toContain('Aucun paramètre trouvé');
  });

  it('the account page shows the profile and signs out', async () => {
    const onLogout = vi.fn();
    const h = await mount(<AccountPage adminProfile={profile} onLogout={onLogout} />);
    expect(h.textContent).toContain('Aminata Diop');
    expect(h.textContent).toContain('771234567');
    await click(Array.from(h.querySelectorAll('button')).find((b) => b.textContent?.includes('Se déconnecter'))!);
    expect(onLogout).toHaveBeenCalled();
  });

  it('the settings pages have their own addresses', () => {
    expect(pathForTab('settings')).toBe('/parametres');
    expect(pathForTab('settings-fees')).toBe('/parametres/frais');
    expect(tabForPath('/parametres/compte')).toBe('settings-account');
  });

  it('the super admin sees every rubric, and each one has an address and a screen or a "Bientôt" page', () => {
    for (const section of [...ADMIN_HUB, ...RESTAURANT_HUB]) {
      for (const card of section.cards) {
        expect(navItem(card.tab as any), `${card.tab} has no navigation entry`).toBeDefined();
      }
    }
    expect(ADMIN_HUB.flatMap((section) => section.cards).length).toBeGreaterThanOrEqual(25);
    expect(ADMIN_SETTINGS_PAGES.every((entry) => isSoon(entry.id as any))).toBe(true);
  });

  it('a planned page says what it will configure and what is needed first', async () => {
    const onBack = vi.fn();
    const h = await mount(<SettingsSoonPage id="settings-payments" onBack={onBack} />);
    expect(h.textContent).toContain('Moyens de paiement');
    expect(h.textContent).toContain('Wave');
    expect(h.textContent).toContain('Ce qu’il faut d’abord');
    await click(Array.from(h.querySelectorAll('button')).find((b) => b.textContent === 'Paramètres')!);
    expect(onBack).toHaveBeenCalled();
  });

  it('the restaurant workspace has its own hub', async () => {
    const h = await mount(<SettingsHub workspace="restaurant" onNavigate={() => {}} onLogout={() => {}} />);
    expect(h.textContent).toContain('Notifications de commande');
    expect(h.textContent).not.toContain('Moyens de paiement');
  });
});
