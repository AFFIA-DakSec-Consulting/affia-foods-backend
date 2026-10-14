import React, { useRef, useState } from 'react';
import { Download, Landmark, Loader2, Pause, Play, Plus, Wallet, XCircle } from 'lucide-react';
import { apiService } from '../services/api';
import { Settlement, SettlementAction, SettlementDetail, STATUS_LABEL, isSettlementStatus, istDateTime, istToday, rupeesSigned } from '../lib/financeParse';
import { MarkPaidInput, newRequestId, validateAdjustment, validateHold, validateMarkPaid } from '../lib/financeInput';
import { saveBlob } from '../lib/download';
import { rupees } from '../lib/pricing';
import { Drawer } from './ui/Drawer';
import { Field } from './ui/Field';
import { Skeleton } from './ui/Skeleton';
import { useConfirm } from './ui/ConfirmDialog';
import { useToast } from './ui/Toast';
import { ErrorNote, ScrollTable, Td, Th, plainError, useLoad } from './FinanceCommon';
import { PayoutAccountPanel } from './PayoutAccountPanel';

const BADGE: Record<string, string> = {
  PENDING: 'bg-kraveo-status-placed/15 text-kraveo-status-placed',
  ON_HOLD: 'bg-kraveo-ink3/20 text-kraveo-ink2',
  PAID: 'bg-kraveo-g500/10 text-kraveo-g700',
  CANCELLED: 'bg-kraveo-danger/15 text-kraveo-danger',
};

