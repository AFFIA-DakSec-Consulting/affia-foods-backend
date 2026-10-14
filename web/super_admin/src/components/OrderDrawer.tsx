import React, { useEffect, useState } from 'react';
import { Ban, Bike, CheckCircle2, Circle, Clock3, CreditCard, KeyRound, Loader2, LockKeyhole, MapPin, Phone, Receipt, RotateCcw, Store, TriangleAlert, User } from 'lucide-react';
import { AttentionProblem, DriverPartner, Order } from '../types';
import { inr, timeAgo } from '../lib/tokens';
import { SLA, canCancel, canResetOtpLock, cancelMoneyNote, cancelledByLabel, isTerminal, isUnpaidOpen, orderFlags, refundInfo } from '../lib/orders';
import { TONE_CLASS, isStillRelevant, problemMeta } from '../lib/orderProblems';
import { Drawer } from './ui/Drawer';
import { Field } from './ui/Field';
import { StatusPill } from './ui/StatusPill';
import { OtpLockedPill, PaymentPill, RefundPill } from './ui/OrderBadges';
import { useConfirm } from './ui/ConfirmDialog';
import { AdvanceHandler, NextStepControl, ReassignHandler, RiderAssignSelect, shortId } from './OrderControls';
import { GroupBadge } from './ui/GroupBadge';
import { GroupFetcher, GroupState, OrderGroupPanel, useOrderGroup } from './OrderGroupPanel';
import { GROUP_MONEY_PROBLEMS, cancelWholeGroupText, groupMoneyNote } from '../lib/orderGroups';
import { apiService } from '../services/api';

export type DrawerMode = 'view' | 'cancel';

interface Props {
  order: Order | null;
  /** True while the order is being fetched (opened from a list that only had its id). */
  loading?: boolean;
  loadError?: string;
  mode: DrawerMode;
  onModeChange: (mode: DrawerMode) => void;
  onClose: () => void;
  riders: DriverPartner[];
  /** Server-reported problems for this order (needs-attention list) and the server's advice for them. */
  problems?: AttentionProblem[];
  hint?: string | null;
  onAdvance: AdvanceHandler;
  onReassign: ReassignHandler;
  /** Resolves to null on success, or the server's error message. */
  onCancel: (orderId: string, reason: string) => Promise<string | null>;
  onResetOtpLock: (orderId: string) => Promise<boolean>;
  onRetryRefund: (orderId: string) => Promise<boolean>;
  /** Opens another order in this drawer (the siblings of a combined order). */
  onOpenOrder?: (orderId: string) => void;
  /** Loads a combined order (GET /api/order-groups/:id). Defaults to the real API; tests pass a stub. */
  fetchGroup?: GroupFetcher;
}

const QUICK_REASONS = ['Le restaurant ne peut pas la préparer', 'Le client a demandé l’annulation', 'Aucun livreur disponible', 'Problème de paiement', 'Commande en double', 'Livraison impossible à ce point'];

const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null);

const Section: React.FC<{ title: string; icon?: React.ElementType; children: React.ReactNode; className?: string }> = ({ title, icon: Icon, children, className = '' }) => (
  <section className={`k-inset p-4 ${className}`} aria-label={title}>
    <h3 className="k-label mb-2.5 flex items-center gap-1.5">{Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}{title}</h3>
    {children}
  </section>
);

const CallLink: React.FC<{ phone?: string | null; who: string }> = ({ phone, who }) => (phone
  ? <a href={`tel:${phone.replace(/\s+/g, '')}`} aria-label={`Appeler ${who} au ${phone}`} className="mt-1.5 inline-flex min-h-[36px] items-center gap-2 rounded-k-sm bg-kraveo-g500/10 px-3 py-1.5 text-sm font-bold text-kraveo-g700 hover:bg-kraveo-g500/15"><Phone className="h-3.5 w-3.5" aria-hidden="true" />{phone}<span className="text-[11px] font-semibold text-kraveo-ink3">appuyer pour appeler</span></a>
  : <p className="mt-1 text-xs text-kraveo-ink3">Aucun téléphone enregistré.</p>);

