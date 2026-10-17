import React, { useMemo, useState } from 'react';
import { Percent, ReceiptText, RotateCcw } from 'lucide-react';
import { Order } from '../types';
import { apiService } from '../services/api';
import { RangePreset, presetRange } from '../lib/financeParse';
import { orderCode } from '../lib/orders';
import { inr } from '../lib/tokens';
import { EmptyState } from './ui/EmptyState';
import { KpiTile } from './ui/KpiTile';
import { PaginationBar, usePagination } from './ui/Pagination';
import { SkeletonCard } from './ui/Skeleton';
import { PageHeader, UnderlineTabs } from './ui/PageToolbar';
import { ErrorBanner, Pill, Tone, dateTime, useLoad } from './platform/common';

// ───────────────────────── Refunds ─────────────────────────

type RefundFilter = 'ALL' | 'PENDING' | 'FAILED' | 'DONE';
const REFUND_LABEL: Record<string, string> = { PENDING: 'En cours', FAILED: 'Échoué', DONE: 'Remboursé' };
const REFUND_TONE: Record<string, Tone> = { PENDING: 'amber', FAILED: 'red', DONE: 'green' };

/** Where an order stands on its refund; REFUNDED payments count as done even when the job flag is missing. */
export const refundStateOf = (o: Pick<Order, 'refundStatus' | 'paymentStatus'>): 'PENDING' | 'FAILED' | 'DONE' | null => {
  if (o.refundStatus === 'FAILED') return 'FAILED';
  if (o.refundStatus === 'PENDING') return 'PENDING';
  if (o.refundStatus === 'DONE' || o.paymentStatus === 'REFUNDED') return 'DONE';
  return null;
};

