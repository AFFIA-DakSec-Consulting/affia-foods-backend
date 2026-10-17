import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Clock3, Loader2, LogOut, Mail, MapPin, Pencil, RefreshCw, Send, ShieldAlert, Store, TriangleAlert } from 'lucide-react';
import { ApiError, apiService } from '../services/api';
import { isSessionRejected } from '../lib/adminMessages';
import { AuthShell } from './ui/AuthShell';
import { Field } from './ui/Field';
import { CATEGORIES, FieldErrors, PartnerSession, frenchServerMessage, validateRestaurant } from '../lib/partnerSignup';

interface Props {
  session: PartnerSession;
  /** A fresher answer from the server (status changed, application re-sent). */
  onSession: (session: PartnerSession) => void;
  onLogout: () => void;
}

const POLL_MS = 20_000;
export const SUPPORT_EMAIL = 'support@affiafoods.com';

const Step: React.FC<{ done?: boolean; active?: boolean; title: string; text: string }> = ({ done, active, title, text }) => (
  <li className="flex gap-3">
    <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${done ? 'bg-kraveo-g600 text-white' : active ? 'bg-kraveo-yellow/25 text-kraveo-ink ring-2 ring-kraveo-yellow' : 'bg-kraveo-surface2 text-kraveo-ink3'}`}>
      {done ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : active ? <Clock3 className="h-4 w-4" aria-hidden="true" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
    </span>
    <span><span className={`block text-sm font-semibold ${done || active ? 'text-kraveo-ink' : 'text-kraveo-ink3'}`}>{title}</span><span className="block text-xs text-kraveo-ink3">{text}</span></span>
  </li>
);

/** Editing the application: same fields as the sign-up's second step. */
const ApplicationEditor: React.FC<{ session: PartnerSession; resend: boolean; onSaved: (s: PartnerSession) => void; onCancel?: () => void }> = ({ session, resend, onSaved, onCancel }) => {
  const app = session.application;
  const [form, setForm] = useState({ restaurantName: app?.restaurantName ?? '', category: app?.category ?? '', address: app?.address ?? '', ninea: app?.ninea ?? '' });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key: keyof typeof form) => (value: string) => { setForm((f) => ({ ...f, [key]: value })); setErrors({}); setError(''); };
  const categories = form.category && !(CATEGORIES as readonly string[]).includes(form.category) ? [form.category, ...CATEGORIES] : CATEGORIES;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validateRestaurant(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    setBusy(true); setError('');
    try {
      onSaved(await apiService.resubmitApplication({
        restaurantName: form.restaurantName.trim(), category: form.category.trim(), address: form.address.trim(), fssaiNumber: form.ninea.replace(/[\s.-]/g, ''),
      }));
    } catch (err) {
      setBusy(false);
      const message = err instanceof ApiError ? frenchServerMessage(err.message) : 'Envoi impossible. Réessayez.';
      if (err instanceof ApiError && err.field && ['restaurantName', 'category', 'address', 'fssaiNumber'].includes(err.field)) setErrors({ [err.field]: message });
      else setError(message);
    }
  };

  return (
    <form onSubmit={submit} className="mt-5 space-y-4" noValidate aria-label="Modifier mon dossier">
      {error && <p role="alert" className="rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 p-3 text-sm text-kraveo-ink">{error}</p>}
      <Field label="Nom du restaurant" htmlFor="ap-name" error={errors.restaurantName} required><input id="ap-name" className="k-input" value={form.restaurantName} onChange={(e) => set('restaurantName')(e.target.value)} aria-invalid={Boolean(errors.restaurantName)} /></Field>
      <Field label="Type de cuisine" htmlFor="ap-category" error={errors.category} required>
        <select id="ap-category" className="k-select" value={form.category} onChange={(e) => set('category')(e.target.value)}>
          <option value="">Choisir…</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Adresse de la cuisine" htmlFor="ap-address" error={errors.address} required><input id="ap-address" className="k-input" value={form.address} onChange={(e) => set('address')(e.target.value)} aria-invalid={Boolean(errors.address)} /></Field>
      <Field label="NINEA (facultatif)" htmlFor="ap-ninea" error={errors.fssaiNumber}><input id="ap-ninea" className="k-input" value={form.ninea} onChange={(e) => set('ninea')(e.target.value)} aria-invalid={Boolean(errors.fssaiNumber)} /></Field>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="k-btn-accent !min-h-[46px]" aria-busy={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          {resend ? 'Renvoyer mon dossier' : 'Enregistrer les modifications'}
        </button>
        {onCancel && <button type="button" onClick={onCancel} disabled={busy} className="k-btn-ghost !min-h-[46px]">Annuler</button>}
      </div>
    </form>
  );
};

/** What a restaurant sees until the team has approved it: the state of its application, and how to fix it when refused. */
export const PartnerPendingScreen: React.FC<Props> = ({ session, onSession, onLogout }) => {
  const [checking, setChecking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [sentNote, setSentNote] = useState(false);
  const status = session.approvalStatus;
  const app = session.application;

  const refresh = useCallback(async (manual = false) => {
    if (manual) setChecking(true);
    try {
      onSession(await apiService.fetchPartnerMe());
    } catch (err) {
      if (isSessionRejected(err)) onLogout(); // password reset by the team, or account closed: back to the sign-in
    } finally {
      if (manual) setChecking(false);
    }
  }, [onSession, onLogout]);

  useEffect(() => {
    if (status === 'APPROVED') return undefined;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [status, refresh]);

  const rejected = status === 'REJECTED';
  const suspended = status === 'SUSPENDED';

  return (
    <AuthShell
      title={rejected ? <>Votre dossier<br />a besoin<br /><span className="text-kraveo-yellow">d’une correction.</span></> : suspended ? <>Votre compte<br />est <span className="text-kraveo-yellow">suspendu.</span></> : <>Merci !<br />Nous examinons<br /><span className="text-kraveo-yellow">votre dossier.</span></>}
      lead={rejected ? 'Lisez le motif, corrigez ce qui doit l’être et renvoyez votre dossier.' : suspended ? 'Contactez l’équipe pour comprendre la situation.' : 'L’équipe Affia Foods vérifie vos informations. Vous pouvez fermer cette page : revenez vous connecter quand vous voulez.'}
      wide
    >
      <div className="k-card animate-scale-in p-6 sm:p-8">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${rejected || suspended ? 'bg-kraveo-danger/10 text-kraveo-danger' : 'bg-kraveo-yellow/20 text-kraveo-ink'}`}>
              {rejected || suspended ? <ShieldAlert className="h-6 w-6" aria-hidden="true" /> : <Clock3 className="h-6 w-6" aria-hidden="true" />}
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-extrabold tracking-tight text-kraveo-ink">{rejected ? 'Dossier refusé' : suspended ? 'Compte suspendu' : 'Dossier en cours d’examen'}</h1>
              <p className="truncate text-sm text-kraveo-ink3">{session.user.name}{session.user.phone ? ` · ${session.user.phone}` : ''}</p>
            </div>
          </div>
          <button type="button" onClick={onLogout} className="k-icon-btn shrink-0" aria-label="Se déconnecter" title="Se déconnecter"><LogOut className="h-4 w-4" aria-hidden="true" /></button>
        </div>

        {rejected && (
          <div role="alert" className="mt-5 rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 p-4 text-sm text-kraveo-ink">
            <p className="flex items-center gap-2 font-semibold"><TriangleAlert className="h-4 w-4 text-kraveo-danger" aria-hidden="true" />Motif donné par l’équipe</p>
            <p className="mt-1.5">{session.rejectionReason ?? 'Aucun motif n’a été précisé. Contactez le support.'}</p>
          </div>
        )}
        {suspended && <p className="mt-5 text-sm text-kraveo-ink2">Votre restaurant n’apparaît plus aux clients. Écrivez-nous pour le réactiver.</p>}

        {!rejected && !suspended && (
          <ol className="mt-6 space-y-4" aria-label="Avancement du dossier">
            <Step done title="Demande reçue" text="Votre inscription est bien enregistrée." />
            <Step active title="Vérification par l’équipe" text="Nous contrôlons vos informations et pouvons vous appeler pour une précision." />
            <Step title="Décision" text="Approuvé : vous accédez à vos commandes. Sinon, nous vous disons pourquoi." />
          </ol>
        )}

        {app && !editing && (
          <dl className="mt-6 divide-y divide-kraveo-line rounded-k-md border border-kraveo-line text-sm">
            <div className="flex items-center gap-3 px-4 py-3"><Store className="h-4 w-4 shrink-0 text-kraveo-ink3" aria-hidden="true" /><dt className="sr-only">Restaurant</dt><dd className="min-w-0"><span className="font-semibold text-kraveo-ink">{app.restaurantName}</span><span className="text-kraveo-ink3"> · {app.category}</span></dd></div>
            <div className="flex items-center gap-3 px-4 py-3"><MapPin className="h-4 w-4 shrink-0 text-kraveo-ink3" aria-hidden="true" /><dt className="sr-only">Adresse</dt><dd className="min-w-0 text-kraveo-ink2">{app.address}{session.vendor?.hasLocation ? ' · position envoyée' : ''}</dd></div>
            <div className="flex items-center gap-3 px-4 py-3"><span className="w-4 shrink-0 text-center text-[10px] font-bold text-kraveo-ink3">N°</span><dt className="sr-only">NINEA</dt><dd className="text-kraveo-ink2">{app.ninea ? `NINEA ${app.ninea}` : 'NINEA non renseigné (vous pourrez l’ajouter)'}</dd></div>
          </dl>
        )}

        {sentNote && !editing && !rejected && <p role="status" className="mt-4 rounded-k-md bg-kraveo-g500/10 p-3 text-sm font-semibold text-kraveo-g700">Modifications envoyées à l’équipe.</p>}

        {(rejected || editing) && !suspended && app && (
          <ApplicationEditor
            session={session}
            resend={rejected}
            onSaved={(s) => { onSession(s); setEditing(false); setSentNote(true); }}
            onCancel={editing ? () => setEditing(false) : undefined}
          />
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {!rejected && !suspended && !editing && (
            <button type="button" onClick={() => { setEditing(true); setSentNote(false); }} className="k-btn-ghost !min-h-[44px]"><Pencil className="h-4 w-4" aria-hidden="true" />Modifier mon dossier</button>
          )}
          <button type="button" onClick={() => refresh(true)} disabled={checking} className="k-btn-ghost !min-h-[44px]" aria-busy={checking}><RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} aria-hidden="true" />Vérifier l’état</button>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="k-btn-ghost !min-h-[44px]"><Mail className="h-4 w-4" aria-hidden="true" />Contacter le support</a>
        </div>
      </div>
    </AuthShell>
  );
};