const Notice: React.FC<{ tone: 'danger' | 'warning' | 'info' | 'neutral'; icon: React.ElementType; title: string; children?: React.ReactNode; action?: React.ReactNode }> = ({ tone, icon: Icon, title, children, action }) => (
  <div className={`rounded-k-md border ${TONE_CLASS[tone].border} ${tone === 'danger' ? 'bg-kraveo-danger/10' : 'bg-kraveo-night/60'} p-3.5`} role={tone === 'danger' ? 'alert' : undefined}>
    <div className="flex items-start gap-3">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${TONE_CLASS[tone].text}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <p className={`font-bold ${tone === 'danger' ? 'text-kraveo-danger' : 'text-kraveo-ink'}`}>{title}</p>
        {children && <div className="mt-0.5 text-kraveo-ink2">{children}</div>}
        {action && <div className="mt-2.5">{action}</div>}
      </div>
    </div>
  </div>
);

/** Timeline row. `undefined` = the server did not send this field (older server); `null` = not happened yet. */
const Step: React.FC<{ label: string; at: string | null | undefined; done?: boolean; danger?: boolean }> = ({ label, at, done, danger }) => {
  const reached = done ?? Boolean(at);
  return (
    <li className="flex items-center justify-between gap-3 py-1">
      <span className="flex items-center gap-2 text-sm">
        {reached ? <CheckCircle2 className={`h-4 w-4 ${danger ? 'text-kraveo-danger' : 'text-kraveo-g600'}`} aria-hidden="true" /> : <Circle className="h-4 w-4 text-kraveo-line" aria-hidden="true" />}
        <span className={reached ? 'font-semibold text-kraveo-ink' : 'text-kraveo-ink3'}>{label}</span>
      </span>
      <span className="text-right text-xs tabular-nums text-kraveo-ink2">{at ? dateTime(at) : at === undefined && reached ? 'Heure non enregistrée' : reached ? '' : 'Pas encore'}</span>
    </li>
  );
};

const STATUS_RANK: Record<string, number> = { PLACED: 0, ACCEPTED: 1, PREPARING: 2, READY_FOR_PICKUP: 3, PICKED_UP: 4, ARRIVED_AT_GATE: 5, DELIVERED: 6 };

const clock = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : null);

