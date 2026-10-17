import React, { useState } from 'react';
import { Check, Copy, Laptop, Loader2, LogOut, ShieldCheck, Smartphone } from 'lucide-react';
import { apiService } from '../services/api';
import { TwoFactorSetup, describeAgent, groupSecret } from '../lib/platformParse';
import { Drawer } from './ui/Drawer';
import { Field } from './ui/Field';
import { SkeletonCard } from './ui/Skeleton';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmDialog';
import { ErrorBanner, Pill, TextInput, dateTime, errorText, useLoad } from './platform/common';

/** Backup codes: shown once, then gone. */
const BackupCodes: React.FC<{ codes: string[]; onClose: () => void }> = ({ codes, onClose }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(codes.join('\n')); setCopied(true); } catch { /* they stay visible */ } };
  return (
    <Drawer open onClose={onClose} title="Codes de secours" subtitle="À conserver en lieu sûr" icon={ShieldCheck}
      footer={<div className="pb-4"><button type="button" className="k-btn-accent w-full" onClick={onClose}>J’ai noté mes codes</button></div>}>
      <div className="space-y-4">
        <p className="text-sm text-kraveo-ink2">Si vous perdez votre téléphone, chaque code vous permet de vous connecter <b className="text-kraveo-ink">une seule fois</b>. <b className="text-kraveo-ink">Ils ne seront plus affichés.</b></p>
        <ul className="k-inset grid grid-cols-2 gap-2 px-4 py-4 font-mono text-base text-kraveo-ink" data-testid="backup-codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
        <button type="button" className="k-btn-ghost w-full" onClick={copy}>{copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}{copied ? 'Copiés' : 'Copier les codes'}</button>
      </div>
    </Drawer>
  );
};

