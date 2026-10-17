import React, { useState } from 'react';
import { Check, Copy, KeyRound, Loader2, ShieldCheck, ShieldOff, UserPlus } from 'lucide-react';
import { apiService, ApiError } from '../services/api';
import { AdminProfile } from '../types';
import { TeamMember } from '../lib/platformParse';
import { ADMIN_ROLES, AdminRoleId, GROUP_LABEL, PermissionGroup, ROLE_ACCESS, ROLE_HINT, ROLE_LABEL } from '../lib/permissions';
import { Drawer } from './ui/Drawer';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { SkeletonCard } from './ui/Skeleton';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmDialog';
import { PageHeader } from './ui/PageToolbar';
import { ErrorBanner, Pill, TextInput, dateTime, errorText, useLoad } from './platform/common';

/** Super admins that can really sign in (the owner counts; a suspended or code-less account does not). */
export const usableSupers = (members: Array<Pick<TeamMember, 'role' | 'disabled' | 'dormant'>>): number =>
  members.filter((m) => m.role === 'SUPER_ADMIN' && !m.disabled && !m.dormant).length;

/** A code that is shown once. Nothing here is kept after the dialog closes. */
const CodeDialog: React.FC<{ title: string; name: string; phone: string | null; code: string; onClose: () => void }> = ({ title, name, phone, code, onClose }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { /* the code stays visible: it can be copied by hand */ } };
  return (
    <Drawer open onClose={onClose} title={title} subtitle={name} icon={KeyRound}
      footer={<div className="pb-4"><button type="button" className="k-btn-accent w-full" onClick={onClose}>J’ai noté le code</button></div>}>
      <div className="space-y-4">
        <p className="text-sm text-kraveo-ink2">Transmettez ce code à la personne par un moyen sûr. <b className="text-kraveo-ink">Il ne sera plus affiché</b> : en cas de perte, générez-en un nouveau.</p>
        <div className="k-inset space-y-2 px-4 py-4">
          <p className="k-label">Identifiant (téléphone)</p>
          <p className="font-mono text-base text-kraveo-ink">{phone ?? '—'}</p>
          <p className="k-label mt-3">Code personnel</p>
          <p className="select-all break-all font-mono text-2xl font-bold tracking-wider text-kraveo-ink" data-testid="team-code">{code}</p>
        </div>
        <button type="button" className="k-btn-ghost w-full" onClick={copy}>{copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}{copied ? 'Copié' : 'Copier le code'}</button>
      </div>
    </Drawer>
  );
};

const AddMemberDrawer: React.FC<{ open: boolean; onClose: () => void; onCreated: (m: TeamMember | null, code: string) => void; onAuthError: (e: unknown) => void }> = ({ open, onClose, onCreated, onAuthError }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<AdminRoleId>('SUPPORT');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (name.trim().length < 2) { setErrors({ name: 'Saisissez le nom (2 caractères minimum).' }); return; }
    if (!phone.trim()) { setErrors({ phone: 'Saisissez un numéro mobile sénégalais.' }); return; }
    setBusy(true); setGeneral('');
    try {
      const out = await apiService.createTeamMember({ name: name.trim(), phone: phone.trim(), role });
      setName(''); setPhone(''); setRole('SUPPORT'); setErrors({});
      onCreated(out.member, out.passcode);
    } catch (e) {
      onAuthError(e);
      if (e instanceof ApiError && (e.field === 'name' || e.field === 'phone')) setErrors({ [e.field]: errorText(e) }); else setGeneral(errorText(e));
    } finally { setBusy(false); }
  };

  return (
    <Drawer open={open} onClose={onClose} title="Ajouter un membre" subtitle="Un code personnel sera généré" icon={UserPlus}
      footer={<div className="flex gap-3 pb-4"><button type="button" className="k-btn-ghost flex-1" onClick={onClose}>Annuler</button><button type="submit" form="team-form" className="k-btn-accent flex-1" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Créer le compte</button></div>}>
      <form id="team-form" onSubmit={submit} className="space-y-4" noValidate>
        {general && <ErrorBanner message={general} />}
        <Field label="Nom" htmlFor="team-name" required error={errors.name}><TextInput id="team-name" value={name} onChange={(e) => { setName(e.target.value); setErrors({}); }} invalid={Boolean(errors.name)} maxLength={80} /></Field>
        <Field label="Téléphone mobile" htmlFor="team-phone" required error={errors.phone} hint="C’est l’identifiant de connexion. Exemple : 77 123 45 67."><TextInput id="team-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setErrors({}); }} invalid={Boolean(errors.phone)} /></Field>
        <Field label="Rôle" htmlFor="team-role" hint={ROLE_HINT[role]}>
          <select id="team-role" className="k-input" value={role} onChange={(e) => setRole(e.target.value as AdminRoleId)}>{ADMIN_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
        </Field>
      </form>
    </Drawer>
  );
};