const OrderView: React.FC<Omit<Props, 'mode' | 'onModeChange' | 'onClose' | 'onCancel' | 'loading' | 'loadError' | 'fetchGroup'> & { order: Order; onStartCancel: () => void; groupState: GroupState; onReloadGroup: () => void }> = ({ order, riders, problems = [], hint, onAdvance, onReassign, onResetOtpLock, onRetryRefund, onStartCancel, groupState, onReloadGroup, onOpenOrder }) => {
  const [resetting, setResetting] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [now] = useState(() => Date.now());
  const rank = STATUS_RANK[order.status] ?? -1;
  const refund = refundInfo(order);
  const ownProblems: AttentionProblem[] = (problems.length ? problems : orderFlags(order, now).map((flag) => ({ code: flag.code }))).filter((p) => isStillRelevant(p.code, order));
  const hasBreakdown = order.subtotal !== undefined;
  const itemsTotal = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const payments = order.payments ?? [];
  // Server deadlines first (payBy / acceptBy); the contract windows only for orders that lack them.
  const placedAt = Date.parse(order.createdAt);
  const payBy = clock(order.payBy) ?? (Number.isFinite(placedAt) ? clock(new Date(placedAt + SLA.PAYMENT_WINDOW_MIN * 60000).toISOString()) : null);
  const acceptBy = clock(order.acceptBy);
  const primaryCode = problems[0]?.code;

  const { confirm, dialog: confirmDialog } = useConfirm();

  const reset = async () => {
    if (resetting) return;
    const ok = await confirm({
      title: 'Réinitialiser le blocage OTP ?',
      message: 'Le client reçoit un nouveau code de livraison et l’ancien ne fonctionne plus. Le livreur peut alors réessayer.',
      confirmLabel: 'Réinitialiser le blocage OTP',
    });
    if (!ok) return;
    setResetting(true);
    try { await onResetOtpLock(order.id); } finally { setResetting(false); }
  };
  const retry = async () => {
    if (retrying) return;
    const ok = await confirm({
      title: 'Relancer le remboursement ?',
      message: 'Le remboursement est relancé immédiatement. S’il réussit, le client récupère son argent.',
      confirmLabel: 'Relancer le remboursement',
    });
    if (!ok) return;
    setRetrying(true);
    try { await onRetryRefund(order.id); } finally { setRetrying(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill status={order.status} />
        <PaymentPill status={order.paymentStatus} />
        <RefundPill order={order} />
        <OtpLockedPill order={order} />
        <GroupBadge group={order.group} />
      </div>

      {order.group && <OrderGroupPanel order={order} state={groupState} onReload={onReloadGroup} onOpenOrder={onOpenOrder} />}

      {/* Problems first: this drawer is where a human fixes things. */}
      {ownProblems.map((p) => {
        const meta = problemMeta(p.code);
        if (meta.code === 'OTP_LOCKED' || meta.code === 'REFUND_FAILED') return null; // dedicated notices below
        return (
          <Notice key={meta.code} tone={meta.tone} icon={TriangleAlert} title={meta.label}>
            <p>{meta.explain}</p>
            {p.detail && <p className="mt-1 text-kraveo-ink [overflow-wrap:anywhere]">{p.detail}</p>}
            <p className="mt-1 font-semibold text-kraveo-ink">{p.code === primaryCode && hint ? hint : meta.advice}</p>
            {order.group && GROUP_MONEY_PROBLEMS.has(meta.code) && <p className="mt-1 text-xs">{groupMoneyNote(order.group)}</p>}
          </Notice>
        );
      })}

      {refund?.tone === 'danger' && (
        <Notice
          tone="danger"
          icon={TriangleAlert}
          title="Remboursement échoué : le client n’a pas récupéré son argent"
          action={(
            <button type="button" className="k-btn-accent !min-h-[38px] text-xs" onClick={retry} disabled={retrying} aria-busy={retrying}>
              {retrying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RotateCcw className="h-4 w-4" aria-hidden="true" />}Relancer le remboursement
            </button>
          )}
        >
          <p>{order.refundError || refund.detail}</p>
          {order.refundAttempts !== undefined && <p className="mt-1 text-xs">Tentatives automatiques jusqu’ici : {order.refundAttempts} (le serveur s’arrête après 10).</p>}
          <p className="mt-1 font-semibold text-kraveo-ink">{(primaryCode === 'REFUND_FAILED' && hint) || `Corrigez la cause, puis relancez. Ou remboursez à la main dans le tableau de bord Razorpay${order.razorpayPaymentId ? ` (paiement ${order.razorpayPaymentId})` : ''} ; la tentative suivante le marquera alors comme fait.`}</p>
        </Notice>
      )}
      {refund && refund.tone === 'warning' && refund.detail && <Notice tone="warning" icon={CreditCard} title={refund.label}><p>{refund.detail}</p></Notice>}

      {order.otpLocked && (
        <Notice
          tone="danger"
          icon={LockKeyhole}
          title={`OTP de livraison bloqué${order.otpAttempts ? ` après ${order.otpAttempts} tentatives erronées` : ''}`}
          action={canResetOtpLock(order) ? (
            <button type="button" className="k-btn-accent !min-h-[38px] text-xs" onClick={reset} disabled={resetting} aria-busy={resetting}>
              {resetting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}Réinitialiser le blocage OTP
            </button>
          ) : undefined}
        >
          <p>Le livreur ne peut pas terminer la livraison. Appelez d’abord le client. Réinitialiser le blocage envoie au client un <b>nouveau</b> code de livraison (l’ancien ne fonctionne plus) et permet au livreur de réessayer.</p>
        </Notice>
      )}

      {order.status === 'CANCELLED' && (
        <Notice tone="neutral" icon={Ban} title={`Annulée par : ${cancelledByLabel(order.cancelledBy)}${order.cancelledAt ? ` · ${dateTime(order.cancelledAt)}` : ''}`}>
          <p className="[overflow-wrap:anywhere]">{order.cancelReason ? `“${order.cancelReason}”` : 'Aucun motif enregistré.'}</p>
        </Notice>
      )}

      {isUnpaidOpen(order) && (
        <Notice tone="warning" icon={CreditCard} title={order.paymentStatus === 'FAILED' ? 'Paiement échoué, le client peut réessayer' : 'En attente du paiement du client'}>
          <p>Le restaurant et les livreurs ne voient pas cette commande tant qu’elle n’est pas payée.{payBy ? ` Elle sera annulée automatiquement à ${payBy} si elle n’est toujours pas payée.` : ''}</p>
        </Notice>
      )}

      {order.status === 'PLACED' && order.paymentStatus === 'PAID' && acceptBy && (
        <Notice tone="info" icon={Clock3} title={`Le restaurant doit accepter avant ${acceptBy}`}>
          <p>Sinon, le serveur annule la commande et rembourse automatiquement le client.</p>
        </Notice>
      )}

      {!isTerminal(order.status) && (
        <Section title="Actions">
          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-xs text-kraveo-ink2">Étape suivante</p>
              <NextStepControl order={order} onAdvance={onAdvance} stacked />
              {order.group && <p className="mt-2 text-xs text-kraveo-ink3">Commande groupée : « Au portail » et « Livrée » s’appliquent aux {order.group.size} commandes en même temps, et la cuisine ne peut commencer qu’une fois que tous les restaurants ont accepté.</p>}
              {order.status === 'ARRIVED_AT_GATE' && order.otpCode && (
                <p className="mt-2 text-xs text-kraveo-ink3">OTP de livraison du client (admin uniquement) : <span className="select-all font-mono text-sm font-bold tracking-[0.3em] text-kraveo-ink">{order.otpCode}</span></p>
              )}
            </div>
            <div>
              <label className="mb-1.5 block text-xs text-kraveo-ink2" htmlFor={`assign-${order.id}`}>Livreur {order.group ? `(pour les ${order.group.size} commandes) ` : ''}{rank >= STATUS_RANK.PICKED_UP && order.driverId ? '(le livreur actuel a déjà le repas)' : ''}</label>
              <RiderAssignSelect id={`assign-${order.id}`} order={order} riders={riders} onReassign={onReassign} />
            </div>
            {canCancel(order) && (
              <button type="button" className="k-btn-danger w-full" onClick={onStartCancel}>
                <Ban className="h-4 w-4" aria-hidden="true" />{order.group ? `Annuler toute la commande groupée (${order.group.size})` : 'Annuler la commande'}{order.paymentStatus === 'PAID' ? ' et rembourser' : ''}
              </button>
            )}
          </div>
        </Section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Chronologie">
          <ol>
            <Step label="Passée" at={order.createdAt} done />
            <Step label="Payée" at={order.paidAt} done={order.paymentStatus === 'PAID' || order.paymentStatus === 'REFUNDED' || Boolean(order.paidAt)} />
            <Step label="Acceptée" at={order.acceptedAt} done={rank >= 1 || Boolean(order.acceptedAt)} />
            <Step label="Récupérée" at={order.pickedUpAt} done={rank >= 4 || Boolean(order.pickedUpAt)} />
            {order.status === 'CANCELLED'
              ? <Step label="Annulée" at={order.cancelledAt} done danger />
              : <Step label="Livrée" at={order.deliveredAt} done={rank >= 6 || Boolean(order.deliveredAt)} />}
          </ol>
          {order.updatedAt && <p className="mt-2 border-t border-kraveo-line pt-2 text-[11px] text-kraveo-ink3">Dernière modification {timeAgo(order.updatedAt)}</p>}
        </Section>

        <Section title={`Articles (${order.itemsCount})`} icon={Receipt}>
          {order.items.length === 0
            ? <p className="text-sm text-kraveo-ink3">Aucun article dans les données reçues.</p>
            : (
              <ul className="space-y-1.5 text-sm">
                {order.items.map((item, index) => (
                  <li key={item.id ?? `${item.name}-${index}`} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 break-words text-kraveo-ink"><span className="font-bold tabular-nums text-kraveo-g700">{item.quantity}×</span> {item.name}</span>
                    <span className="shrink-0 tabular-nums text-kraveo-ink2">{inr(item.price * item.quantity)}</span>
                  </li>
                ))}
              </ul>
            )}
          <dl className="mt-3 space-y-1 border-t border-kraveo-line pt-2 text-xs text-kraveo-ink2">
            <div className="flex justify-between"><dt>Sous-total</dt><dd className="tabular-nums">{inr(hasBreakdown ? order.subtotal! : itemsTotal)}</dd></div>
            {order.taxAndPackaging !== undefined && <div className="flex justify-between"><dt>Taxes et emballage</dt><dd className="tabular-nums">{inr(order.taxAndPackaging)}</dd></div>}
            <div className="flex justify-between"><dt>Frais de livraison</dt><dd className="tabular-nums">{inr(order.deliveryFee)}</dd></div>
            {order.discount ? <div className="flex justify-between text-kraveo-g700"><dt>Réduction</dt><dd className="tabular-nums">−{inr(order.discount)}</dd></div> : null}
            <div className="flex justify-between pt-1 text-sm font-bold text-kraveo-ink"><dt>{order.group ? 'Part de ce restaurant' : 'Total'}</dt><dd className="k-num">{inr(order.totalAmount)}</dd></div>
          </dl>
        </Section>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Section title="Client" icon={User}>
          <p className="font-bold text-kraveo-ink [overflow-wrap:anywhere]">{order.customerName}</p>
          {order.customerEmail && <p className="break-all text-xs text-kraveo-ink3">{order.customerEmail}</p>}
          <CallLink phone={order.customerPhone} who={order.customerName} />
          <p className="mt-3 flex items-start gap-1.5 text-sm font-semibold text-kraveo-ink"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-kraveo-g600" aria-hidden="true" /><span className="min-w-0 [overflow-wrap:anywhere]">{order.dropoffHostel}</span></p>
          <p className="mt-1 text-xs text-kraveo-ink2 [overflow-wrap:anywhere]">{order.dropoffNotes || <span className="text-kraveo-ink3">Aucune consigne de livraison.</span>}</p>
        </Section>

        <Section title="Livreur" icon={Bike}>
          {order.driverName || order.driverId
            ? <><p className="font-bold text-kraveo-ink [overflow-wrap:anywhere]">{order.driverName ?? 'Livreur assigné'}</p><CallLink phone={order.driverPhone} who={order.driverName ?? 'le livreur'} /></>
            : <p className="text-sm text-kraveo-ink3">{order.paymentStatus === 'PAID' ? 'Aucun livreur n’a encore pris cette commande.' : 'Les livreurs voient la commande une fois payée.'}</p>}
          <h3 className="k-label mb-1.5 mt-4 flex items-center gap-1.5"><Store className="h-3.5 w-3.5" aria-hidden="true" />Restaurant</h3>
          <p className="font-bold text-kraveo-ink [overflow-wrap:anywhere]">{order.vendorName}</p>
          {order.vendorAddress && <p className="text-xs text-kraveo-ink3 [overflow-wrap:anywhere]">{order.vendorAddress}</p>}
          {order.vendorPhone && <CallLink phone={order.vendorPhone} who={order.vendorName} />}
        </Section>
      </div>

      {confirmDialog}

      <Section title="Données de paiement (admin uniquement)" icon={CreditCard}>
        <dl className="space-y-1.5 text-xs">
          {[
            ['Id de commande', order.id],
            ['Commande Razorpay', order.razorpayOrderId],
            ['Paiement Razorpay', order.razorpayPaymentId],
            ['Remboursement Razorpay', order.razorpayRefundId],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-wrap justify-between gap-x-3">
              <dt className="text-kraveo-ink3">{label}</dt>
              <dd className="min-w-0 select-all break-all text-right font-mono text-kraveo-ink">{value || '—'}</dd>
            </div>
          ))}
        </dl>
        {payments.length > 1 && (
          <ul className="mt-3 space-y-1 border-t border-kraveo-line pt-2 font-mono text-[11px] text-kraveo-ink2">
            {payments.map((p, index) => <li key={p.id ?? index} className="break-all">{p.status ?? '?'} · {p.amount !== undefined ? inr(p.amount) : '—'} · {p.razorpayPaymentId ?? 'pas encore d’id de paiement'}{p.createdAt ? ` · ${dateTime(p.createdAt)}` : ''}</li>)}
          </ul>
        )}
      </Section>
    </div>
  );
};

const CancelForm: React.FC<{ order: Order; error: string; groupState: GroupState; onSubmit: (reason: string) => void }> = ({ order, error, groupState, onSubmit }) => {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const trimmed = reason.trim();
  const invalid = trimmed.length < 3 || trimmed.length > 200;
  const money = cancelMoneyNote(order);
  const rank = STATUS_RANK[order.status] ?? 0;
  const group = order.group;
  // A combined order has ONE payment: the refund is the group total, not this restaurant's share. Unknown until the group has loaded.
  const groupTotal = groupState.status === 'ready' && groupState.group.id === group?.id ? groupState.group.total : null;
  const refundTitle = group
    ? (money.refunds ? `Rembourse automatiquement ${groupTotal !== null ? inr(groupTotal) : 'la totalité du paiement'} pour toute la commande groupée` : 'Aucun remboursement nécessaire')
    : (money.refunds ? `Rembourse automatiquement ${inr(order.totalAmount)} au client` : 'Aucun remboursement nécessaire');
  return (
    <form id="admin-cancel-form" noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!invalid) onSubmit(trimmed); }}>
      {error && <div role="alert" className="rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 px-4 py-3 text-sm text-kraveo-ink">{error}</div>}
      {group && (
        <div role="alert" className="rounded-k-md border border-kraveo-danger/40 bg-kraveo-danger/10 p-4 text-sm" data-testid="cancel-group-warning">
          <p className="font-bold text-kraveo-danger">{cancelWholeGroupText(group, order.paymentStatus === 'PAID')}</p>
          <p className="mt-1 text-kraveo-ink2">Vous ne pouvez pas annuler un seul restaurant. Toutes ces commandes seront annulées{group.stops.length ? ' :' : '.'}</p>
          {group.stops.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-kraveo-ink">
              {group.stops.map((stop) => <li key={stop.orderId} className="[overflow-wrap:anywhere]">{stop.vendorName} <span className="font-mono text-xs text-kraveo-ink3">{shortId(stop.orderId)}</span></li>)}
            </ul>
          )}
        </div>
      )}
      <div className={`rounded-k-md border p-4 text-sm ${money.refunds ? 'border-kraveo-yellow/40 bg-kraveo-yellow/10' : 'border-kraveo-line bg-kraveo-night/60'}`}>
        <p className="font-bold text-kraveo-ink">{refundTitle}</p>
        <p className="mt-1 text-kraveo-ink2">{money.text}</p>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-sm text-kraveo-ink2">
        <li>{order.driverId ? 'Le client, le restaurant et le livreur voient' : 'Le client et le restaurant voient'} la commande comme annulée, avec votre motif.</li>
        {group && <li>Tous les autres restaurants de la commande groupée sont aussi annulés ; ceux qui avaient déjà accepté sont prévenus de l’annulation.</li>}
        {rank >= STATUS_RANK.ACCEPTED && rank < STATUS_RANK.PICKED_UP && <li>Le restaurant est peut-être déjà en train de cuisiner.</li>}
        {rank >= STATUS_RANK.PICKED_UP && <li>Le livreur a déjà le repas. Dites-lui quoi en faire.</li>}
        <li>Cette action est irréversible.</li>
      </ul>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Motifs rapides">
        {QUICK_REASONS.map((r) => <button key={r} type="button" className="k-chip" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>)}
      </div>
      <Field label="Motif (affiché au client)" htmlFor="admin-cancel-reason" required error={touched && invalid ? 'Indiquez un motif court (3 à 200 caractères).' : undefined} hint={`${trimmed.length}/200`}>
        <textarea
          id="admin-cancel-reason"
          autoFocus
          rows={3}
          maxLength={200}
          className="k-input !min-h-[96px] py-3"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-invalid={touched && invalid}
          aria-describedby="admin-cancel-reason-msg"
        />
      </Field>
    </form>
  );
};

