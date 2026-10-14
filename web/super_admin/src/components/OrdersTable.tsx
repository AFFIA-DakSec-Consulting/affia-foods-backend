import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Columns3, Download, LayoutGrid, Loader2, MapPin, RefreshCw, Rows3, Search, SearchX, ShoppingBag, TriangleAlert, UserX, Wallet, X } from 'lucide-react';
import { Order, OrderStatus } from '../types';
import { inr, timeAgo } from '../lib/tokens';
import { cancelledByLabel, isCriticalFlag, isTerminal, isUnpaidOpen, orderFlags } from '../lib/orders';
import { Avatar } from './ui/Avatar';
import { EmptyState } from './ui/EmptyState';
import { Skeleton } from './ui/Skeleton';
import { StatusPill } from './ui/StatusPill';
import { OtpLockedPill, PaymentPill, RefundPill, TonePill } from './ui/OrderBadges';
import { AdvanceHandler, NextStepControl, shortId } from './OrderControls';
import { PaginationBar } from './ui/Pagination';
import { GroupBadge } from './ui/GroupBadge';
import { groupSearchTerms } from '../lib/orderGroups';

interface OrdersTableProps {
  orders: Order[];
  /** Order ids the server (or the local fallback) lists under "Needs attention". */
  attentionIds: Set<string>;
  onAdvance: AdvanceHandler;
  onOpenOrder: (orderId: string) => void;
  loading?: boolean;
  /** Global search text from the header. */
  query?: string;
  onClearQuery?: () => void;
  /** Clock from the app (ticks every 30 s) so time-based flags such as "not accepted" appear without a reload. */
  now: number;
  /** The server has orders older than the loaded ones. */
  hasMore?: boolean;
  loadingOlder?: boolean;
  /** Fetches the next older page. */
  onLoadOlder?: () => void;
  /** Reloads the orders from the server. */
  onRefresh?: () => void;
  refreshing?: boolean;
}

type Filter = 'ALL' | 'ATTENTION' | 'UNPAID' | OrderStatus;

const FILTERS: Array<{ id: Filter; label: string; hint?: string }> = [
  { id: 'ALL', label: 'Toutes' },
  { id: 'ATTENTION', label: 'Alertes', hint: 'Remboursements échoués, OTP bloqués, problèmes de paiement et commandes bloquées' },
  { id: 'UNPAID', label: 'Non payées', hint: 'Commandes en cours que le client n’a pas encore payées (invisibles pour les restaurants et livreurs)' },
  { id: 'PLACED', label: 'Nouvelles' },
  { id: 'ACCEPTED', label: 'Acceptées' },
  { id: 'PREPARING', label: 'En préparation' },
  { id: 'READY_FOR_PICKUP', label: 'Prêtes' },
  { id: 'PICKED_UP', label: 'En route' },
  { id: 'ARRIVED_AT_GATE', label: 'Au portail' },
  { id: 'DELIVERED', label: 'Livrées' },
  { id: 'CANCELLED', label: 'Annulées' },
];

type Period = 'all' | 'today' | 'week' | 'month';
const PERIODS: Array<{ id: Period; label: string }> = [
  { id: 'all', label: 'Toute la période' },
  { id: 'today', label: 'Aujourd’hui' },
  { id: 'week', label: '7 derniers jours' },
  { id: 'month', label: '30 derniers jours' },
];
const periodStart = (period: Period, now: number): number | null => {
  if (period === 'all') return null;
  if (period === 'today') return new Date(now).setHours(0, 0, 0, 0);
  return now - (period === 'week' ? 7 : 30) * 86_400_000;
};

type ColumnKey = 'customer' | 'vendor' | 'driver' | 'amount' | 'payment' | 'status';
const COLUMNS: Array<{ key: ColumnKey; label: string }> = [
  { key: 'customer', label: 'Client et livraison' }, { key: 'vendor', label: 'Restaurant' }, { key: 'driver', label: 'Livreur' },
  { key: 'amount', label: 'Montant' }, { key: 'payment', label: 'Paiement' }, { key: 'status', label: 'Statut' },
];
type SortField = 'date' | 'amount';
const PREFS_KEY = 'kraveo_orders_prefs';
const loadPrefs = (): { hidden: ColumnKey[]; view: 'table' | 'grid' } => {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
    return { hidden: Array.isArray(raw.hidden) ? raw.hidden : [], view: raw.view === 'grid' ? 'grid' : 'table' };
  } catch { return { hidden: [], view: 'table' }; }
};

