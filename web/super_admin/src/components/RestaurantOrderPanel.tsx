import React, { useEffect, useState } from 'react';
import { Ban, Bike, Loader2, MapPin, Phone, Receipt, StickyNote } from 'lucide-react';
import { Order } from '../types';
import { orderCode } from '../lib/orders';
import { ORDER_STATUS_LABEL, inr } from '../lib/tokens';
import { firstName } from '../lib/restaurantStats';
import { Drawer } from './ui/Drawer';

interface Props {
  order: Order | null;
  onClose: () => void;
  /** Resolves to null on success, or the server's message. */
  onReject: (orderId: string, reason: string) => Promise<string | null>;
}

const QUICK = ['Un plat n’est plus disponible', 'Nous sommes trop chargés', 'Nous fermons bientôt', 'Problème en cuisine'];
/** The server decides; these are the stages where it is worth offering the button. */
const CAN_REJECT = new Set(['PLACED', 'ACCEPTED', 'PREPARING']);

/** One order, as the restaurant should see it: what to cook, the customer's note, what it earns. Never the customer's payment, code or fees. */
export const RestaurantOrderPanel: React.FC<Props> = ({ order, onClose, onReject }) => {
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setRefusing(false); setReason(''); setError(''); setBusy(false); }, [order?.id]);

  const trimmed = reason.trim();
  const valid = trimmed.length >= 3 && trimmed.length <= 200;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order || !valid || busy) return;
    setBusy(true); setError('');
    const failure = await onReject(order.id, trimmed);
    setBusy(false);
    if (failure) setError(failure); else onClose();
  };

  return (
    <Drawer open={Boolean(order)} onClose={onClose} title={order ? `Commande ${orderCode(order.id)}` : 'Commande'} subtitle={order ? ORDER_STATUS_LABEL[order.status] ?? order.status : undefined} icon={Receipt} focusFirstField={false}>
      {order && (
        <div className="space-y-4">
          <section className="k-inset p-4" aria-label="Plats">
            <h3 className="k-label mb-2">À préparer</h3>
            <ul className="divide-y divide-kraveo-line/70">
              {order.items.map((item, i) => (
                <li key={`${item.name}-${i}`} className="flex items-baseline gap-3 py-2">
                  <span className="w-8 shrink-0 text-right font-display text-lg font-extrabold tabular-nums text-kraveo-g600">{item.quantity}×</span>
                  <span className="min-w-0 font-semibold text-kraveo-ink [overflow-wrap:anywhere]">{item.name}</span>
                </li>
              ))}
            </ul>
            {typeof order.vendorSubtotal === 'number' && (
              <p className="mt-2 flex items-baseline justify-between border-t border-kraveo-line pt-2 text-sm"><span className="text-kraveo-ink3">Vous gagnez</span><span className="font-display text-lg font-extrabold tabular-nums text-kraveo-ink">{inr(order.vendorSubtotal)}</span></p>
            )}
          </section>

          {order.dropoffNotes && (
            <p className="flex items-start gap-2 rounded-k-md bg-kraveo-yellow/15 px-3.5 py-3 text-sm text-kraveo-ink2"><StickyNote className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span><b className="text-kraveo-ink">Note du client</b> · {order.dropoffNotes}</span></p>
          )}

          <section className="k-inset p-4" aria-label="Client et livreur">
            <p className="font-bold text-kraveo-ink">{firstName(order.customerName)}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-kraveo-ink2"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{order.dropoffHostel}</p>
            <p className="mt-3 flex items-center gap-1.5 text-sm text-kraveo-ink2"><Bike className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {order.driverName ? <>Livreur : <b className="text-kraveo-ink">{firstName(order.driverName)}</b></> : 'Pas encore de livreur'}
            </p>
            {order.driverPhone && <a href={`tel:${order.driverPhone}`} className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-kraveo-g700 hover:underline"><Phone className="h-3.5 w-3.5" aria-hidden="true" />Appeler le livreur</a>}
          </section>

          {order.status === 'CANCELLED' && <p className="rounded-k-md bg-kraveo-surface2 px-3.5 py-3 text-sm text-kraveo-ink2"><b className="text-kraveo-ink">Commande annulée.</b>{order.cancelReason ? ` « ${order.cancelReason} »` : ''}</p>}

          {CAN_REJECT.has(order.status) && (refusing ? (
            <form onSubmit={submit} className="space-y-3 rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/5 p-4" aria-label="Refuser la commande">
              <p className="text-sm font-semibold text-kraveo-ink">Pourquoi refusez-vous cette commande ? Le client lira votre réponse et sera remboursé.</p>
              <div className="flex flex-wrap gap-1.5">{QUICK.map((q) => <button key={q} type="button" onClick={() => setReason(q)} className="rounded-full border border-kraveo-line bg-white px-3 py-1.5 text-xs font-semibold text-kraveo-ink2 hover:border-kraveo-g400">{q}</button>)}</div>
              <textarea className="k-input min-h-[84px]" value={reason} onChange={(e) => { setReason(e.target.value); setError(''); }} maxLength={200} aria-label="Motif du refus" placeholder="Écrivez le motif (3 caractères au moins)" />
              {error && <p role="alert" className="text-sm font-semibold text-kraveo-danger">{error}</p>}
              <div className="flex gap-2">
                <button type="button" className="k-btn-ghost flex-1" onClick={() => setRefusing(false)} disabled={busy}>Garder la commande</button>
                <button type="submit" className="k-btn-danger flex-1" disabled={!valid || busy} aria-busy={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Ban className="h-4 w-4" aria-hidden="true" />}Refuser</button>
              </div>
            </form>
          ) : (
            <button type="button" className="k-btn-ghost w-full text-kraveo-danger hover:!bg-kraveo-danger/10" onClick={() => setRefusing(true)}><Ban className="h-4 w-4" aria-hidden="true" />Refuser cette commande</button>
          ))}
        </div>
      )}
    </Drawer>
  );
};
