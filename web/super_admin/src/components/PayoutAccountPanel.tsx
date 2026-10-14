import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BadgeCheck, Eye, Landmark, Loader2, Pencil, TriangleAlert, X } from 'lucide-react';
import { apiService } from '../services/api';
import { PayoutAccount, RevealedAccount, istDateTime } from '../lib/financeParse';
import { validatePayoutAccount } from '../lib/financeInput';
import { Field } from './ui/Field';
import { Skeleton } from './ui/Skeleton';
import { Switch } from './ui/Switch';
import { useConfirm } from './ui/ConfirmDialog';
import { useToast } from './ui/Toast';

interface Props {
  /** The owner's / rider's login id (`Vendor.userId`, `DriverPartner.userId`). null = this restaurant has no owner login. */
  userId: string | null | undefined;
  /** Shown in labels and confirm texts, e.g. the restaurant or rider name. */
  name: string;
  kind: 'restaurant' | 'rider';
  /** When given (even null) the panel starts from it instead of fetching (the settlement detail already has the live account). */
  initial?: PayoutAccount | null;
  allowEdit?: boolean;
  onAuthError?: (error: unknown) => void;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; account: PayoutAccount | null };
const plain = (error: unknown): string => (error instanceof Error ? error.message : 'Un problème est survenu. Veuillez réessayer.');

/** The full number is shown for at most this long, then hidden even if the admin walked away. */
const REVEAL_VISIBLE_MS = 60_000;

const FOCUSABLE = 'button:not([disabled])';

/**
 * The full account number, in its own dialog. The number lives ONLY in this component's props while it is mounted; closing unmounts it.
 * Esc / Tab are handled on `window` in the capture phase so a drawer underneath never sees them.
 */
