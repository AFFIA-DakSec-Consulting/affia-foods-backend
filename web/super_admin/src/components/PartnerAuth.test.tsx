// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { PartnerAuthScreen } from './PartnerAuthScreen';
import { PartnerPendingScreen } from './PartnerPendingScreen';
import { ApiError, apiService } from '../services/api';
import { parsePartnerSession } from '../lib/partnerSignup';
import { byText, click, flush, mount, type, unmount } from '../test/dom';

afterEach(async () => { vi.restoreAllMocks(); await unmount(); });
const session = (over: Record<string, unknown> = {}) => parsePartnerSession({ approvalStatus: 'PENDING', user: { id: 'u1', name: 'Awa Diop', phone: '+221 771234567', role: 'VENDOR' }, vendor: { id: 'v1', name: 'Chez Awa', category: 'Grillades', address: 'Escale', fssaiNumber: null }, ...over });

const fillStepOne = async () => {
  await type(document.getElementById('su-name'), 'Awa Diop');
  await type(document.getElementById('su-phone'), '771234567');
  await type(document.getElementById('su-password'), 'motdepasse1');
  await click(byText('button', /Continuer/));
};
const fillStepTwo = async () => {
  await type(document.getElementById('su-restaurant'), 'Chez Awa');
  await type(document.getElementById('su-category'), 'Grillades');
  await type(document.getElementById('su-address'), 'Escale, Thiès');
};

describe('PartnerAuthScreen · sign-up', () => {
  it('stays on step 1 and names the fields that are wrong', async () => {
    const h = await mount(<PartnerAuthScreen mode="signup" onSession={() => {}} />);
    await click(byText('button', /Continuer/));
    expect(h.textContent).toContain('Indiquez votre prénom et votre nom');
    expect(h.textContent).toContain('Numéro sénégalais invalide');
    expect(h.textContent).toContain('Étape 1 sur 2');
  });

  it('sends the whole application and hands the session over', async () => {
    const signup = vi.spyOn(apiService, 'partnerSignup').mockResolvedValue(session());
    const onSession = vi.fn();
    const h = await mount(<PartnerAuthScreen mode="signup" onSession={onSession} />);
    await fillStepOne();
    expect(h.textContent).toContain('Étape 2 sur 2');
    await fillStepTwo();
    await click(byText('button', /Envoyer ma demande/));
    await flush();
    expect(signup).toHaveBeenCalledWith(expect.objectContaining({ role: 'VENDOR', name: 'Awa Diop', restaurantName: 'Chez Awa', category: 'Grillades', address: 'Escale, Thiès' }));
    expect(onSession).toHaveBeenCalledTimes(1);
  });

  it('brings the person back to step 1 when the phone already has an account', async () => {
    vi.spyOn(apiService, 'partnerSignup').mockRejectedValue(new ApiError(409, 'This phone number already has an account. Try logging in.', undefined, 'phone'));
    const h = await mount(<PartnerAuthScreen mode="signup" onSession={() => {}} />);
    await fillStepOne();
    await fillStepTwo();
    await click(byText('button', /Envoyer ma demande/));
    await flush();
    expect(h.textContent).toContain('Étape 1 sur 2');
    expect(h.textContent).toContain('Ce numéro a déjà un compte');
  });
});

describe('PartnerAuthScreen · sign-in', () => {
  it('explains that only the team can reset a forgotten password', async () => {
    const h = await mount(<PartnerAuthScreen mode="login" onSession={() => {}} />);
    expect(h.textContent).toContain('Mot de passe oublié');
    expect(h.textContent).toContain('un administrateur vous en donne un nouveau');
  });

  it('shows a French message for a wrong password and never starts a session', async () => {
    vi.spyOn(apiService, 'partnerLogin').mockRejectedValue(new ApiError(401, 'Wrong phone or password.'));
    const onSession = vi.fn();
    const h = await mount(<PartnerAuthScreen mode="login" onSession={onSession} />);
    await type(document.getElementById('login-phone'), '771234567');
    await type(document.getElementById('login-password'), 'mauvais');
    await click(byText('button', /Se connecter/));
    await flush();
    expect(h.textContent).toContain('Téléphone ou mot de passe incorrect');
    expect(onSession).not.toHaveBeenCalled();
  });
});

describe('PartnerPendingScreen', () => {
  it('tells a waiting restaurant that its file is being examined', async () => {
    vi.spyOn(apiService, 'fetchPartnerMe').mockResolvedValue(session());
    const h = await mount(<PartnerPendingScreen session={session()} onSession={() => {}} onLogout={() => {}} />);
    expect(h.textContent).toContain('Dossier en cours d’examen');
    expect(h.textContent).toContain('Chez Awa');
    expect(h.textContent).toContain('NINEA non renseigné');
  });

  it('shows the reason of a refusal and re-sends the corrected file', async () => {
    const refused = session({ approvalStatus: 'REJECTED', rejectionReason: 'Adresse introuvable' });
    const resend = vi.spyOn(apiService, 'resubmitApplication').mockResolvedValue(session());
    const onSession = vi.fn();
    const h = await mount(<PartnerPendingScreen session={refused} onSession={onSession} onLogout={() => {}} />);
    expect(h.textContent).toContain('Adresse introuvable');
    await type(document.getElementById('ap-address'), 'Quartier Randoulène, près du marché');
    await click(byText('button', /Renvoyer mon dossier/));
    await flush();
    expect(resend).toHaveBeenCalledWith(expect.objectContaining({ address: 'Quartier Randoulène, près du marché', restaurantName: 'Chez Awa' }));
    expect(onSession).toHaveBeenCalled();
  });

  it('signs out when the server no longer accepts the session (password reset by the team)', async () => {
    vi.spyOn(apiService, 'fetchPartnerMe').mockRejectedValue(new ApiError(401, 'Session expired'));
    const onLogout = vi.fn();
    await mount(<PartnerPendingScreen session={session()} onSession={() => {}} onLogout={onLogout} />);
    await click(byText('button', /Vérifier l’état/));
    await flush();
    expect(onLogout).toHaveBeenCalled();
  });
});