export const TeamPanel: React.FC<{ adminProfile: AdminProfile | null; onAuthError: (e: unknown) => void }> = ({ adminProfile, onAuthError }) => {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { data, loading, error, reload } = useLoad(() => apiService.fetchTeam(), onAuthError);
  const [adding, setAdding] = useState(false);
  const [shown, setShown] = useState<{ title: string; name: string; phone: string | null; code: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const members = data ?? [];

  const run = async (m: TeamMember, action: () => Promise<void>, done: string) => {
    setBusyId(m.id);
    try { await action(); toast.success(done, m.name); await reload(); } catch (e) { onAuthError(e); toast.error('Action refusée', errorText(e)); } finally { setBusyId(null); }
  };

  const toggle = async (m: TeamMember) => {
    if (!m.disabled && !(await confirm({ title: `Suspendre ${m.name} ?`, message: 'Sa session est coupée tout de suite et il ne peut plus se connecter. Vous pourrez le réactiver.', confirmLabel: 'Suspendre', danger: true }))) return;
    await run(m, () => apiService.updateTeamMember(m.id, { disabled: !m.disabled }), m.disabled ? 'Membre réactivé' : 'Membre suspendu');
  };

  const reset = async (m: TeamMember) => {
    if (!(await confirm({ title: `Nouveau code pour ${m.name} ?`, message: 'L’ancien code ne fonctionne plus et ses sessions ouvertes sont coupées.', confirmLabel: 'Générer un nouveau code', danger: true }))) return;
    setBusyId(m.id);
    try { const code = await apiService.resetTeamPasscode(m.id); setShown({ title: 'Nouveau code personnel', name: m.name, phone: m.phone, code }); toast.success('Code régénéré', m.name); } catch (e) { onAuthError(e); toast.error('Action refusée', errorText(e)); } finally { setBusyId(null); }
  };

  const resetTwoFactor = async (m: TeamMember) => {
    if (!(await confirm({ title: `Réinitialiser la double authentification de ${m.name} ?`, message: 'À faire si la personne a perdu son téléphone et ses codes de secours. Ses sessions sont coupées ; elle pourra la réactiver depuis « Sécurité ».', confirmLabel: 'Réinitialiser', danger: true }))) return;
    await run(m, () => apiService.resetTeamTwoFactor(m.id), 'Double authentification réinitialisée');
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={ShieldCheck} title="Équipe & accès" subtitle="Les personnes qui utilisent ce tableau de bord, et ce que leur rôle leur permet d’ouvrir." onRefresh={reload} refreshing={loading}
        actions={<button type="button" className="k-btn-accent" onClick={() => setAdding(true)}><UserPlus className="h-4 w-4" aria-hidden="true" />Ajouter un membre</button>} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {data && usableSupers(members) < 2 && (
        <p role="status" className="rounded-k-md border border-kraveo-status-placed/40 bg-kraveo-status-placed/10 px-4 py-3 text-sm text-kraveo-ink">
          <b>Un seul accès super admin.</b> Si cette personne perd son téléphone et ses codes de secours, la récupération se fait depuis le serveur. Ajoutez un second super admin (rôle « Super admin ») pour pouvoir vous dépanner l’un l’autre.
        </p>
      )}
      {loading && !data && <SkeletonCard lines={3} />}
      {data && members.length === 0 && <div className="k-card p-6"><EmptyState icon={ShieldCheck} title="Aucun membre" description="Ajoutez les personnes de l’équipe avec leur rôle." /></div>}
      {members.length > 0 && (
        <ul className="k-card divide-y divide-kraveo-line/60 overflow-hidden">
          {members.map((m) => {
            const mine = m.id === adminProfile?.id;
            const locked = m.isOwner || mine;
            return (
              <li key={m.id} className="flex flex-col gap-3 px-4 py-3 text-sm lg:flex-row lg:items-center lg:justify-between">
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2"><span className="truncate font-bold text-kraveo-ink">{m.name}</span>{mine && <Pill tone="blue">Vous</Pill>}{m.isOwner && <Pill tone="grey">Propriétaire</Pill>}{m.dormant && <Pill tone="amber">Sans code</Pill>}{m.disabled && <Pill tone="red">Suspendu</Pill>}{m.twoFactor && <Pill tone="green">Double authentification</Pill>}</span>
                  <span className="block truncate text-xs text-kraveo-ink3">{m.phone ?? 'Pas de téléphone'} · {m.isOwner ? 'code d’accès général' : m.dormant ? 'ancien compte : donnez-lui un code pour qu’il puisse se connecter' : m.lastLoginAt ? `dernière connexion ${dateTime(m.lastLoginAt)}` : 'jamais connecté'}</span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-2">
                  {m.isOwner || mine ? <Pill tone="green">{ROLE_LABEL[m.role as AdminRoleId] ?? m.role}</Pill> : (
                    <select aria-label={`Rôle de ${m.name}`} className="k-input !w-auto !min-h-[36px] py-1 text-sm" value={m.role} disabled={busyId === m.id}
                      onChange={(e) => run(m, () => apiService.updateTeamMember(m.id, { role: e.target.value }), 'Rôle modifié')}>
                      {ADMIN_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                  )}
                  {m.twoFactor && !mine && <button type="button" className="k-btn-ghost !min-h-[36px] text-xs" disabled={busyId === m.id} onClick={() => resetTwoFactor(m)}><ShieldOff className="h-3.5 w-3.5" aria-hidden="true" />Réinitialiser la 2FA</button>}
                  {!m.isOwner && !mine && <button type="button" className="k-btn-ghost !min-h-[36px] text-xs" disabled={busyId === m.id} onClick={() => reset(m)}><KeyRound className="h-3.5 w-3.5" aria-hidden="true" />{m.dormant ? 'Donner un code' : 'Nouveau code'}</button>}
                  {!locked && !m.dormant && <button type="button" className={`${m.disabled ? 'k-btn-accent' : 'k-btn-ghost'} !min-h-[36px] text-xs`} disabled={busyId === m.id} onClick={() => toggle(m)}>{m.disabled ? 'Réactiver' : 'Suspendre'}</button>}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <section className="k-card space-y-3 p-4 sm:p-5" aria-label="Ce que chaque rôle ouvre">
        <h2 className="font-display text-base font-bold text-kraveo-ink">Ce que chaque rôle ouvre</h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {ADMIN_ROLES.map((r) => (
            <li key={r} className="k-inset px-4 py-3">
              <p className="font-bold text-kraveo-ink">{ROLE_LABEL[r]}</p>
              <p className="text-xs text-kraveo-ink3">{ROLE_HINT[r]}</p>
              <p className="mt-2 flex flex-wrap gap-1">{(Object.entries(ROLE_ACCESS[r]) as Array<[PermissionGroup, 'read' | 'write']>).map(([g, level]) => <Pill key={g} tone={level === 'write' ? 'green' : 'grey'}>{GROUP_LABEL[g]} · {level === 'write' ? 'modifie' : 'consulte'}</Pill>)}</p>
            </li>
          ))}
        </ul>
        <p className="text-xs text-kraveo-ink3">« Consulte » = lecture seule : le serveur refuse toute modification. Les droits sont vérifiés par le serveur à chaque appel, pas seulement dans le menu. Le propriétaire se connecte avec le code d’accès général et garde tous les droits.</p>
      </section>

      <AddMemberDrawer open={adding} onClose={() => setAdding(false)} onAuthError={onAuthError}
        onCreated={(member, code) => { setAdding(false); setShown({ title: 'Compte créé', name: member?.name ?? '', phone: member?.phone ?? null, code }); reload(); }} />
      {shown && <CodeDialog {...shown} onClose={() => setShown(null)} />}
      {dialog}
    </div>
  );
};