export const OrderDrawer: React.FC<Props> = (props) => {
  const { order, loading, loadError, mode, onModeChange, onClose, onCancel, fetchGroup = apiService.fetchOrderGroup } = props;
  const [submitting, setSubmitting] = useState(false);
  const { confirm, dialog: confirmDialog } = useConfirm();
  // One lazy load of the combined order (only when this order has a group), shared by the view and the cancel form.
  const { state: groupState, reload: reloadGroup } = useOrderGroup(fetchGroup, order?.group?.id, order?.updatedAt);
  const [cancelError, setCancelError] = useState('');
  const open = Boolean(order) || Boolean(loading) || Boolean(loadError);

  useEffect(() => { setCancelError(''); setSubmitting(false); }, [order?.id, mode]);
  // If the order finishes (e.g. delivered or cancelled elsewhere) while the cancel form is open, drop back to the view.
  useEffect(() => { if (mode === 'cancel' && order && !canCancel(order) && !submitting) onModeChange('view'); }, [mode, order, submitting, onModeChange]);

  const submitCancel = async (reason: string) => {
    if (!order) return;
    if (order.group) {
      // Last chance: this cancels every restaurant and refunds the whole payment.
      const ok = await confirm({
        title: `Annuler les ${order.group.size} restaurants ?`,
        message: cancelWholeGroupText(order.group, order.paymentStatus === 'PAID'),
        confirmLabel: `Annuler les ${order.group.size} commandes`,
        cancelLabel: 'Garder la commande',
        danger: true,
      });
      if (!ok) return;
    }
    setSubmitting(true);
    setCancelError('');
    const failure = await onCancel(order.id, reason);
    setSubmitting(false);
    if (failure === null) onModeChange('view');
    else setCancelError(`La commande n’a pas été annulée : ${failure}`);
  };

  const cancelling = mode === 'cancel' && order;
  const footer = cancelling ? (
    <div className="flex gap-3 pb-1">
      <button type="button" className="k-btn-ghost flex-1" onClick={() => onModeChange('view')} disabled={submitting}>Garder la commande</button>
      <button type="submit" form="admin-cancel-form" className="k-btn-danger flex-1 !bg-kraveo-danger !text-white hover:!bg-kraveo-danger/90" disabled={submitting} aria-busy={submitting}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Ban className="h-4 w-4" aria-hidden="true" />}
        {order.group ? `Annuler les ${order.group.size} commandes${order.paymentStatus === 'PAID' ? ' et rembourser' : ''}` : order.paymentStatus === 'PAID' ? 'Annuler et rembourser' : 'Annuler la commande'}
      </button>
    </div>
  ) : <button onClick={onClose} className="k-btn-ghost mb-1 w-full">Fermer</button>;

  return (
    <Drawer
      open={open}
      onClose={() => { if (!submitting) onClose(); }}
      wide
      focusFirstField={false}
      icon={cancelling ? Ban : Receipt}
      title={order ? `${cancelling ? 'Annuler la commande' : 'Commande'} ${shortId(order.id)}` : 'Commande'}
      subtitle={order ? `${order.vendorName} · passée ${timeAgo(order.createdAt)} · ${inr(order.totalAmount)}` : loading ? 'Chargement…' : ''}
      footer={footer}
    >
      {!order && loading && <div className="space-y-3" role="status" aria-label="Chargement de la commande"><div className="k-skeleton h-24" /><div className="k-skeleton h-40" /></div>}
      {!order && loadError && <div role="alert" className="rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 px-4 py-3 text-sm text-kraveo-ink">{loadError}</div>}
      {order && (cancelling
        ? <CancelForm order={order} error={cancelError} groupState={groupState} onSubmit={submitCancel} />
        : <OrderView {...props} order={order} groupState={groupState} onReloadGroup={reloadGroup} onStartCancel={() => onModeChange('cancel')} />)}
      {confirmDialog}
    </Drawer>
  );
};