const TwoFactorCard: React.FC<{ enabled: boolean; backupLeft: number; onChanged: () => void; onAuthError: (e: unknown) => void }> = ({ enabled, backupLeft, onChanged, onAuthError }) => {
  const toast = useToast();
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [disabling, setDisabling] = useState(false);

  const fail = (e: unknown) => { onAuthError(e); setError(errorText(e)); };
  const start = async () => { setBusy(true); setError(''); try { setSetup(await apiService.startTwoFactor()); setCode(''); } catch (e) { fail(e); } finally { setBusy(false); } };
  const confirmCode = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) { setError('Saisissez les 6 chiffres affichés par votre application.'); return; }
    setBusy(true); setError('');
    try { const backup = await apiService.enableTwoFactor(code.trim()); setSetup(null); setCode(''); setCodes(backup); toast.success('Double authentification activée'); onChanged(); } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const turnOff = async (event: React.FormEvent) => {
    event.preventDefault();
    if (code.trim().length < 6) { setError('Saisissez un code de votre application ou un code de secours.'); return; }
    setBusy(true); setError('');
    try { await apiService.disableTwoFactor(code.trim()); setDisabling(false); setCode(''); toast.success('Double authentification désactivée'); onChanged(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <section className="k-card space-y-4 p-4 sm:p-5" aria-label="Double authentification">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-kraveo-ink"><Smartphone className="h-4 w-4 text-kraveo-g600" aria-hidden="true" />Double authentification</h2>
          <p className="text-sm text-kraveo-ink2">Un code à 6 chiffres, généré par une application sur votre téléphone, est demandé en plus de votre code personnel.</p>
        </div>
        <Pill tone={enabled ? 'green' : 'amber'}>{enabled ? 'Activée' : 'Désactivée'}</Pill>
      </div>
      {error && <ErrorBanner message={error} />}

      {!enabled && !setup && <button type="button" className="k-btn-accent" onClick={start} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Activer la double authentification</button>}

      {!enabled && setup && (
        <form onSubmit={confirmCode} className="space-y-4" noValidate>
          <ol className="list-decimal space-y-2 pl-5 text-sm text-kraveo-ink2">
            <li>Ouvrez une application d’authentification (Google Authenticator, Microsoft Authenticator, Authy…).</li>
            <li>Ajoutez un compte avec la <b className="text-kraveo-ink">saisie manuelle</b> et entrez cette clé :</li>
          </ol>
          <p className="k-inset select-all break-all px-4 py-3 font-mono text-lg font-bold tracking-wider text-kraveo-ink" data-testid="totp-secret">{groupSecret(setup.secret)}</p>
          <Field label="Code à 6 chiffres affiché par l’application" htmlFor="totp-code"><TextInput id="totp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError(''); }} /></Field>
          <div className="flex gap-3"><button type="button" className="k-btn-ghost flex-1" onClick={() => { setSetup(null); setError(''); }}>Annuler</button><button type="submit" className="k-btn-accent flex-1" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Vérifier et activer</button></div>
        </form>
      )}

      {enabled && !disabling && (
        <div className="space-y-3">
          <p className="text-sm text-kraveo-ink2">{backupLeft} code{backupLeft > 1 ? 's' : ''} de secours restant{backupLeft > 1 ? 's' : ''}.{backupLeft <= 2 ? ' Pensez à désactiver puis réactiver la double authentification pour en obtenir de nouveaux.' : ''}</p>
          <button type="button" className="k-btn-ghost" onClick={() => { setDisabling(true); setCode(''); setError(''); }}>Désactiver</button>
        </div>
      )}
      {enabled && disabling && (
        <form onSubmit={turnOff} className="space-y-3" noValidate>
          <Field label="Code de votre application ou code de secours" htmlFor="totp-off"><TextInput id="totp-off" autoComplete="one-time-code" value={code} onChange={(e) => { setCode(e.target.value); setError(''); }} maxLength={9} /></Field>
          <div className="flex gap-3"><button type="button" className="k-btn-ghost flex-1" onClick={() => { setDisabling(false); setError(''); }}>Annuler</button><button type="submit" className="k-btn-danger flex-1" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Désactiver</button></div>
        </form>
      )}
      {codes && <BackupCodes codes={codes} onClose={() => setCodes(null)} />}
    </section>
  );
};

const SessionsCard: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { data, loading, error, reload } = useLoad(() => apiService.fetchMySessions(), onAuthError);
  const [busy, setBusy] = useState<string | null>(null);
  const rows = data ?? [];
  const others = rows.filter((s) => !s.current);

  const close = async (id: string) => {
    setBusy(id);
    try { await apiService.revokeMySession(id); toast.success('Session fermée'); await reload(); } catch (e) { onAuthError(e); toast.error('Action refusée', errorText(e)); } finally { setBusy(null); }
  };
  const closeOthers = async () => {
    if (!(await confirm({ title: 'Fermer toutes les autres sessions ?', message: `${others.length} appareil${others.length > 1 ? 's seront déconnectés' : ' sera déconnecté'}. Vous restez connecté ici.`, confirmLabel: 'Tout fermer', danger: true }))) return;
    setBusy('all');
    try { const n = await apiService.revokeOtherSessions(); toast.success('Sessions fermées', `${n} session${n > 1 ? 's' : ''}.`); await reload(); } catch (e) { onAuthError(e); toast.error('Action refusée', errorText(e)); } finally { setBusy(null); }
  };

  return (
    <section className="k-card space-y-3 p-4 sm:p-5" aria-label="Sessions ouvertes">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0"><h2 className="flex items-center gap-2 font-display text-base font-bold text-kraveo-ink"><Laptop className="h-4 w-4 text-kraveo-g600" aria-hidden="true" />Sessions ouvertes</h2><p className="text-sm text-kraveo-ink2">Les appareils où vous êtes connecté. Fermez ceux que vous ne reconnaissez pas.</p></div>
        {others.length > 0 && <button type="button" className="k-btn-ghost !min-h-[36px] text-xs" disabled={busy === 'all'} onClick={closeOthers}><LogOut className="h-3.5 w-3.5" aria-hidden="true" />Fermer les autres ({others.length})</button>}
      </div>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <SkeletonCard lines={2} />}
      <ul className="divide-y divide-kraveo-line/60 rounded-k-md border border-kraveo-line">
        {rows.map((s) => (
          <li key={s.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="min-w-0"><span className="flex flex-wrap items-center gap-2 font-bold text-kraveo-ink">{describeAgent(s.userAgent)}{s.current && <Pill tone="green">Cet appareil</Pill>}</span><span className="block truncate text-xs text-kraveo-ink3">{s.ip ?? 'adresse inconnue'} · connecté le {dateTime(s.createdAt)} · actif {dateTime(s.lastSeenAt)}</span></span>
            {!s.current && <button type="button" className="k-btn-ghost !min-h-[34px] text-xs" disabled={busy === s.id} onClick={() => close(s.id)}>Fermer</button>}
          </li>
        ))}
        {data && rows.length === 0 && <li className="px-4 py-3 text-sm text-kraveo-ink2">Aucune session suivie : votre connexion actuelle date d’avant cette fonction. Reconnectez-vous pour la voir ici.</li>}
      </ul>
      {dialog}
    </section>
  );
};

export const SecurityPanel: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const { data, loading, error, reload } = useLoad(() => apiService.fetchMyTeamInfo(), onAuthError);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <SkeletonCard lines={3} />}
      {data && <TwoFactorCard enabled={data.twoFactor} backupLeft={data.backupCodesLeft} onChanged={reload} onAuthError={onAuthError} />}
      <SessionsCard onAuthError={onAuthError} />
    </div>
  );
};
