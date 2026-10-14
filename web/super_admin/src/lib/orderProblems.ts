// "Needs attention" problem catalogue and parser for GET /admin/orders/needs-attention.
// Server shape (backend/ORDER_FLOW_NOTES.md, Docs/fixtures/order_flow_samples.json):
//   { success, count, maxRefundAttempts, data: [{ problem, problems[], detail, since, hint, order: OrderView(admin) }] }
// One entry per order, most urgent first. `hint` is the server's advice; unknown codes still render generically.
import { AttentionEntry, AttentionProblem, Order, normalizeOrder } from '../types';
import { humanize, orderFlags, Tone } from './orders';

export type SuggestedAction = 'cancel' | 'reset-otp' | 'retry-refund' | 'assign' | 'call-vendor' | 'call-rider' | 'call-customer' | 'open';

export interface ProblemMeta {
  code: string;
  label: string;
  tone: Tone;
  /** What happened, in plain words. */
  explain: string;
  /** Fallback advice when the server sends no `hint`. */
  advice: string;
  /** The button shown first on the row. */
  action: SuggestedAction;
  /** Higher sorts first (only used for the local fallback list; the server already sorts). */
  weight: number;
}

/** The codes the backend emits (backend/ORDER_FLOW_NOTES.md "Admin playbook"). */
const CATALOGUE: Record<string, Omit<ProblemMeta, 'code'>> = {
  PAYMENT_MISMATCH: {
    label: 'Montant payé incorrect', tone: 'danger', weight: 100, action: 'cancel',
    explain: 'Le montant encaissé est différent du total de la commande : elle n’a donc pas été marquée payée.',
    advice: 'Remboursez le paiement dans le tableau de bord Razorpay, puis annulez la commande.',
  },
  DUPLICATE_PAYMENT: {
    label: 'Payée deux fois', tone: 'danger', weight: 98, action: 'open',
    explain: 'Un second paiement a été encaissé sur une commande déjà payée.',
    advice: 'Remboursez le paiement en trop dans le tableau de bord Razorpay.',
  },
  REFUND_FAILED: {
    label: 'Remboursement échoué', tone: 'danger', weight: 95, action: 'retry-refund',
    explain: 'Le prestataire de paiement a refusé le remboursement ou n’a pas répondu. Le serveur réessaie chaque minute, jusqu’à 10 fois.',
    advice: 'Corrigez la cause puis relancez le remboursement, ou remboursez à la main dans Razorpay (la tentative suivante le marquera alors comme fait).',
  },
  OTP_LOCKED: {
    label: 'OTP de livraison bloqué', tone: 'danger', weight: 90, action: 'reset-otp',
    explain: 'Le livreur a saisi 5 fois un mauvais OTP de livraison : la livraison est bloquée.',
    advice: 'Appelez le client. Réinitialiser le blocage lui envoie un nouveau code ; sinon, annulez la commande.',
  },
  PAID_AFTER_CANCEL: {
    label: 'Payée après annulation', tone: 'warning', weight: 80, action: 'open',
    explain: 'Un paiement est arrivé pour une commande déjà annulée. Le remboursement se fait normalement en moins d’une minute.',
    advice: 'Si elle reste ici (anciennes commandes), remboursez-la dans Razorpay.',
  },
  UNPAID_IN_PROGRESS: {
    label: 'Avance sans paiement', tone: 'warning', weight: 75, action: 'cancel',
    explain: 'Une ancienne commande avance alors qu’elle n’a jamais été marquée payée.',
    advice: 'Vérifiez Razorpay ; annulez la commande si elle n’est vraiment pas payée.',
  },
  STUCK_UNACCEPTED: {
    label: 'Le restaurant ne répond pas', tone: 'warning', weight: 70, action: 'call-vendor',
    explain: 'Une commande payée attend toujours d’être acceptée par le restaurant.',
    advice: 'Appelez le restaurant ; sinon, annulez (le remboursement est automatique).',
  },
  VENDOR_NOT_APPROVED: {
    label: 'Restaurant suspendu', tone: 'warning', weight: 68, action: 'cancel',
    explain: 'Le restaurant a été suspendu alors que cette commande était en cours.',
    advice: 'Annulez la commande (le remboursement est automatique), sauf si le restaurant peut encore la livrer.',
  },
  RIDER_NOT_APPROVED: {
    label: 'Livreur suspendu', tone: 'warning', weight: 66, action: 'assign',
    explain: 'Le livreur assigné a été suspendu pendant qu’il transportait cette commande.',
    advice: 'Réassignez-la à un livreur approuvé, ou annulez.',
  },
  DELIVERY_OVERDUE: {
    label: 'Livraison trop longue', tone: 'warning', weight: 64, action: 'call-rider',
    explain: 'Le livreur a récupéré la commande il y a longtemps et elle n’est toujours pas livrée.',
    advice: 'Appelez le livreur ; réassignez si besoin.',
  },
  RIDER_NOT_PICKED_UP: {
    label: 'Le livreur n’a pas récupéré', tone: 'warning', weight: 62, action: 'call-rider',
    explain: 'Le repas est prêt mais le livreur assigné ne l’a pas récupéré.',
    advice: 'Appelez le livreur ; réassignez si besoin.',
  },
  NO_RIDER: {
    label: 'Aucun livreur assigné', tone: 'warning', weight: 60, action: 'assign',
    explain: 'La commande est payée et avance au restaurant, mais aucun livreur ne l’a prise.',
    advice: 'Appelez les livreurs en service ou assignez-en un.',
  },
  REFUND_PENDING: {
    label: 'Remboursement toujours en attente', tone: 'warning', weight: 45, action: 'open',
    explain: 'Un remboursement a commencé il y a plus de 5 minutes et n’est pas terminé.',
    advice: 'Vérifiez Razorpay avant de faire quoi que ce soit à la main.',
  },
  PAYMENT_FAILED: {
    label: 'Paiement échoué', tone: 'neutral', weight: 20, action: 'open',
    explain: 'Le client a tenté de payer et le paiement a échoué. Il peut réessayer sur la même commande.',
    advice: 'Pour information ; la commande expire d’elle-même.',
  },
};