export const SettlementStatusBadge: React.FC<{ status: string }> = ({ status }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${BADGE[status] ?? 'bg-kraveo-surface2 text-kraveo-ink2'}`}>{isSettlementStatus(status) ? STATUS_LABEL[status] : status}</span>
);

interface Props {
  settlementId: string;
  /** The row that was clicked: gives the drawer a title while the detail loads. */
  preview: Settlement;
  onClose: () => void;
  /** Something changed on the server: reload the list and the sidebar badge. */
  onChanged: () => void;
  onAuthError: (error: unknown) => void;
}

type Mode = null | 'pay' | 'hold' | 'adjust';

const Total: React.FC<{ label: string; value: string; strong?: boolean }> = ({ label, value, strong }) => (
  <div className={`k-inset px-3 py-2.5 ${strong ? 'border-kraveo-g400/50' : ''}`}>
    <p className="k-label !text-[10px]">{label}</p>
    <p className={`k-num break-words ${strong ? 'text-xl text-kraveo-g700' : 'text-lg text-kraveo-ink'}`}>{value}</p>
  </div>
);

export const SettlementDrawer: React.FC<Props> = ({ settlementId, preview, onClose, onChanged, onAuthError }) => {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const detail = useLoad<SettlementDetail>(() => apiService.fetchSettlement(settlementId), [settlementId], onAuthError);
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const [payForm, setPayForm] = useState({ reference: '', paidDate: '', note: '' });
  const [holdNote, setHoldNote] = useState('');
  const [adjForm, setAdjForm] = useState({ amount: '', reason: '' });
  const requestId = useRef(newRequestId());

  const s = detail.data?.settlement ?? preview;
  const status = s.status;
  const canPay = status === 'PENDING' && s.netPayable > 0;
  const open = (next: Mode) => { setMode(next); setTouched(false); setError(''); };

  /** Runs one action once (double clicks are ignored), then reloads the detail and the list. */
  const run = async (name: string, action: () => Promise<SettlementAction>, done: (result: SettlementAction) => { title: string; text?: string }): Promise<boolean> => {
    if (busyRef.current) return false;
    busyRef.current = true; setBusy(name); setError('');
    try {
      const result = await action();
      const note = done(result);
      toast.success(note.title, note.text || result.message || undefined);
      detail.reload();
      onChanged();
      return true;
    } catch (failure) {
      onAuthError(failure);
      setError(plainError(failure));
      return false;
    } finally { busyRef.current = false; setBusy(null); }
  };

  const payCheck = validateMarkPaid(payForm);
  const submitPay = async () => {
    setTouched(true);
    if (!payCheck.ok || busyRef.current) return;
    const input: MarkPaidInput = payCheck.value;
    const ok = await confirm({
      title: `Marquer ${rupees(s.netPayable)} comme payé ?`,
      message: `Vous confirmez que ${s.vendorName} a reçu ${rupees(s.netPayable)} avec la référence ${input.reference}. Le restaurant le voit comme payé. Un règlement payé ne peut être ni annulé ni modifié.`,
      confirmLabel: 'Marquer comme payé',
    });
    if (!ok) return;
    const done = await run('pay', () => apiService.markSettlementPaid(settlementId, input), (r) => ({ title: r.changed ? 'Marqué comme payé' : 'Déjà payé', text: `Référence ${r.settlement?.paymentReference ?? input.reference}. ${r.message}` }));
    if (done) { setMode(null); setPayForm({ reference: '', paidDate: '', note: '' }); }
  };

  const holdCheck = validateHold(holdNote);
  const submitHold = async () => {
    setTouched(true);
    if (!holdCheck.ok) return;
    const input = holdCheck.value;
    const done = await run('hold', () => apiService.holdSettlement(settlementId, input), (r) => ({ title: r.changed ? 'Règlement suspendu' : 'Déjà suspendu' }));
    if (done) { setMode(null); setHoldNote(''); }
  };

  const adjCheck = validateAdjustment(adjForm, detail.data ? { vendorAmount: s.vendorAmount, adjustmentTotal: s.adjustmentTotal } : undefined);
  const submitAdjust = async () => {
    setTouched(true);
    if (!adjCheck.ok) return;
    const input = { ...adjCheck.value, requestId: requestId.current };
    const done = await run('adjust', () => apiService.addSettlementAdjustment(settlementId, input), (r) => ({ title: r.changed ? 'Ajustement ajouté' : 'Ajustement déjà ajouté' }));
    if (done) { setMode(null); setAdjForm({ amount: '', reason: '' }); requestId.current = newRequestId(); }
  };

  const release = () => { run('release', () => apiService.releaseSettlement(settlementId), (r) => ({ title: r.changed ? 'Règlement repris' : 'Il n’était pas suspendu' })); };

  const cancel = async () => {
    if (busyRef.current) return;
    const ok = await confirm({
      title: 'Annuler ce règlement ?',
      message: `Les commandes incluses (${s.orderCount}) redeviennent non réglées et seront reprises au prochain règlement (ou via « Créer les règlements maintenant »). Les ajustements restent sur ce règlement annulé et ne sont pas reportés. Rien n’est payé.`,
      confirmLabel: 'Annuler le règlement',
      cancelLabel: 'Le garder',
      danger: true,
    });
    if (!ok) return;
    await run('cancel', () => apiService.cancelSettlement(settlementId), (r) => ({ title: r.changed ? 'Règlement annulé' : 'Déjà annulé', text: r.freedOrders !== null ? `${r.freedOrders} ${r.freedOrders === 1 ? 'commande redevient non réglée' : 'commandes redeviennent non réglées'}.` : r.message }));
  };

  const exportCsv = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('csv'); setError('');
    try {
      const file = await apiService.downloadSettlementCsv(settlementId);
      saveBlob(file.blob, file.filename);
      toast.success('CSV téléchargé', file.filename);
    } catch (failure) {
      onAuthError(failure);
      setError(plainError(failure));
    } finally { busyRef.current = false; setBusy(null); }
  };

  const d = detail.data;
  const snap = s.payoutSnapshot;
  const anyBusy = busy !== null;
  const showError = (key: string, errors: Record<string, string> | null) => (touched && errors ? errors[key] : undefined);
  const payErrors = payCheck.ok ? null : payCheck.errors;
  const holdErrors = holdCheck.ok ? null : holdCheck.errors;
  const adjErrors = adjCheck.ok ? null : adjCheck.errors;

  return (
    <Drawer
      open
      onClose={onClose}
      title={s.vendorName}
      subtitle={`Règlement ${s.id.slice(0, 8)} · ${s.orderCount} ${s.orderCount === 1 ? 'commande' : 'commandes'}`}
      icon={Wallet}
      wide
      focusFirstField={false}
      footer={(
        <div className="flex flex-wrap items-center gap-2 pb-4" role="group" aria-label="Actions du règlement">
          {status === 'PENDING' && <button type="button" className="k-btn-primary" onClick={() => open('pay')} disabled={anyBusy || !canPay} title={canPay ? undefined : 'Le montant à payer n’est pas supérieur à 0'}><Wallet className="h-4 w-4" aria-hidden="true" />Marquer payé</button>}
          {status === 'PENDING' && <button type="button" className="k-btn-ghost" onClick={() => open('hold')} disabled={anyBusy}><Pause className="h-4 w-4" aria-hidden="true" />Suspendre</button>}
          {status === 'ON_HOLD' && <button type="button" className="k-btn-primary" onClick={release} disabled={anyBusy} aria-busy={busy === 'release'}>{busy === 'release' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}Reprendre</button>}
          {(status === 'PENDING' || status === 'ON_HOLD') && <button type="button" className="k-btn-ghost" onClick={() => open('adjust')} disabled={anyBusy}><Plus className="h-4 w-4" aria-hidden="true" />Ajouter un ajustement</button>}
          {(status === 'PENDING' || status === 'ON_HOLD') && <button type="button" className="k-btn-danger" onClick={cancel} disabled={anyBusy} aria-busy={busy === 'cancel'}><XCircle className="h-4 w-4" aria-hidden="true" />Annuler le règlement</button>}
          <button type="button" className="k-btn-ghost" onClick={exportCsv} disabled={anyBusy} aria-busy={busy === 'csv'}>{busy === 'csv' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}Télécharger le CSV</button>
        </div>
      )}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <SettlementStatusBadge status={status} />
          <span className="text-xs text-kraveo-ink3">Créé le {istDateTime(s.createdAt) || '—'}{s.createdBy === 'AUTO' ? ' par la tâche quotidienne' : ''}</span>
        </div>

        {error && <p role="alert" className="break-words rounded-k-sm border border-kraveo-danger/30 bg-kraveo-danger/10 px-3 py-2 text-sm text-kraveo-ink">{error}</p>}
        {status === 'ON_HOLD' && <p role="status" className="rounded-k-sm border border-kraveo-status-placed/40 bg-kraveo-status-placed/10 px-3 py-2 text-sm text-kraveo-ink">Suspendu. Reprenez-le avant de le marquer payé.{s.note ? ` Note : ${s.note}` : ''}</p>}

        {mode === 'pay' && (
          <form className="k-inset space-y-3 p-4" aria-label="Marquer comme payé" noValidate onSubmit={(event) => { event.preventDefault(); submitPay(); }}>
            <p className="text-sm text-kraveo-ink2">Payez d’abord {rupees(s.netPayable)} à {s.vendorName} par virement ou UPI, puis enregistrez ici la référence de la transaction.</p>
            <Field label="Référence du virement ou UPI" htmlFor="settle-reference" required error={showError('reference', payErrors)} hint="3 à 64 caractères.">
              <input id="settle-reference" className="k-input" value={payForm.reference} onChange={(e) => setPayForm((f) => ({ ...f, reference: e.target.value }))} maxLength={80} aria-invalid={Boolean(showError('reference', payErrors))} aria-describedby="settle-reference-msg" autoComplete="off" />
            </Field>
            <Field label="Payé le (facultatif, date IST)" htmlFor="settle-paid-date" error={showError('paidDate', payErrors)} hint="Laissez vide pour maintenant.">
              <input id="settle-paid-date" type="date" className="k-input" value={payForm.paidDate} max={istToday()} onChange={(e) => setPayForm((f) => ({ ...f, paidDate: e.target.value }))} aria-invalid={Boolean(showError('paidDate', payErrors))} aria-describedby="settle-paid-date-msg" />
            </Field>
            <Field label="Note (facultatif)" htmlFor="settle-note" error={showError('note', payErrors)}>
              <textarea id="settle-note" className="k-input min-h-[72px] py-2" value={payForm.note} onChange={(e) => setPayForm((f) => ({ ...f, note: e.target.value }))} aria-invalid={Boolean(showError('note', payErrors))} aria-describedby="settle-note-msg" />
            </Field>
            <div className="flex gap-2">
              <button type="submit" className="k-btn-primary" disabled={anyBusy} aria-busy={busy === 'pay'}>{busy === 'pay' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Vérifier et marquer payé</button>
              <button type="button" className="k-btn-ghost" onClick={() => setMode(null)} disabled={anyBusy}>Fermer le formulaire</button>
            </div>
          </form>
        )}

        {mode === 'hold' && (
          <form className="k-inset space-y-3 p-4" aria-label="Suspendre le règlement" noValidate onSubmit={(event) => { event.preventDefault(); submitHold(); }}>
            <p className="text-sm text-kraveo-ink2">Un règlement suspendu ne peut pas être payé tant que vous ne l’avez pas repris.</p>
            <Field label="Pourquoi (facultatif)" htmlFor="settle-hold-note" error={showError('note', holdErrors)}>
              <input id="settle-hold-note" className="k-input" value={holdNote} onChange={(e) => setHoldNote(e.target.value)} aria-invalid={Boolean(showError('note', holdErrors))} aria-describedby="settle-hold-note-msg" autoComplete="off" />
            </Field>
            <div className="flex gap-2">
              <button type="submit" className="k-btn-primary" disabled={anyBusy} aria-busy={busy === 'hold'}>{busy === 'hold' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Confirmer la suspension</button>
              <button type="button" className="k-btn-ghost" onClick={() => setMode(null)} disabled={anyBusy}>Fermer le formulaire</button>
            </div>
          </form>
        )}

        {mode === 'adjust' && (
          <form className="k-inset space-y-3 p-4" aria-label="Ajouter un ajustement" noValidate onSubmit={(event) => { event.preventDefault(); submitAdjust(); }}>
            <p className="text-sm text-kraveo-ink2">+ verse davantage au restaurant, - déduit. Cela modifie le montant à payer (actuellement {rupees(s.netPayable)}).</p>
            <Field label="Montant (FCFA, + ou -)" htmlFor="settle-adj-amount" required error={showError('amount', adjErrors)}>
              <input id="settle-adj-amount" className="k-input" inputMode="decimal" value={adjForm.amount} onChange={(e) => setAdjForm((f) => ({ ...f, amount: e.target.value }))} placeholder="-500 ou 250" aria-invalid={Boolean(showError('amount', adjErrors))} aria-describedby="settle-adj-amount-msg" autoComplete="off" />
            </Field>
            <Field label="Motif" htmlFor="settle-adj-reason" required error={showError('reason', adjErrors)} hint="3 à 200 caractères. Conservé dans le journal d’audit.">
              <input id="settle-adj-reason" className="k-input" value={adjForm.reason} onChange={(e) => setAdjForm((f) => ({ ...f, reason: e.target.value }))} maxLength={240} aria-invalid={Boolean(showError('reason', adjErrors))} aria-describedby="settle-adj-reason-msg" autoComplete="off" />
            </Field>
            <div className="flex gap-2">
              <button type="submit" className="k-btn-primary" disabled={anyBusy} aria-busy={busy === 'adjust'}>{busy === 'adjust' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Ajouter l’ajustement</button>
              <button type="button" className="k-btn-ghost" onClick={() => setMode(null)} disabled={anyBusy}>Fermer le formulaire</button>
            </div>
          </form>
        )}

        <section aria-label="Totaux" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Total label="Commandes" value={String(s.orderCount)} />
          <Total label="Payé par les clients pour les repas" value={rupees(s.foodGross)} />
          <Total label="Part restaurant" value={rupees(s.vendorAmount)} />
          <Total label="Commission" value={rupees(s.commissionAmount)} />
          <Total label="Ajustements" value={rupeesSigned(s.adjustmentTotal)} />
          <Total label="Net à payer" value={rupees(s.netPayable)} strong />
        </section>

        {status === 'PAID' && (
          <section className="rounded-k-md border border-kraveo-g400/40 bg-kraveo-g500/10 px-4 py-3" aria-label="Paiement">
            <p className="k-label">Payé</p>
            <p className="mt-1 text-sm text-kraveo-ink">{s.paidAt ? istDateTime(s.paidAt) : 'Date non enregistrée'}</p>
            <p className="mt-1 text-sm text-kraveo-ink">Référence : <b className="break-all" data-testid="payment-reference">{s.paymentReference ?? 'non enregistrée'}</b></p>
            {s.note && <p className="mt-1 text-xs text-kraveo-ink2">Note: {s.note}</p>}
          </section>
        )}

        <section aria-label="Destination du versement" className="space-y-3">
          <h3 className="flex items-center gap-2 font-display text-base font-bold text-kraveo-ink"><Landmark className="h-4 w-4 text-kraveo-ink3" aria-hidden="true" />Où payer</h3>
          {snap ? (
            <div className="k-inset space-y-1 px-3 py-2.5 text-sm">
              <p className="k-label">À la création de ce règlement</p>
              <p className="break-words text-kraveo-ink"><b>{snap.method === 'UPI' ? 'UPI' : snap.method === 'BANK' ? 'Compte bancaire' : snap.method}</b> {snap.destination ?? ''}{snap.accountHolder ? ` · ${snap.accountHolder}` : ''}{snap.ifsc ? ` · ${snap.ifsc}` : ''}{snap.bankName ? ` · ${snap.bankName}` : ''}</p>
              <p className="text-xs text-kraveo-ink3">{snap.verified ? 'Vérifié à ce moment-là' : 'Non vérifié à ce moment-là'}</p>
            </div>
          ) : (
            <p role="status" className="rounded-k-sm border border-kraveo-status-placed/40 bg-kraveo-status-placed/10 px-3 py-2 text-sm text-kraveo-ink">Aucune coordonnée de versement n’était enregistrée à la création de ce règlement. Demandez au restaurant de les ajouter, ou ajoutez-les ci-dessous.</p>
          )}
          {detail.loading && !d && <Skeleton className="h-20 w-full" />}
          {d && <PayoutAccountPanel userId={d.vendor.userId} name={d.vendor.name} kind="restaurant" initial={d.payoutAccount} onAuthError={onAuthError} />}
        </section>

        {detail.error && <ErrorNote message={detail.error} onRetry={detail.reload} />}
        {detail.loading && !d && !detail.error && <div role="status" aria-label="Chargement du règlement" className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-2/3" /></div>}

        {d && (
          <>
            <section aria-label="Ajustements" className="space-y-2">
              <h3 className="font-display text-base font-bold text-kraveo-ink">Ajustements</h3>
              {d.adjustments.length === 0 ? <p className="text-sm text-kraveo-ink2">Aucun ajustement.</p> : (
                <ul className="space-y-1.5">
                  {d.adjustments.map((a) => (
                    <li key={a.id} className="k-inset flex items-start justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 break-words text-kraveo-ink2">{a.reason}<span className="block text-[11px] text-kraveo-ink3">{istDateTime(a.createdAt)}</span></span>
                      <b className={`shrink-0 tabular-nums ${a.amount < 0 ? 'text-kraveo-danger' : 'text-kraveo-g700'}`}>{a.amount > 0 ? '+' : ''}{rupeesSigned(a.amount)}</b>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-label="Plats" className="space-y-2">
              <h3 className="font-display text-base font-bold text-kraveo-ink">Plats</h3>
              {d.dishes.length === 0 ? <p className="text-sm text-kraveo-ink2">Aucune ligne de plat.</p> : (
                <ScrollTable caption="Plats de ce règlement" minWidth="min-w-[420px]">
                  <thead><tr><Th>Plat</Th><Th right>Unités</Th><Th right>Revenu restaurant</Th><Th right>Commission</Th></tr></thead>
                  <tbody>{d.dishes.map((dish, index) => <tr key={`${dish.menuItemId ?? dish.name}-${index}`}><Td className="break-words font-bold text-kraveo-ink">{dish.name}</Td><Td right>{dish.units}</Td><Td right>{rupees(dish.vendorRevenue)}</Td><Td right>{rupees(dish.commission)}</Td></tr>)}</tbody>
                </ScrollTable>
              )}
            </section>

            <section aria-label="Commandes" className="space-y-2">
              <h3 className="font-display text-base font-bold text-kraveo-ink">Commandes</h3>
              {d.orders.length === 0 ? <p className="text-sm text-kraveo-ink2">Aucune commande dans ce règlement{status === 'CANCELLED' ? ' (elles ont été libérées lors de l’annulation)' : ''}.</p> : (
                <ScrollTable caption="Commandes de ce règlement" minWidth="min-w-[560px]">
                  <thead><tr><Th>Commande</Th><Th>Livrée le</Th><Th right>Repas</Th><Th right>Restaurant</Th><Th right>Commission</Th></tr></thead>
                  <tbody>{d.orders.map((o) => <tr key={o.id}><Td className="font-mono text-xs text-kraveo-ink">{o.id.slice(0, 8)}</Td><Td className="whitespace-nowrap">{istDateTime(o.deliveredAt)}</Td><Td right>{rupees(o.subtotal)}</Td><Td right>{rupees(o.vendorSubtotal)}</Td><Td right>{rupees(o.commissionTotal)}</Td></tr>)}</tbody>
                </ScrollTable>
              )}
              {d.ordersTruncated && <p className="text-xs font-semibold text-kraveo-status-placed">Seules les {d.orders.length} premières commandes sont listées. Les totaux ci-dessus comptent les {s.orderCount} ; le CSV contient toutes les commandes.</p>}
            </section>
          </>
        )}
      </div>
      {dialog}
    </Drawer>
  );
};