const RevealDialog: React.FC<{ title: string; revealed: RevealedAccount; onClose: () => void }> = ({ title, revealed, onClose }) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    closeRef.current?.focus();
    const timer = window.setTimeout(() => onCloseRef.current(), REVEAL_VISIBLE_MS);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (nodes.length === 0) return;
      event.stopPropagation();
      event.preventDefault();
      nodes[0].focus();
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.clearTimeout(timer); window.removeEventListener('keydown', onKey, true); };
  }, []);

  const rows: Array<[string, string | null]> = [
    ['Titulaire du compte', revealed.accountHolder],
    ['Numéro de compte', revealed.accountNumber],
    ['IFSC', revealed.ifsc],
    ['Banque', revealed.bankName],
    ['Identifiant UPI', revealed.upiId],
  ];
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="relative w-full max-w-sm rounded-k-xl border border-kraveo-line bg-kraveo-surface p-5 shadow-k-lift">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="font-display text-lg font-bold text-kraveo-ink">{title}</h2>
          <button ref={closeRef} type="button" className="k-icon-btn !h-9 !w-9" aria-label="Fermer et masquer le numéro de compte" onClick={onClose}><X className="h-4 w-4" aria-hidden="true" /></button>
        </div>
        <dl className="mt-4 space-y-2.5 text-sm">
          {rows.filter(([, value]) => value).map(([label, value]) => (
            <div key={label}>
              <dt className="k-label">{label}</dt>
              <dd className="break-all font-bold tabular-nums text-kraveo-ink" data-testid={label === 'Numéro de compte' ? 'revealed-number' : undefined}>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-kraveo-ink3">Cet affichage a été inscrit au journal d’audit. Il se masque à la fermeture de cette fenêtre. Ne le collez pas dans des discussions.</p>
        <button type="button" className="k-btn-primary mt-4 w-full" onClick={onClose}>Fermer et masquer</button>
      </div>
    </div>,
    document.body,
  );
};

interface Form { method: 'UPI' | 'BANK'; upiId: string; accountHolder: string; accountNumber: string; ifsc: string; bankName: string }
const emptyForm = (account: PayoutAccount | null): Form => ({
  method: account?.method === 'BANK' ? 'BANK' : 'UPI', upiId: account?.upiId ?? '', accountHolder: account?.accountHolder ?? '',
  accountNumber: '', // the stored number is never sent to the browser: it has to be typed again to change it
  ifsc: account?.ifsc ?? '', bankName: account?.bankName ?? '',
});

/** Payout details (UPI or bank) of a restaurant owner or a rider: masked view, verify, edit and an audited "reveal". */
export const PayoutAccountPanel: React.FC<Props> = ({ userId, name, kind, initial, allowEdit = true, onAuthError }) => {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const uid = useId();
  const [load, setLoad] = useState<Load>(() => (initial !== undefined ? { status: 'ready', account: initial } : { status: 'loading' }));
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<Form>(() => emptyForm(null));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'verify' | 'reveal'>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<RevealedAccount | null>(null);
  const initialRef = useRef(initial);

  useEffect(() => {
    // a different person: nothing of the previous one may stay (least of all a revealed number)
    setRevealed(null); setEditing(false); setError(''); setTouched(false);
    if (!userId) { setLoad({ status: 'ready', account: null }); return undefined; }
    if (initialRef.current !== undefined && attempt === 0) { setLoad({ status: 'ready', account: initialRef.current }); return undefined; }
    let cancelled = false;
    setLoad({ status: 'loading' });
    apiService.fetchPayoutAccount(userId)
      .then((result) => { if (!cancelled) setLoad({ status: 'ready', account: result.account }); })
      .catch((failure) => { if (cancelled) return; onAuthError?.(failure); setLoad({ status: 'error', message: plain(failure) }); });
    return () => { cancelled = true; };
  }, [userId, attempt, onAuthError]);

  // Never keep a revealed number once this panel goes away.
  useEffect(() => () => setRevealed(null), []);

  const closeReveal = useCallback(() => setRevealed(null), []);

  if (!userId) {
    return (
      <div className="k-inset flex items-start gap-2 px-3 py-2.5 text-xs text-kraveo-ink2" role="status">
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-kraveo-status-placed" aria-hidden="true" />
        <span>{name} n’a pas de compte propriétaire : il n’y a donc aucune coordonnée de versement à afficher.</span>
      </div>
    );
  }

  const account = load.status === 'ready' ? load.account : null;
  const result = validatePayoutAccount(form);
  const err = (key: string): string | undefined => (touched && !result.ok ? result.errors[key] : undefined);

  const startEdit = () => { setForm(emptyForm(account)); setTouched(false); setError(''); setEditing(true); };

  const save = async () => {
    setTouched(true);
    if (!result.ok || busyRef.current) return;
    busyRef.current = true; setBusy('save'); setError('');
    try {
      const saved = await apiService.savePayoutAccount(userId, result.value);
      setLoad({ status: 'ready', account: saved.account });
      setForm(emptyForm(saved.account)); // clears the typed account number
      setEditing(false);
      toast.success('Coordonnées de versement enregistrées', saved.message || 'Vérifiez-les à nouveau avant le premier versement.');
    } catch (failure) {
      onAuthError?.(failure);
      setError(plain(failure));
    } finally { busyRef.current = false; setBusy(null); }
  };

  const toggleVerified = async () => {
    if (!account || busyRef.current) return;
    busyRef.current = true; setBusy('verify'); setError('');
    try {
      const saved = await apiService.setPayoutVerified(userId, !account.verified);
      if (saved.account) setLoad({ status: 'ready', account: saved.account });
      toast.success(saved.account?.verified ? 'Marqué comme vérifié' : 'Vérification retirée', saved.message || undefined);
    } catch (failure) {
      onAuthError?.(failure);
      setError(plain(failure));
    } finally { busyRef.current = false; setBusy(null); }
  };

  const reveal = async () => {
    if (!account || busyRef.current) return;
    const ok = await confirm({
      title: 'Afficher le numéro de compte complet ?',
      message: `Cela inscrit une ligne au journal d’audit avec votre identifiant admin et affiche une fois le numéro de compte complet de ${name}. Il se masque à la fermeture. Ne l’affichez que pour effectuer un versement.`,
      confirmLabel: 'Afficher et journaliser',
      danger: true,
    });
    if (!ok || busyRef.current) return;
    busyRef.current = true; setBusy('reveal'); setError('');
    try {
      setRevealed(await apiService.revealPayoutAccount(userId));
    } catch (failure) {
      onAuthError?.(failure);
      setError(plain(failure));
    } finally { busyRef.current = false; setBusy(null); }
  };

  const set = (key: keyof Form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => { setForm((f) => ({ ...f, [key]: event.target.value } as Form)); setError(''); };

  return (
    <section className="space-y-3 rounded-k-md border border-kraveo-line bg-kraveo-night/40 px-3 py-3" aria-label={`Coordonnées de versement de ${name}`}>
      <div className="flex items-center justify-between gap-3">
        <h4 className="flex min-w-0 items-center gap-2 text-sm font-bold text-kraveo-ink"><Landmark className="h-4 w-4 shrink-0 text-kraveo-ink3" aria-hidden="true" /><span className="min-w-0 break-words">Coordonnées de versement</span></h4>
        {allowEdit && load.status === 'ready' && !editing && (
          <button type="button" className="k-btn-ghost !min-h-[32px] shrink-0 !px-3 text-xs" onClick={startEdit} aria-label={`${account ? 'Modifier' : 'Ajouter'} les coordonnées de versement de ${name}`}><Pencil className="h-3.5 w-3.5" aria-hidden="true" />{account ? 'Modifier' : 'Ajouter'}</button>
        )}
      </div>

      {load.status === 'loading' && <div role="status" aria-label="Chargement des coordonnées de versement" className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>}
      {load.status === 'error' && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-k-sm border border-kraveo-danger/30 bg-kraveo-danger/10 px-3 py-2 text-xs text-kraveo-ink">
          <span className="min-w-0 break-words">{load.message}</span>
          <button type="button" className="k-btn-ghost !min-h-[32px] shrink-0 !px-3 text-xs" onClick={() => setAttempt((n) => n + 1)}>Réessayer</button>
        </div>
      )}

      {load.status === 'ready' && !account && !editing && (
        <p role="status" className="flex items-start gap-2 rounded-k-sm border border-kraveo-status-placed/40 bg-kraveo-status-placed/10 px-3 py-2 text-xs text-kraveo-ink">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-kraveo-status-placed" aria-hidden="true" />
          <span>Aucune coordonnée de versement. {name} n’a pas encore enregistré d’identifiant UPI ni de compte bancaire : aucun versement n’est possible.</span>
        </p>
      )}

      {load.status === 'ready' && account && !editing && (
        <div className="space-y-3">
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div><dt className="k-label">Moyen</dt><dd className="font-bold text-kraveo-ink">{account.method === 'UPI' ? 'UPI' : account.method === 'BANK' ? 'Compte bancaire' : account.method}</dd></div>
            {account.accountHolder && <div><dt className="k-label">Titulaire du compte</dt><dd className="break-words font-bold text-kraveo-ink">{account.accountHolder}</dd></div>}
            {account.method === 'UPI' && <div><dt className="k-label">Identifiant UPI</dt><dd className="break-all font-bold text-kraveo-ink">{account.upiId ?? '—'}</dd></div>}
            {account.method === 'BANK' && <div><dt className="k-label">Numéro de compte</dt><dd className="break-all font-bold tabular-nums text-kraveo-ink" data-testid="masked-account">{account.accountMasked ?? 'Masqué'}</dd></div>}
            {account.method === 'BANK' && account.ifsc && <div><dt className="k-label">IFSC</dt><dd className="font-bold text-kraveo-ink">{account.ifsc}</dd></div>}
            {account.method === 'BANK' && account.bankName && <div><dt className="k-label">Banque</dt><dd className="break-words font-bold text-kraveo-ink">{account.bankName}</dd></div>}
          </dl>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-kraveo-line pt-3">
            <div className="flex items-center gap-2">
              <Switch checked={account.verified} onChange={toggleVerified} disabled={busy !== null} label={`${name} : coordonnées de versement vérifiées`} />
              <span className="text-xs text-kraveo-ink2">
                {account.verified ? <span className="inline-flex items-center gap-1 font-bold text-kraveo-g700"><BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />Vérifié{account.verifiedAt ? ` le ${istDateTime(account.verifiedAt)}` : ''}</span> : 'Pas encore vérifié'}
              </span>
            </div>
            {account.method === 'BANK' && (
              <button type="button" className="k-btn-danger !min-h-[36px] text-xs" onClick={reveal} disabled={busy !== null} aria-busy={busy === 'reveal'}>
                {busy === 'reveal' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Eye className="h-3.5 w-3.5" aria-hidden="true" />}Afficher le numéro de compte complet
              </button>
            )}
          </div>
          {account.updatedAt && <p className="text-[11px] text-kraveo-ink3">Dernière modification le {istDateTime(account.updatedAt)}</p>}
        </div>
      )}

      {editing && (
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); save(); }} noValidate>
          <Field label="Moyen" htmlFor={`${uid}-method`}>
            <select id={`${uid}-method`} className="k-select" value={form.method} onChange={set('method')} disabled={busy === 'save'}>
              <option value="UPI">Identifiant UPI</option>
              <option value="BANK">Compte bancaire</option>
            </select>
          </Field>
          {form.method === 'UPI' ? (
            <Field label="Identifiant UPI" htmlFor={`${uid}-upi`} required error={err('upiId')}>
              <input id={`${uid}-upi`} className="k-input" value={form.upiId} onChange={set('upiId')} placeholder="name@okhdfcbank" aria-invalid={Boolean(err('upiId'))} aria-describedby={`${uid}-upi-msg`} autoComplete="off" disabled={busy === 'save'} />
            </Field>
          ) : (
            <>
              <Field label="Numéro de compte" htmlFor={`${uid}-number`} required error={err('accountNumber')} hint={account?.method === 'BANK' ? `Le numéro enregistré (${account.accountMasked ?? 'masqué'}) ne peut pas être affiché ici. Saisissez à nouveau le numéro complet pour enregistrer.` : undefined}>
                <input id={`${uid}-number`} className="k-input" inputMode="numeric" value={form.accountNumber} onChange={set('accountNumber')} aria-invalid={Boolean(err('accountNumber'))} aria-describedby={`${uid}-number-msg`} autoComplete="off" disabled={busy === 'save'} />
              </Field>
              <Field label="IFSC" htmlFor={`${uid}-ifsc`} required error={err('ifsc')}>
                <input id={`${uid}-ifsc`} className="k-input" value={form.ifsc} onChange={set('ifsc')} placeholder="HDFC0001234" aria-invalid={Boolean(err('ifsc'))} aria-describedby={`${uid}-ifsc-msg`} autoComplete="off" disabled={busy === 'save'} />
              </Field>
              <Field label="Nom de la banque (facultatif)" htmlFor={`${uid}-bank`} error={err('bankName')}>
                <input id={`${uid}-bank`} className="k-input" value={form.bankName} onChange={set('bankName')} aria-invalid={Boolean(err('bankName'))} aria-describedby={`${uid}-bank-msg`} autoComplete="off" disabled={busy === 'save'} />
              </Field>
            </>
          )}
          <Field label={form.method === 'BANK' ? 'Titulaire du compte' : 'Titulaire du compte (facultatif)'} htmlFor={`${uid}-holder`} required={form.method === 'BANK'} error={err('accountHolder')}>
            <input id={`${uid}-holder`} className="k-input" value={form.accountHolder} onChange={set('accountHolder')} aria-invalid={Boolean(err('accountHolder'))} aria-describedby={`${uid}-holder-msg`} autoComplete="off" disabled={busy === 'save'} />
          </Field>
          <p className="text-xs text-kraveo-ink3">Enregistrer des coordonnées modifiées annule la vérification. Vérifiez-les à nouveau ensuite.</p>
          {error && <p role="alert" className="break-words rounded-k-sm border border-kraveo-danger/30 bg-kraveo-danger/10 px-3 py-2 text-xs text-kraveo-ink">{error}</p>}
          <div className="flex gap-2">
            <button type="submit" className="k-btn-primary !min-h-[36px] text-xs" disabled={busy === 'save'} aria-busy={busy === 'save'}>{busy === 'save' && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}Enregistrer les coordonnées</button>
            <button type="button" className="k-btn-ghost !min-h-[36px] text-xs" onClick={() => { setEditing(false); setForm(emptyForm(account)); setError(''); }} disabled={busy === 'save'}>Annuler</button>
          </div>
        </form>
      )}

      {!editing && error && <p role="alert" className="break-words rounded-k-sm border border-kraveo-danger/30 bg-kraveo-danger/10 px-3 py-2 text-xs text-kraveo-ink">{error}</p>}
      {revealed && <RevealDialog title={`Compte de ${name}`} revealed={revealed} onClose={closeReveal} />}
      {dialog}
    </section>
  );
};