export const canonicalCode = (code: string): string => String(code || '').trim().toUpperCase() || 'UNKNOWN';

/** Known code: full guidance. Unknown code: a readable label and "open the order". */
export const problemMeta = (code: string): ProblemMeta => {
  const canonical = canonicalCode(code);
  const known = CATALOGUE[canonical];
  if (known) return { code: canonical, ...known };
  return {
    code: canonical,
    label: humanize(canonical),
    tone: 'warning',
    weight: 40,
    action: 'open',
    explain: 'Le serveur a signalé cette commande pour une raison que ce tableau de bord ne connaît pas encore.',
    advice: 'Ouvrez la commande et vérifiez son statut, son paiement et son livreur.',
  };
};

const s = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** Parses `{ data: [...] }` from the server. `detail`/`since` belong to the primary `problem`. */
export const normalizeAttention = (body: any): AttentionEntry[] => {
  const list: any[] = Array.isArray(body?.data) ? body.data : Array.isArray(body) ? body : [];
  return list
    .filter((e) => e && typeof e === 'object')
    .map((e, index) => {
      const order: Order | null = e.order && typeof e.order === 'object' && s(e.order.id) ? normalizeOrder(e.order) : null;
      const primary = s(e.problem) ?? 'UNKNOWN';
      const groupId = s(e.groupId) ?? order?.group?.id ?? order?.groupId ?? null;
      const codes: string[] = [primary, ...(Array.isArray(e.problems) ? e.problems.filter((c: unknown) => s(c) !== null) : [])];
      const problems: AttentionProblem[] = [...new Set(codes.map(canonicalCode))].map((code) => (
        code === canonicalCode(primary) ? { code, detail: s(e.detail), since: s(e.since) } : { code }
      ));
      return { key: order?.id ?? `row-${index}`, orderId: order?.id ?? null, order, problems, hint: s(e.hint), ...(groupId ? { groupId } : {}) };
    });
};

const entryWeight = (entry: AttentionEntry): number => Math.max(0, ...entry.problems.map((p) => problemMeta(p.code).weight));

/** Fallback when the server endpoint is missing (server not yet deployed): what the dashboard can see itself. */
export const localAttention = (orders: Order[], now: number): AttentionEntry[] => orders
  .map((order) => ({ order, flags: orderFlags(order, now).filter((flag) => flag.code !== 'REFUND_PENDING') }))
  .filter(({ flags }) => flags.length > 0)
  .map(({ order, flags }) => ({ key: order.id, orderId: order.id, order, problems: flags.map((flag) => ({ code: flag.code })), hint: null }))
  .sort((a, b) => entryWeight(b) - entryWeight(a));

export const TONE_CLASS: Record<Tone, { pill: string; border: string; text: string; dot: string }> = {
  danger: { pill: 'bg-kraveo-danger/15 text-kraveo-danger', border: 'border-kraveo-danger/40', text: 'text-kraveo-danger', dot: 'bg-kraveo-danger' },
  warning: { pill: 'bg-kraveo-status-placed/15 text-kraveo-status-placed', border: 'border-kraveo-status-placed/40', text: 'text-kraveo-status-placed', dot: 'bg-kraveo-status-placed' },
  info: { pill: 'bg-kraveo-status-pickedUp/15 text-kraveo-status-pickedUp', border: 'border-kraveo-status-pickedUp/40', text: 'text-kraveo-status-pickedUp', dot: 'bg-kraveo-status-pickedUp' },
  neutral: { pill: 'bg-kraveo-surface2 text-kraveo-ink2', border: 'border-kraveo-line', text: 'text-kraveo-ink2', dot: 'bg-kraveo-ink3' },
};

/** Problems about the delivery flow stop mattering once the order is finished; money problems never do. */
const FLOW_ONLY = new Set(['STUCK_UNACCEPTED', 'RIDER_NOT_PICKED_UP', 'NO_RIDER', 'DELIVERY_OVERDUE', 'OTP_LOCKED', 'RIDER_NOT_APPROVED', 'VENDOR_NOT_APPROVED', 'UNPAID_IN_PROGRESS']);
export const isStillRelevant = (code: string, order: Order | null): boolean => {
  if (!order) return true;
  const canonical = canonicalCode(code);
  if (canonical === 'OTP_LOCKED' && order.otpLocked === false) return false;
  if (canonical === 'REFUND_FAILED' && order.refundStatus != null && order.refundStatus !== 'FAILED') return false;
  return !(FLOW_ONLY.has(canonical) && (order.status === 'DELIVERED' || order.status === 'CANCELLED'));
};

/** Drops problems the live order has already outgrown (the server list catches up on its next refresh). */
export const pruneWithLiveOrders = (entries: AttentionEntry[]): AttentionEntry[] => entries
  .map((entry) => ({ ...entry, problems: entry.problems.filter((p) => isStillRelevant(p.code, entry.order)) }))
  .filter((entry) => entry.problems.length > 0);