const csvCell = (value: unknown): string => `"${String(value ?? '').replace(/"/g, '""')}"`;
const exportCsv = (rows: Order[]) => {
  const head = ['Commande', 'Date', 'Client', 'Téléphone', 'Livraison', 'Restaurant', 'Livreur', 'Montant (FCFA)', 'Paiement', 'Statut'];
  const lines = rows.map((o) => [o.id, o.createdAt, o.customerName, o.customerPhone, o.dropoffHostel, o.vendorName, o.driverName, o.totalAmount, o.paymentStatus, o.status].map(csvCell).join(';'));
  const blob = new Blob([`\uFEFF${[head.map(csvCell).join(';'), ...lines].join('\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `commandes-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

const RunnerCell: React.FC<{ name?: string; unpaid: boolean; finished?: boolean }> = ({ name, unpaid, finished }) => (!name && finished)
  ? <span className="text-xs text-kraveo-ink3">Aucun livreur</span>
  : name
  ? <span className="flex min-w-0 items-center gap-2"><Avatar name={name} size="sm" /><span className="truncate font-bold text-kraveo-ink">{name}</span></span>
  : <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${unpaid ? 'bg-kraveo-surface2 text-kraveo-ink3' : 'bg-kraveo-status-placed/15 text-kraveo-status-placed'}`}><UserX className="h-3 w-3" aria-hidden="true" />{unpaid ? 'Pas encore proposée' : 'Non assignée'}</span>;

/** Status pill plus the "why" for cancelled orders and any problem badges. */
const StatusCell: React.FC<{ order: Order; now: number; attention: boolean }> = ({ order, now, attention }) => {
  const flags = orderFlags(order, now).filter((f) => f.code !== 'OTP_LOCKED' && f.code !== 'REFUND_FAILED' && f.code !== 'REFUND_PENDING');
  return (
    <div className="flex flex-col items-start gap-1">
      <StatusPill status={order.status} compact />
      {order.status === 'CANCELLED' && (
        <p className="max-w-[10rem] truncate text-[11px] text-kraveo-ink3" title={order.cancelReason ?? undefined}>
          par <span className="font-bold text-kraveo-ink2">{cancelledByLabel(order.cancelledBy)}</span>{order.cancelReason ? ` · ${order.cancelReason}` : ''}
        </p>
      )}
      <OtpLockedPill order={order} />
      {flags.map((f) => <TonePill key={f.code} tone={f.tone}>{f.label}</TonePill>)}
      {attention && flags.length === 0 && !order.otpLocked && order.refundStatus !== 'FAILED' && <TonePill tone="warning" icon={TriangleAlert}>Alertes</TonePill>}
    </div>
  );
};

const PaymentCell: React.FC<{ order: Order }> = ({ order }) => (
  <div className="flex flex-col items-start gap-1">
    <PaymentPill status={order.paymentStatus} />
    <RefundPill order={order} />
  </div>
);

export const OrdersTable: React.FC<OrdersTableProps> = ({ orders, attentionIds, onAdvance, onOpenOrder, loading = false, query = '', onClearQuery, now, hasMore = false, loadingOlder = false, onLoadOlder, onRefresh, refreshing = false }) => {
  const [filter, setFilter] = useState<Filter>('ALL');
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState<Period>('all');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [menu, setMenu] = useState<'period' | 'amount' | 'columns' | null>(null);
  const [prefs] = useState(loadPrefs);
  const [hidden, setHidden] = useState<ColumnKey[]>(prefs.hidden);
  const [view, setView] = useState<'table' | 'grid'>(prefs.view);
  const [sort, setSort] = useState<{ field: SortField; dir: 'asc' | 'desc' } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ hidden, view })); } catch { /* storage blocked: preferences last for this visit only */ } }, [hidden, view]);
  const show = (key: ColumnKey) => !hidden.includes(key);
  const toggleColumn = (key: ColumnKey) => setHidden((current) => (current.includes(key) ? current.filter((k) => k !== key) : [...current, key]));
  const toggleSort = (field: SortField) => setSort((current) => (current?.field !== field ? { field, dir: 'desc' } : current.dir === 'desc' ? { field, dir: 'asc' } : null));
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);

  const needsAttention = useMemo(() => {
    const ids = new Set(attentionIds);
    orders.forEach((order) => { if (orderFlags(order, now).some(isCriticalFlag)) ids.add(order.id); });
    return ids;
  }, [orders, attentionIds, now]);

  const counts = useMemo(() => {
    const map: Record<string, number> = { ALL: orders.length, ATTENTION: 0, UNPAID: 0 };
    orders.forEach((order) => {
      map[order.status] = (map[order.status] ?? 0) + 1;
      if (isUnpaidOpen(order)) map.UNPAID += 1;
      if (needsAttention.has(order.id)) map.ATTENTION += 1;
    });
    return map;
  }, [orders, needsAttention]);

  const filteredOrders = useMemo(() => {
    const q = `${query} ${search}`.trim().toLowerCase();
    const since = periodStart(period, now);
    const min = amountMin === '' ? null : Number(amountMin);
    const max = amountMax === '' ? null : Number(amountMax);
    return orders.filter((o) => {
      if (since !== null && new Date(o.createdAt).getTime() < since) return false;
      if (min !== null && Number.isFinite(min) && o.totalAmount < min) return false;
      if (max !== null && Number.isFinite(max) && o.totalAmount > max) return false;
      const matchesSearch = !q || [o.id, o.customerName, o.customerPhone, o.vendorName, o.dropoffHostel, o.driverName, o.razorpayPaymentId, o.razorpayOrderId, o.cancelReason, ...groupSearchTerms(o.group)]
        .some((value) => Boolean(value) && String(value).toLowerCase().includes(q));
      if (!matchesSearch) return false;
      if (filter === 'ALL') return true;
      if (filter === 'ATTENTION') return needsAttention.has(o.id);
      if (filter === 'UNPAID') return isUnpaidOpen(o);
      return o.status === filter;
    });
  }, [orders, query, search, filter, needsAttention, period, amountMin, amountMax, now]);

  const sortedOrders = useMemo(() => {
    if (!sort) return filteredOrders;
    const value = (o: Order) => (sort.field === 'amount' ? o.totalAmount : new Date(o.createdAt).getTime());
    return [...filteredOrders].sort((a, b) => (sort.dir === 'asc' ? value(a) - value(b) : value(b) - value(a)));
  }, [filteredOrders, sort]);
  const pageCount = Math.max(1, Math.ceil(filteredOrders.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pagedOrders = useMemo(() => sortedOrders.slice((currentPage - 1) * pageSize, currentPage * pageSize), [sortedOrders, currentPage, pageSize]);
  const pageAllSelected = pagedOrders.length > 0 && pagedOrders.every((o) => selected.has(o.id));
  const toggleOne = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const togglePage = () => setSelected((current) => { const next = new Set(current); pagedOrders.forEach((o) => (pageAllSelected ? next.delete(o.id) : next.add(o.id))); return next; });
  const selectedOrders = useMemo(() => orders.filter((o) => selected.has(o.id)), [orders, selected]);
  // Any change of filter brings the reader back to the first page.
  useEffect(() => { setPage(1); }, [filter, search, query, period, amountMin, amountMax, pageSize]);
  const initialLoad = loading && orders.length === 0;
  const hasExtraFilters = period !== 'all' || amountMin !== '' || amountMax !== '';
  const isFiltered = filter !== 'ALL' || query.trim().length > 0 || search.trim().length > 0 || hasExtraFilters;
  const clearAll = () => { setFilter('ALL'); setSearch(''); setPeriod('all'); setAmountMin(''); setAmountMax(''); onClearQuery?.(); };
  const open = (event: React.MouseEvent, id: string) => {
    if (!(event.target as HTMLElement).closest('[data-no-row-click]')) onOpenOrder(id);
  };

  const emptyState = orders.length === 0
    ? <EmptyState icon={ClipboardList} title="Aucune commande pour l’instant" description="Les commandes des clients apparaissent ici en temps réel." />
    : (
      <EmptyState
        icon={SearchX}
        title={filter === 'ATTENTION' && !query.trim() && !search.trim() ? 'Rien à traiter' : 'Aucune commande correspondante'}
        description={filter === 'ATTENTION' && !query.trim() && !search.trim() ? 'Aucune commande chargée n’a de problème connu pour le moment.' : 'Rien ne correspond au filtre et à la recherche actuels.'}
        action={<button className="k-btn-ghost" onClick={clearAll}>Effacer les filtres</button>}
      />
    );

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-kraveo-surface2 text-kraveo-ink2 sm:h-12 sm:w-12"><ShoppingBag className="h-6 w-6" aria-hidden="true" /></span>
          <div className="min-w-0">
            <h1 className="truncate font-display text-lg font-bold text-kraveo-ink sm:text-xl">Commandes</h1>
            <p className="truncate text-xs text-kraveo-ink3 sm:text-sm">Suivez, filtrez et gérez toutes les commandes de la plateforme</p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          {onRefresh && (
            <button type="button" className="k-btn-ghost !px-3" onClick={onRefresh} disabled={refreshing} aria-label="Actualiser les commandes" title="Actualiser">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
          )}
          <button type="button" className="k-btn-ghost" onClick={() => exportCsv(filteredOrders)} disabled={filteredOrders.length === 0}>
            <Download className="h-4 w-4" aria-hidden="true" />Exporter en CSV
          </button>
        </div>
      </div>

      {/* Attention banner */}
      {counts.ATTENTION > 0 && (
        <div className="flex flex-col gap-3 rounded-k-lg border border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50 p-4 sm:flex-row sm:items-center">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-k-md bg-amber-100 text-amber-600"><TriangleAlert className="h-5 w-5" aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-sm font-bold text-kraveo-ink">Des commandes demandent votre attention</h2>
            <p className="text-sm text-kraveo-ink2"><span className="font-bold text-amber-700">{counts.ATTENTION}</span> commande{counts.ATTENTION > 1 ? 's' : ''} avec un problème : remboursement échoué, code bloqué, paiement ou commande bloquée.</p>
          </div>
          <button type="button" onClick={() => setFilter('ATTENTION')} className="self-start whitespace-nowrap rounded-k-sm bg-amber-100 px-3 py-1.5 text-sm font-bold text-amber-800 transition-colors hover:bg-amber-200 sm:self-auto">Voir les alertes</button>
        </div>
      )}

      {/* Search */}
      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-kraveo-ink3" aria-hidden="true" />
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Rechercher une commande"
          placeholder="Rechercher par numéro, client, restaurant, livreur, lieu…"
          className="w-full rounded-k-lg border border-kraveo-line bg-kraveo-surface py-3 pl-11 pr-4 text-sm text-kraveo-ink placeholder:text-kraveo-ink3 focus:border-kraveo-g500 focus:outline-none focus:ring-2 focus:ring-kraveo-g500/20" />
      </div>

      {/* Underline tabs (status) */}
      <div className="-mt-1 border-b border-kraveo-line">
        <nav className="-mb-px flex gap-4 overflow-x-auto scrollbar-none sm:gap-6" role="group" aria-label="Filtrer les commandes">
          {FILTERS.map((f) => {
            const active = filter === f.id;
            const count = counts[f.id] ?? 0;
            const alert = f.id === 'ATTENTION' && count > 0;
            return (
              <button key={f.id} type="button" aria-pressed={active} title={f.hint} onClick={() => setFilter(f.id)}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-1 py-3 text-sm font-semibold transition-colors ${active ? 'border-kraveo-g500 text-kraveo-g600' : 'border-transparent text-kraveo-ink3 hover:border-kraveo-line hover:text-kraveo-ink'} ${alert && !active ? '!text-kraveo-danger' : ''}`}>
                {f.label}
                {count > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums ${active ? 'bg-kraveo-g500/10 text-kraveo-g600' : alert ? 'bg-kraveo-danger/10 text-kraveo-danger' : 'bg-kraveo-surface2 text-kraveo-ink3'}`}>{count}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Period + amount filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <button type="button" onClick={() => setMenu(menu === 'period' ? null : 'period')} aria-expanded={menu === 'period'}
            className={`inline-flex items-center gap-2 rounded-k-sm border border-kraveo-line bg-kraveo-surface px-3 py-2 text-sm font-semibold transition-colors hover:bg-kraveo-surface2 ${period !== 'all' ? 'text-kraveo-g600' : 'text-kraveo-ink2'}`}>
            <CalendarDays className="h-4 w-4" aria-hidden="true" />{PERIODS.find((p) => p.id === period)?.label}<ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
          {menu === 'period' && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} aria-hidden="true" />
              <ul className="absolute left-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-k-md border border-kraveo-line bg-kraveo-surface py-1 shadow-k-lift">
                {PERIODS.map((p) => (
                  <li key={p.id}><button type="button" onClick={() => { setPeriod(p.id); setMenu(null); }} className={`w-full px-4 py-2 text-left text-sm hover:bg-kraveo-surface2 ${period === p.id ? 'font-bold text-kraveo-g600' : 'text-kraveo-ink2'}`}>{p.label}</button></li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="relative">
          <button type="button" onClick={() => setMenu(menu === 'amount' ? null : 'amount')} aria-expanded={menu === 'amount'}
            className={`inline-flex items-center gap-2 rounded-k-sm border border-kraveo-line bg-kraveo-surface px-3 py-2 text-sm font-semibold transition-colors hover:bg-kraveo-surface2 ${amountMin !== '' || amountMax !== '' ? 'text-kraveo-g600' : 'text-kraveo-ink2'}`}>
            <Wallet className="h-4 w-4" aria-hidden="true" />{amountMin !== '' || amountMax !== '' ? `${amountMin || '0'} – ${amountMax || '∞'} FCFA` : 'Montant'}<ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
          {menu === 'amount' && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} aria-hidden="true" />
              <div className="absolute left-0 top-full z-30 mt-1 w-72 space-y-3 rounded-k-md border border-kraveo-line bg-kraveo-surface p-4 shadow-k-lift">
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-xs text-kraveo-ink3">Minimum
                    <input type="number" min={0} inputMode="numeric" value={amountMin} onChange={(event) => setAmountMin(event.target.value)} placeholder="0" className="k-input mt-1 w-full" />
                  </label>
                  <label className="text-xs text-kraveo-ink3">Maximum
                    <input type="number" min={0} inputMode="numeric" value={amountMax} onChange={(event) => setAmountMax(event.target.value)} placeholder="∞" className="k-input mt-1 w-full" />
                  </label>
                </div>
                {(amountMin !== '' || amountMax !== '') && <button type="button" onClick={() => { setAmountMin(''); setAmountMax(''); setMenu(null); }} className="w-full rounded-k-sm py-1.5 text-xs font-bold text-kraveo-danger hover:bg-kraveo-danger/10">Effacer le montant</button>}
              </div>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-k-sm border border-kraveo-line bg-kraveo-surface" role="group" aria-label="Affichage">
            <button type="button" onClick={() => setView('table')} aria-pressed={view === 'table'} title="Vue tableau" className={`p-2 ${view === 'table' ? 'bg-kraveo-g500 text-white' : 'text-kraveo-ink3 hover:bg-kraveo-surface2'}`}><Rows3 className="h-4 w-4" aria-hidden="true" /></button>
            <button type="button" onClick={() => setView('grid')} aria-pressed={view === 'grid'} title="Vue cartes" className={`p-2 ${view === 'grid' ? 'bg-kraveo-g500 text-white' : 'text-kraveo-ink3 hover:bg-kraveo-surface2'}`}><LayoutGrid className="h-4 w-4" aria-hidden="true" /></button>
          </div>
          <div className="relative hidden xl:block">
            <button type="button" onClick={() => setMenu(menu === 'columns' ? null : 'columns')} aria-expanded={menu === 'columns'} className="inline-flex items-center gap-2 rounded-k-sm border border-kraveo-line bg-kraveo-surface px-3 py-2 text-sm font-semibold text-kraveo-ink2 transition-colors hover:bg-kraveo-surface2">
              <Columns3 className="h-4 w-4" aria-hidden="true" />Colonnes
            </button>
            {menu === 'columns' && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} aria-hidden="true" />
                <ul className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-k-md border border-kraveo-line bg-kraveo-surface py-1 shadow-k-lift">
                  {COLUMNS.map((c) => (
                    <li key={c.key}>
                      <button type="button" onClick={() => toggleColumn(c.key)} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-kraveo-ink2 hover:bg-kraveo-surface2">
                        <span className={`flex h-4 w-4 items-center justify-center rounded border ${show(c.key) ? 'border-kraveo-g500 bg-kraveo-g500 text-white' : 'border-kraveo-line'}`}>{show(c.key) && <Check className="h-3 w-3" aria-hidden="true" />}</span>{c.label}
                      </button>
                    </li>
                  ))}
                  {hidden.length > 0 && <li className="border-t border-kraveo-line"><button type="button" onClick={() => setHidden([])} className="w-full px-4 py-2 text-left text-xs font-bold text-kraveo-g600 hover:bg-kraveo-surface2">Tout afficher</button></li>}
                </ul>
              </>
            )}
          </div>
        </div>
        {isFiltered && <button type="button" onClick={clearAll} className="inline-flex items-center gap-1 rounded-k-sm px-2 py-2 text-sm font-semibold text-kraveo-ink3 hover:text-kraveo-ink"><X className="h-4 w-4" aria-hidden="true" />Effacer les filtres</button>}
      </div>

      <p className="px-1 text-xs text-kraveo-ink3" aria-live="polite">
        Affichage de <span className="font-bold text-kraveo-ink">{filteredOrders.length}</span> sur {orders.length} {orders.length === 1 ? 'commande chargée' : 'commandes chargées'}{isFiltered ? ' (filtrées)' : ''}{hasMore ? ', les plus récentes d’abord. Les commandes plus anciennes ne sont pas encore chargées' : ''}. Sélectionnez une commande pour voir le détail et les actions admin.
      </p>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-k-lg border border-kraveo-g500/30 bg-kraveo-g500/5 px-4 py-3" role="status">
          <span className="text-sm font-bold text-kraveo-ink">{selected.size} commande{selected.size > 1 ? 's' : ''} sélectionnée{selected.size > 1 ? 's' : ''}</span>
          <div className="flex items-center gap-2">
            <button type="button" className="k-btn-ghost" onClick={() => exportCsv(selectedOrders)}><Download className="h-4 w-4" aria-hidden="true" />Exporter la sélection</button>
            <button type="button" className="k-btn-ghost" onClick={() => setSelected(new Set())}><X className="h-4 w-4" aria-hidden="true" />Désélectionner</button>
          </div>
        </div>
      )}

      {/* Desktop table (1280 px and up) */}
      <div className={`k-card hidden overflow-x-auto ${view === 'table' ? 'xl:block' : ''}`}>
        <table className="w-full min-w-[1000px] border-separate border-spacing-0 text-left text-sm">
          <thead>
            <tr>
              <th scope="col" className="w-12 border-b border-kraveo-line bg-kraveo-surface px-4 py-3.5 first:rounded-tl-k-xl">
                <input type="checkbox" checked={pageAllSelected} onChange={togglePage} aria-label="Sélectionner toutes les commandes de la page" className="h-4 w-4 rounded border-kraveo-line accent-[#2F5BE0]" />
              </th>
              <th scope="col" aria-sort={sort?.field === 'date' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="k-label border-b border-kraveo-line bg-kraveo-surface px-4 py-3.5">
                <button type="button" onClick={() => toggleSort('date')} className="inline-flex items-center gap-1 uppercase tracking-[0.08em] hover:text-kraveo-ink" title="Trier par date">
                  Commande{sort?.field === 'date' ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />) : <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />}
                </button>
              </th>
              {show('customer') && <th scope="col" className="k-label border-b border-kraveo-line bg-kraveo-surface px-4 py-3.5">Client et livraison</th>}
              {show('vendor') && <th scope="col" className="k-label border-b border-kraveo-line bg-kraveo-surface px-4 py-3.5">Restaurant</th>}
              {show('driver') && <th scope="col" className="k-label border-b border-kraveo-line bg-kraveo-surface px-4 py-3.5">Livreur</th>}
              {show('amount') && (
                <th scope="col" aria-sort={sort?.field === 'amount' ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'} className="k-label border-b border-kraveo-line bg-kraveo-surface px-4 py-3.5">
                  <button type="button" onClick={() => toggleSort('amount')} className="inline-flex items-center gap-1 uppercase tracking-[0.08em] hover:text-kraveo-ink" title="Trier par montant">
                    Montant{sort?.field === 'amount' ? (sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />) : <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />}
                  </button>
                </th>
              )}
              {show('payment') && <th scope="col" className="k-label border-b border-kraveo-line bg-kraveo-surface px-4 py-3.5">Paiement</th>}
              {show('status') && <th scope="col" className="k-label border-b border-kraveo-line bg-kraveo-surface px-4 py-3.5">Statut</th>}
              <th scope="col" className="k-label border-b border-kraveo-line bg-kraveo-surface px-4 py-3.5 text-right last:rounded-tr-k-xl">Étape suivante</th>
            </tr>
          </thead>
          <tbody>
            {initialLoad && Array.from({ length: 6 }).map((_, index) => (
              <tr key={index}><td colSpan={9} className="border-b border-kraveo-line/60 px-4 py-3"><Skeleton className="h-10 w-full" /></td></tr>
            ))}
            {!initialLoad && filteredOrders.length === 0 && <tr><td colSpan={9}>{emptyState}</td></tr>}
            {pagedOrders.map((order, index) => {
              const attention = needsAttention.has(order.id);
              const cell = 'border-b border-kraveo-line/60 px-4 py-3.5 align-top';
              return (
                <tr
                  key={order.id}
                  className={`k-reveal group cursor-pointer transition-colors hover:bg-kraveo-surface2/60 ${attention ? 'bg-kraveo-danger/[0.04]' : ''}`}
                  style={{ ['--i' as string]: Math.min(index, 12) }}
                  onClick={(event) => open(event, order.id)}
                >
                  <td className={`${cell} w-12`} data-no-row-click>
                    <input type="checkbox" checked={selected.has(order.id)} onChange={() => toggleOne(order.id)} aria-label={`Sélectionner la commande ${shortId(order.id)}`} className="h-4 w-4 rounded border-kraveo-line accent-[#2F5BE0]" />
                  </td>
                  <td className={cell}>
                    <button
                      aria-haspopup="dialog"
                      aria-label={`Ouvrir la commande ${shortId(order.id)}`}
                      onClick={(event) => { event.stopPropagation(); onOpenOrder(order.id); }}
                      className="flex items-center gap-2 rounded-lg text-left"
                    >
                      {attention ? <TriangleAlert className="h-4 w-4 shrink-0 text-kraveo-danger" aria-label="Alertes" /> : <ChevronRight className="h-4 w-4 shrink-0 text-kraveo-ink3 group-hover:text-kraveo-g600" aria-hidden="true" />}
                      <span>
                        <span className="block font-mono text-xs font-bold text-kraveo-ink" title={order.id}>{shortId(order.id)}</span>
                        <span className="block text-[11px] text-kraveo-ink3">{timeAgo(order.createdAt)}</span>
                      </span>
                    </button>
                    {order.group && <div className="mt-1.5"><GroupBadge group={order.group} /></div>}
                  </td>
                  {show('customer') && <td className={`${cell} min-w-[10rem] max-w-[18rem]`}>
                    <div className="font-bold text-kraveo-ink [overflow-wrap:anywhere]">{order.customerName}</div>
                    <div className="flex items-center gap-1 text-xs text-kraveo-ink2 [overflow-wrap:anywhere]"><MapPin className="h-3 w-3 shrink-0 text-kraveo-ink3" aria-hidden="true" />{order.dropoffHostel}</div>
                  </td>}
                  {show('vendor') && <td className={`${cell} font-semibold text-kraveo-ink2 [overflow-wrap:anywhere]`}>{order.vendorName}</td>}
                  {show('driver') && <td className={cell}><RunnerCell name={order.driverName} unpaid={order.paymentStatus !== 'PAID'} finished={isTerminal(order.status)} /></td>}
                  {show('amount') && <td className={`k-num ${cell} text-base text-kraveo-ink`}>{inr(order.totalAmount)}{order.group && <span className="block font-sans text-[10px] font-medium text-kraveo-ink3">part de ce restaurant</span>}</td>}
                  {show('payment') && <td className={cell}><PaymentCell order={order} /></td>}
                  {show('status') && <td className={cell}><StatusCell order={order} now={now} attention={attention} /></td>}
                  <td className={`${cell} text-right`}>
                    <NextStepControl order={order} onAdvance={onAdvance} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Cards below 1280 px */}
      <div className={`grid items-start gap-3 md:grid-cols-2 ${view === 'table' ? 'xl:hidden' : 'xl:grid-cols-3'}`}>
        {initialLoad && Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-40 w-full !rounded-k-xl" />)}
        {!initialLoad && filteredOrders.length === 0 && <div className="k-card md:col-span-2">{emptyState}</div>}
        {pagedOrders.map((order, index) => {
          const attention = needsAttention.has(order.id);
          return (
            <article key={order.id} className={`k-card k-reveal min-w-0 p-4 ${attention ? '!border-kraveo-danger/40' : ''}`} style={{ ['--i' as string]: Math.min(index, 10) }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-xs font-bold text-kraveo-ink" title={order.id}>{shortId(order.id)} <span className="font-sans font-medium text-kraveo-ink3">· {timeAgo(order.createdAt)}</span></p>
                  <p className="mt-1 truncate font-bold text-kraveo-ink">{order.customerName}</p>
                  <p className="flex items-center gap-1 text-xs text-kraveo-ink2"><MapPin className="h-3 w-3 text-kraveo-ink3" aria-hidden="true" /><span className="truncate">{order.dropoffHostel}</span></p>
                  {order.group && <div className="mt-1.5"><GroupBadge group={order.group} /></div>}
                </div>
                <StatusCell order={order} now={now} attention={attention} />
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-kraveo-ink2">{order.vendorName}</span>
                <span className="k-num shrink-0 text-lg text-kraveo-ink">{inr(order.totalAmount)}{order.group && <span className="block text-right font-sans text-[10px] font-medium text-kraveo-ink3">share</span>}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <RunnerCell name={order.driverName} unpaid={order.paymentStatus !== 'PAID'} finished={isTerminal(order.status)} />
                <div className="flex flex-wrap justify-end gap-1"><PaymentPill status={order.paymentStatus} /><RefundPill order={order} /></div>
              </div>
              <div className="mt-3"><NextStepControl order={order} onAdvance={onAdvance} stacked /></div>
              <button
                aria-haspopup="dialog"
                onClick={() => onOpenOrder(order.id)}
                className="mt-3 flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-k-sm text-xs font-bold text-kraveo-g700 hover:bg-kraveo-surface2"
              >
                {isTerminal(order.status) ? 'Détails' : order.paymentStatus === 'PAID' ? 'Détails, annulation et remboursement' : 'Détails et annulation'}<ChevronRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </article>
          );
        })}
      </div>

      <PaginationBar page={currentPage} pageCount={pageCount} pageSize={pageSize} total={filteredOrders.length} onPage={setPage} onPageSize={setPageSize} noun="commandes" />

      {hasMore && onLoadOlder && (
        <div className="flex justify-center pt-1">
          <button type="button" className="k-btn-ghost" onClick={onLoadOlder} disabled={loadingOlder} aria-busy={loadingOlder}>
            {loadingOlder ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}Charger les commandes plus anciennes
          </button>
        </div>
      )}
    </div>
  );
};