export const RefundsPanel: React.FC<{ orders: Order[]; loading?: boolean; onOpenOrder: (id: string) => void; onRetryRefund: (id: string) => unknown; onRefresh?: () => void }> = ({ orders, loading, onOpenOrder, onRetryRefund, onRefresh }) => {
  const [filter, setFilter] = useState<RefundFilter>('ALL');
  const [retrying, setRetrying] = useState<string | null>(null);
  const all = useMemo(() => orders.map((o) => ({ o, state: refundStateOf(o) })).filter((x): x is { o: Order; state: 'PENDING' | 'FAILED' | 'DONE' } => x.state !== null)
    .sort((a, b) => new Date(b.o.updatedAt ?? b.o.createdAt).getTime() - new Date(a.o.updatedAt ?? a.o.createdAt).getTime()), [orders]);
  const count = (s: string) => all.filter((x) => x.state === s).length;
  const rows = all.filter((x) => filter === 'ALL' || x.state === filter);
  const pager = usePagination(rows, filter, 10);
  const refunded = all.filter((x) => x.state === 'DONE').reduce((s, x) => s + x.o.totalAmount, 0);

  const retry = async (id: string) => { setRetrying(id); try { await onRetryRefund(id); } finally { setRetrying(null); } };

  return (
    <div className="space-y-5">
      <PageHeader icon={ReceiptText} title="Remboursements" subtitle="Remboursements clients, en cours et terminés." onRefresh={onRefresh} refreshing={loading} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile index={0} label="En cours" icon={RotateCcw} tone="text-kraveo-status-placed" toneBg="bg-kraveo-status-placed/15" value={count('PENDING')} />
        <KpiTile index={1} label="Échoués" icon={RotateCcw} tone="text-kraveo-danger" toneBg="bg-kraveo-danger/10" value={count('FAILED')} note="À relancer ou à rembourser à la main" />
        <KpiTile index={2} label="Remboursés" icon={RotateCcw} value={count('DONE')} note={inr(refunded)} />
      </div>
      <UnderlineTabs label="Statut du remboursement" value={filter} onChange={setFilter}
        tabs={[{ id: 'ALL', label: 'Tous', count: all.length }, { id: 'PENDING', label: 'En cours', count: count('PENDING') }, { id: 'FAILED', label: 'Échoués', count: count('FAILED'), alert: true }, { id: 'DONE', label: 'Remboursés', count: count('DONE') }]} />
      {rows.length === 0 && <div className="k-card p-6"><EmptyState icon={ReceiptText} title="Aucun remboursement" description="Aucune commande chargée n’a de remboursement avec ce statut. La liste porte sur les commandes récentes de l’application." /></div>}
      {rows.length > 0 && (
        <ul className="k-card divide-y divide-kraveo-line/60 overflow-hidden">
          {pager.pageItems.map(({ o, state }) => (
            <li key={o.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <button type="button" onClick={() => onOpenOrder(o.id)} className="min-w-0 text-left">
                <span className="block truncate font-bold text-kraveo-ink">{orderCode(o.id)} · {o.customerName} · {o.vendorName}</span>
                <span className="block truncate text-xs text-kraveo-ink3">{dateTime(o.updatedAt ?? o.createdAt)}{state === 'FAILED' && o.refundError ? ` · ${o.refundError}` : ''}{o.refundAttempts ? ` · ${o.refundAttempts} essai${o.refundAttempts > 1 ? 's' : ''}` : ''}</span>
              </button>
              <span className="flex shrink-0 items-center gap-3">
                <span className="k-num text-kraveo-ink">{inr(o.totalAmount)}</span>
                <Pill tone={REFUND_TONE[state]}>{REFUND_LABEL[state]}</Pill>
                {state === 'FAILED' && <button type="button" className="k-btn-ghost !min-h-[34px] text-xs" disabled={retrying === o.id} onClick={() => retry(o.id)}>Relancer</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <PaginationBar page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} total={pager.total} onPage={pager.setPage} noun="remboursements" />
    </div>
  );
};

// ───────────────────────── Commissions ─────────────────────────

const PRESETS: Array<[RangePreset, string]> = [['today', 'Aujourd’hui'], ['7d', '7 jours'], ['30d', '30 jours']];

export const CommissionsPanel: React.FC<{ onAuthError: (e: unknown) => void; onOpenSettings: () => void }> = ({ onAuthError, onOpenSettings }) => {
  const [preset, setPreset] = useState<RangePreset>('30d');
  const range = useMemo(() => presetRange(preset), [preset]);
  const { data, loading, error, reload } = useLoad(() => apiService.fetchFinanceByRestaurant(range, 200), onAuthError, [range.from, range.to]);
  const rows = (data?.rows ?? []).filter((r) => r.orders > 0 || r.commission > 0).sort((a, b) => b.commission - a.commission);
  const totalCommission = rows.reduce((s, r) => s + r.commission, 0);
  const totalGross = rows.reduce((s, r) => s + r.foodGross, 0);
  const pager = usePagination(rows, preset, 10);
  return (
    <div className="space-y-5">
      <PageHeader icon={Percent} title="Commissions" subtitle="Ce qu’Affia Foods prélève sur chaque restaurant." onRefresh={reload} refreshing={loading}
        actions={<button type="button" className="k-btn-ghost" onClick={onOpenSettings}>Modifier le taux</button>} />
      <div className="flex gap-2" role="group" aria-label="Période">{PRESETS.map(([id, label]) => <button key={id} type="button" className="k-chip" aria-pressed={preset === id} onClick={() => setPreset(id)}>{label}</button>)}</div>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <SkeletonCard lines={3} />}
      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KpiTile index={0} label="Commission prélevée" icon={Percent} value={inr(totalCommission)} />
          <KpiTile index={1} label="Ventes de plats" icon={Percent} value={inr(totalGross)} />
          <KpiTile index={2} label="Taux moyen" icon={Percent} value={totalGross > 0 ? `${((totalCommission / totalGross) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : '—'} />
        </div>
      )}
      {data && rows.length === 0 && <div className="k-card p-6"><EmptyState icon={Percent} title="Aucune commission sur la période" description="Les commissions apparaissent avec les commandes livrées." /></div>}
      {rows.length > 0 && (
        <div className="k-card overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="border-b border-kraveo-line text-left"><th className="k-label px-4 py-3">Restaurant</th><th className="k-label px-4 py-3 text-right">Commandes</th><th className="k-label px-4 py-3 text-right">Ventes plats</th><th className="k-label px-4 py-3 text-right">Commission</th><th className="k-label px-4 py-3 text-right">Taux</th></tr></thead>
            <tbody>
              {pager.pageItems.map((r) => (
                <tr key={r.vendorId} className="border-b border-kraveo-line/60 last:border-0">
                  <td className="px-4 py-3 font-bold text-kraveo-ink">{r.vendorName}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-kraveo-ink2">{r.orders}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-kraveo-ink2">{inr(r.foodGross)}</td>
                  <td className="px-4 py-3 text-right tabular-nums font-bold text-kraveo-ink">{inr(r.commission)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-kraveo-ink2">{r.foodGross > 0 ? `${((r.commission / r.foodGross) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <PaginationBar page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} total={pager.total} onPage={pager.setPage} noun="restaurants" />
    </div>
  );
};
