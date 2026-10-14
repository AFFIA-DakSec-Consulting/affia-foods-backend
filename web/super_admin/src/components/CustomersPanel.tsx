import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Coins, Download, Eye, GraduationCap, Loader2, Mail, MapPin, Phone, Receipt, SearchX, ShoppingBag, UserX, Users, Wallet } from 'lucide-react';
import { CustomerDetail, CustomerOrder, CustomerRow } from '../types';
import { apiService } from '../services/api';
import { inr, timeAgo } from '../lib/tokens';
import { orderCode } from '../lib/orders';
import { AnimatedNumber } from './ui/AnimatedNumber';
import { Avatar } from './ui/Avatar';
import { Drawer } from './ui/Drawer';
import { EmptyState } from './ui/EmptyState';
import { KpiTile } from './ui/KpiTile';
import { Skeleton, SkeletonCard } from './ui/Skeleton';
import { StatusPill } from './ui/StatusPill';
import { PaginationBar, usePagination } from './ui/Pagination';
import { ColumnsMenu, PageHeader, SearchField, SelectionBar, SortHeader, UnderlineTabs, ViewToggle, downloadCsv, nextSort, useTablePrefs } from './ui/PageToolbar';

interface Props {
  /** The header search box. Sent to the server (debounced) so every customer is searchable, not just the loaded page. */
  query: string;
  onClearQuery: () => void;
  onQueryChange?: (value: string) => void;
  onRefresh?: () => void;
  onAuthError: (error: unknown) => void;
}

type CustomerColumn = 'phone' | 'where' | 'orders' | 'spent' | 'last' | 'joined';
const CUSTOMER_COLUMNS: Array<{ key: CustomerColumn; label: string }> = [
  { key: 'phone', label: 'Téléphone' }, { key: 'where', label: 'Résidence' }, { key: 'orders', label: 'Commandes' },
  { key: 'spent', label: 'Payé' }, { key: 'last', label: 'Dernière commande' }, { key: 'joined', label: 'Inscription' },
];
type CustomerSort = 'name' | 'orders' | 'spent' | 'last' | 'joined';
type CustomerTab = 'ALL' | 'ORDERED' | 'NEVER';

const dateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const dateOnly = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const where = (c: Pick<CustomerRow, 'isStudent' | 'hostelBlock'>) => (c.isStudent === false ? 'Pas de résidence' : c.hostelBlock || '—');

const PAYMENT_TONE: Record<string, string> = {
  PAID: 'bg-kraveo-g500/10 text-kraveo-g700',
  PENDING: 'bg-kraveo-status-placed/15 text-kraveo-status-placed',
  FAILED: 'bg-kraveo-danger/15 text-kraveo-danger',
  REFUNDED: 'bg-kraveo-status-pickedUp/15 text-kraveo-status-pickedUp',
};
const PayPill: React.FC<{ status: string }> = ({ status }) => (
  <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold ${PAYMENT_TONE[status] ?? 'bg-kraveo-surface2 text-kraveo-ink2'}`}>{status.charAt(0) + status.slice(1).toLowerCase()}</span>
);

const InfoRow: React.FC<{ icon: React.ElementType; label: string; children: React.ReactNode }> = ({ icon: Icon, label, children }) => (
  <div className="k-inset flex items-start gap-3 px-4 py-3">
    <Icon className="mt-0.5 h-4 w-4 shrink-0 text-kraveo-ink3" aria-hidden="true" />
    <div className="min-w-0"><p className="k-label">{label}</p><div className="mt-0.5 break-words text-sm font-bold text-kraveo-ink">{children}</div></div>
  </div>
);

export const CustomersPanel: React.FC<Props> = ({ query, onClearQuery, onQueryChange, onRefresh, onAuthError }) => {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const loadFirst = useCallback(async (search: string) => {
    const seq = ++requestSeq.current;
    setLoading(true); setError('');
    try {
      const page = await apiService.fetchCustomers(search);
      if (seq !== requestSeq.current) return;
      setRows(page.data); setTotal(page.total); setCursor(page.nextCursor);
    } catch (e) {
      if (seq !== requestSeq.current) return;
      onAuthError(e);
      setError(e instanceof Error ? e.message : 'Les clients n’ont pas pu être chargés.');
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [onAuthError]);

  useEffect(() => {
    const timer = window.setTimeout(() => loadFirst(query), query ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [query, loadFirst]);

  const loadMore = async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await apiService.fetchCustomers(query, cursor);
      setRows((current) => [...current, ...page.data.filter((p) => !current.some((c) => c.id === p.id))]);
      setCursor(page.nextCursor);
    } catch (e) {
      onAuthError(e);
    } finally { setLoadingMore(false); }
  };

  const totalSpentLoaded = rows.reduce((sum, r) => sum + r.totalSpent, 0);
  const withOrders = rows.filter((r) => r.ordersCount > 0).length;
  const prefs = useTablePrefs<CustomerColumn>('kraveo_customers_prefs');
  const [tab, setTab] = useState<CustomerTab>('ALL');
  const [sort, setSort] = useState<{ field: CustomerSort; dir: 'asc' | 'desc' } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const tabRows = useMemo(() => rows.filter((r) => (tab === 'ALL' ? true : tab === 'ORDERED' ? r.ordersCount > 0 : r.ordersCount === 0)), [rows, tab]);
  const sorted = useMemo(() => {
    if (!sort) return tabRows;
    const value = (c: CustomerRow): string | number => {
      switch (sort.field) {
        case 'name': return c.name.toLowerCase();
        case 'orders': return c.ordersCount;
        case 'spent': return c.totalSpent;
        case 'last': return c.lastOrderAt ? new Date(c.lastOrderAt).getTime() : 0;
        default: return new Date(c.createdAt).getTime();
      }
    };
    return [...tabRows].sort((a, b) => {
      const x = value(a); const y = value(b);
      const cmp = typeof x === 'string' ? x.localeCompare(String(y), 'fr') : x - (y as number);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [tabRows, sort]);
  const pager = usePagination(sorted, `${query}|${tab}`, 10);
  const pageAllSelected = pager.pageItems.length > 0 && pager.pageItems.every((c) => selected.has(c.id));
  const toggleOne = (id: string) => setSelected((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const togglePage = () => setSelected((cur) => { const next = new Set(cur); pager.pageItems.forEach((c) => (pageAllSelected ? next.delete(c.id) : next.add(c.id))); return next; });
  const exportCustomers = (list: CustomerRow[]) => downloadCsv('clients',
    ['Nom', 'E-mail', 'Téléphone', 'Résidence', 'Commandes', 'Payé (FCFA)', 'Dernière commande', 'Inscription'],
    list.map((c) => [c.name, c.email, c.phone, where(c), c.ordersCount, c.totalSpent, c.lastOrderAt, c.createdAt]));
  const sortState = (field: CustomerSort): false | 'asc' | 'desc' => (sort?.field === field ? sort.dir : false);
  const initialLoad = loading && rows.length === 0;
  const empty = !loading && rows.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader icon={Users} title="Clients" subtitle="Toutes les personnes connectées, avec leur historique de commandes" onRefresh={onRefresh ?? (() => loadFirst(query))} refreshing={loading && rows.length > 0} />
      {onQueryChange && <SearchField value={query} onChange={onQueryChange} label="Rechercher un client" placeholder="Rechercher par nom, e-mail, téléphone ou point de livraison…" />}
      <section aria-label="Résumé des clients" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiTile index={0} loading={initialLoad} label={query ? 'Clients correspondants' : 'Clients'} icon={Users} value={<AnimatedNumber value={total} />} note={query ? `Recherche « ${query} »` : 'Connectés avec Google'} />
        <KpiTile index={1} loading={initialLoad} label="Ont commandé" icon={ShoppingBag} tone="text-kraveo-status-pickedUp" toneBg="bg-kraveo-status-pickedUp/15" value={<AnimatedNumber value={withOrders} />} note={`Sur ${rows.length} affichés`} />
        <KpiTile index={2} loading={initialLoad} label="Payé par ces clients" icon={Wallet} tone="text-kraveo-status-ready" toneBg="bg-kraveo-status-ready/15" value={<AnimatedNumber value={totalSpentLoaded} suffix=" FCFA" />} note="Commandes payées, clients affichés" />
        <KpiTile index={3} loading={initialLoad} label="Chargés" icon={Receipt} tone="text-kraveo-status-atGate" toneBg="bg-kraveo-status-atGate/15" value={<>{rows.length}<span className="text-xl text-kraveo-ink3"> / {total}</span></>} note={cursor ? 'D’autres disponibles plus bas' : 'Tous chargés'} />
      </section>

      {error && <div role="alert" className="rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 px-4 py-3 text-sm text-kraveo-ink">{error}</div>}

      {empty && (
        <div className="k-card">
          <EmptyState icon={query ? SearchX : Users} title={query ? 'Aucun client correspondant' : 'Aucun client pour l’instant'} description={query ? 'Essayez un nom, un e-mail, un numéro de téléphone ou un point de livraison.' : 'Les clients apparaissent ici après leur connexion à l’application Affia Foods.'}
            action={query ? <button className="k-btn-ghost" onClick={onClearQuery}>Effacer la recherche</button> : undefined} />
        </div>
      )}

      {rows.length > 0 && (
        <>
          <UnderlineTabs label="Filtrer les clients" value={tab} onChange={setTab} tabs={[
            { id: 'ALL', label: 'Tous', count: rows.length },
            { id: 'ORDERED', label: 'Ont commandé', count: withOrders },
            { id: 'NEVER', label: 'Jamais commandé', count: rows.length - withOrders },
          ]} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="px-1 text-xs text-kraveo-ink3" aria-live="polite">{tabRows.length} client{tabRows.length > 1 ? 's' : ''} affiché{tabRows.length > 1 ? 's' : ''}{cursor ? ` (sur ${total}, les autres se chargent plus bas)` : ''}</p>
            <div className="flex items-center gap-2">
              <button type="button" className="k-btn-ghost" onClick={() => exportCustomers(tabRows)} disabled={tabRows.length === 0}><Download className="h-4 w-4" aria-hidden="true" />Exporter en CSV</button>
              <ViewToggle value={prefs.view} onChange={prefs.setView} />
              <ColumnsMenu columns={CUSTOMER_COLUMNS} hidden={prefs.hidden} onToggle={prefs.toggleColumn} onReset={prefs.resetColumns} />
            </div>
          </div>
          {selected.size > 0 && <SelectionBar count={selected.size} noun="client" onExport={() => exportCustomers(rows.filter((c) => selected.has(c.id)))} onClear={() => setSelected(new Set())} />}
        </>
      )}

      {/* Wide screens: a real table */}
      {rows.length > 0 && (
        <div className={`k-card hidden overflow-x-auto ${prefs.view === 'table' ? 'xl:block' : ''}`}>
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="k-label">
                <th scope="col" className="w-12 border-b border-kraveo-line px-4 py-3.5"><input type="checkbox" checked={pageAllSelected} onChange={togglePage} aria-label="Sélectionner tous les clients de la page" className="h-4 w-4 rounded border-kraveo-line accent-[#2F5BE0]" /></th>
                <th scope="col" className="w-[18rem] border-b border-kraveo-line px-4 py-3.5"><SortHeader label="Client" active={sortState('name')} onClick={() => setSort(nextSort(sort, 'name'))} /></th>
                {prefs.show('phone') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Téléphone</th>}
                {prefs.show('where') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Résidence</th>}
                {prefs.show('orders') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5"><SortHeader label="Commandes" active={sortState('orders')} onClick={() => setSort(nextSort(sort, 'orders'))} /></th>}
                {prefs.show('spent') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5"><SortHeader label="Payé" active={sortState('spent')} onClick={() => setSort(nextSort(sort, 'spent'))} /></th>}
                {prefs.show('last') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5"><SortHeader label="Dernière commande" active={sortState('last')} onClick={() => setSort(nextSort(sort, 'last'))} /></th>}
                {prefs.show('joined') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5"><SortHeader label="Inscription" active={sortState('joined')} onClick={() => setSort(nextSort(sort, 'joined'))} /></th>}
                <th scope="col" className="border-b border-kraveo-line px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pager.pageItems.length === 0 && <tr><td colSpan={9}><EmptyState icon={SearchX} title="Aucun client dans cet onglet" description="Changez d’onglet pour voir les autres clients chargés." className="py-8" /></td></tr>}
              {pager.pageItems.map((c) => {
                const cell = 'border-b border-kraveo-line/60 px-4 py-3 align-middle';
                return (
                  <tr key={c.id} tabIndex={0} onClick={() => setSelectedId(c.id)} onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(c.id); }}
                    className="cursor-pointer outline-none transition-colors hover:bg-kraveo-surface2/60 focus-visible:bg-kraveo-surface2/60" aria-label={`Ouvrir ${c.name}`}>
                    <td className={`${cell} w-12`} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} aria-label={`Sélectionner ${c.name}`} className="h-4 w-4 rounded border-kraveo-line accent-[#2F5BE0]" /></td>
                    <td className={`${cell} w-[18rem] max-w-[18rem]`}>
                      <div className="flex items-center gap-3"><Avatar name={c.name} size="sm" /><div className="min-w-0"><p className="truncate font-bold text-kraveo-ink" title={c.name}>{c.name}</p><p className="truncate text-xs text-kraveo-ink3" title={c.email ?? undefined}>{c.email ?? (c.deleted ? 'Compte supprimé' : 'Aucun e-mail')}</p></div></div>
                    </td>
                    {prefs.show('phone') && <td className={`${cell} whitespace-nowrap text-kraveo-ink2`}>{c.phone ? <span className="inline-flex items-center gap-1.5"><Phone className="h-3.5 w-3.5 text-kraveo-ink3" aria-hidden="true" />{c.phone}</span> : '—'}</td>}
                    {prefs.show('where') && <td className={`${cell} max-w-[12rem] truncate text-kraveo-ink2`}>{where(c)}</td>}
                    {prefs.show('orders') && <td className={`k-num ${cell} text-base text-kraveo-ink`}>{c.ordersCount}</td>}
                    {prefs.show('spent') && <td className={`k-num ${cell} whitespace-nowrap text-kraveo-ink`}>{inr(c.totalSpent)}</td>}
                    {prefs.show('last') && <td className={`${cell} whitespace-nowrap text-xs text-kraveo-ink3`}>{c.lastOrderAt ? timeAgo(c.lastOrderAt) : 'Jamais'}</td>}
                    {prefs.show('joined') && <td className={`${cell} whitespace-nowrap text-xs text-kraveo-ink3`}>{dateOnly(c.createdAt)}</td>}
                    <td className={`${cell} text-right`} onClick={(e) => e.stopPropagation()}>
                      <button type="button" title="Voir le détail" aria-label={`Voir le détail de ${c.name}`} onClick={() => setSelectedId(c.id)} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-kraveo-line bg-kraveo-surface text-kraveo-ink2 transition-colors hover:bg-kraveo-surface2"><Eye className="h-4 w-4" aria-hidden="true" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Cards: narrow screens, or when chosen */}
      <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${prefs.view === 'table' ? 'xl:hidden' : 'xl:grid-cols-3'}`}>
        {initialLoad && Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
        {pager.pageItems.map((c, index) => (
          <div key={c.id} role="button" tabIndex={0} aria-label={`Ouvrir ${c.name}`} onClick={() => setSelectedId(c.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(c.id); } }}
            className="k-card k-card-hover k-reveal cursor-pointer p-4" style={{ ['--i' as string]: Math.min(index, 10) }}>
            <div className="flex items-center gap-3">
              <Avatar name={c.name} size="md" />
              <div className="min-w-0 flex-1"><p className="truncate font-bold text-kraveo-ink">{c.name}</p><p className="truncate text-xs text-kraveo-ink3">{c.email ?? c.phone ?? (c.deleted ? 'Compte supprimé' : '—')}</p></div>
              <ChevronRight className="h-4 w-4 shrink-0 text-kraveo-ink3" aria-hidden="true" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="k-inset px-2 py-2"><p className="k-label !text-[10px]">Commandes</p><p className="k-num text-lg text-kraveo-ink">{c.ordersCount}</p></div>
              <div className="k-inset px-2 py-2"><p className="k-label !text-[10px]">Payé</p><p className="k-num text-lg text-kraveo-ink">{inr(c.totalSpent)}</p></div>
              <div className="k-inset px-2 py-2"><p className="k-label !text-[10px]">Dernière</p><p className="k-num text-sm leading-7 text-kraveo-ink">{c.lastOrderAt ? timeAgo(c.lastOrderAt) : 'Jamais'}</p></div>
            </div>
            <p className="mt-2 truncate text-xs text-kraveo-ink3">{where(c)} · Inscrit le {dateOnly(c.createdAt)}</p>
          </div>
        ))}
      </div>

      <PaginationBar page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} total={pager.total} onPage={pager.setPage} onPageSize={pager.setPageSize} noun="clients" />

      {cursor && (
        <div className="flex justify-center pt-1">
          <button className="k-btn-ghost" onClick={loadMore} disabled={loadingMore} aria-busy={loadingMore}>
            {loadingMore ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Chargement…</> : `Charger plus (${total - rows.length} restants)`}
          </button>
        </div>
      )}

      <CustomerDrawer id={selectedId} onClose={() => setSelectedId(null)} onAuthError={onAuthError} />
    </div>
  );
};

// ─────────────────────────── Detail drawer ───────────────────────────
const OrderBlock: React.FC<{ o: CustomerOrder }> = ({ o }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="k-inset">
      <button type="button" className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-kraveo-ink">{o.vendor?.name ?? 'Restaurant inconnu'}</p>
          <p className="font-mono text-[11px] text-kraveo-ink3">{orderCode(o.id)} · {dateTime(o.createdAt)}</p>
          <div className="mt-2 flex flex-wrap gap-1.5"><StatusPill status={o.status} compact /><PayPill status={o.paymentStatus} /></div>
        </div>
        <div className="shrink-0 text-right"><p className="k-num text-lg text-kraveo-ink">{inr(o.totalAmount)}</p><p className="text-[11px] text-kraveo-g700">{open ? 'Masquer' : 'Détails'}</p></div>
      </button>
      {open && (
        <div className="space-y-3 border-t border-kraveo-line px-4 py-3 text-sm">
          <ul className="space-y-1">
            {o.items.length === 0 && <li className="text-kraveo-ink3">Aucun article enregistré.</li>}
            {o.items.map((i, n) => <li key={n} className="flex justify-between gap-3"><span className="min-w-0 truncate text-kraveo-ink2"><b className="text-kraveo-g700">{i.quantity}×</b> {i.name}</span><span className="tabular-nums text-kraveo-ink">{inr(i.price * i.quantity)}</span></li>)}
            <li className="flex justify-between text-kraveo-ink3"><span>Livraison</span><span className="tabular-nums">{inr(o.deliveryFee)}</span></li>
          </ul>
          <p className="flex items-start gap-1.5 text-kraveo-ink2"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-kraveo-ink3" aria-hidden="true" />{o.dropoffHostel}{o.dropoffNotes ? ` — ${o.dropoffNotes}` : ''}</p>
          {o.driver && <p className="text-kraveo-ink2">Livreur : <b className="text-kraveo-ink">{o.driver.name}</b>{o.driver.phone ? <> · <a className="text-kraveo-g700 hover:underline" href={`tel:${o.driver.phone}`}>{o.driver.phone}</a></> : null}</p>}
          {o.payments.length > 0 && (
            <div className="rounded-k-sm bg-kraveo-night/60 p-2.5 font-mono text-[11px] text-kraveo-ink2">
              {o.payments.map((p) => <p key={p.id} className="break-all">{p.status} · {inr(p.amount)} · {p.razorpayPaymentId ?? 'pas encore d’id de paiement'}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const CustomerDrawer: React.FC<{ id: string | null; onClose: () => void; onAuthError: (e: unknown) => void }> = ({ id, onClose, onAuthError }) => {
  const [detail, setDetail] = useState<CustomerDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    setDetail(null); setError(''); setLoading(true);
    apiService.fetchCustomer(id)
      .then((d) => { if (!cancelled) setDetail(d); })
      .catch((e) => { if (!cancelled) { onAuthError(e); setError(e instanceof Error ? e.message : 'Impossible de charger ce client.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id, onAuthError]);

  return (
    <Drawer open={Boolean(id)} onClose={onClose} wide title={detail?.name ?? 'Client'} subtitle={detail ? `Inscrit le ${dateOnly(detail.createdAt)}` : 'Chargement…'} icon={Users}
      footer={<button onClick={onClose} className="k-btn-ghost mb-1 w-full">Fermer</button>}>
      {loading && <div className="space-y-3" role="status" aria-label="Chargement du client"><SkeletonCard lines={2} /><SkeletonCard lines={3} /></div>}
      {error && <div role="alert" className="rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 px-4 py-3 text-sm text-kraveo-ink">{error}</div>}
      {detail && (
        <div className="space-y-5">
          <div className="flex items-center gap-4">
            <Avatar name={detail.name} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-display text-xl font-bold text-kraveo-ink">{detail.name}</p>
              <p className="text-xs text-kraveo-ink3">{detail.deleted ? 'Ce client a supprimé son compte' : detail.avatarId ? `Avatar de l’application n°${detail.avatarId}` : 'Aucun avatar choisi'}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="k-inset px-3 py-2.5"><p className="k-label !text-[10px]">Commandes</p><p className="k-num text-xl text-kraveo-ink">{detail.stats.ordersCount}</p></div>
            <div className="k-inset px-3 py-2.5"><p className="k-label !text-[10px]">Payé au total</p><p className="k-num text-xl text-kraveo-ink">{inr(detail.stats.totalSpent)}</p></div>
            <div className="k-inset px-3 py-2.5"><p className="k-label !text-[10px]">Livrées</p><p className="k-num text-xl text-kraveo-ink">{detail.stats.deliveredCount}</p></div>
            <div className="k-inset px-3 py-2.5"><p className="k-label !text-[10px]">Annulées</p><p className="k-num text-xl text-kraveo-ink">{detail.stats.cancelledCount}</p></div>
            <div className="k-inset px-3 py-2.5"><p className="k-label !text-[10px]">En cours</p><p className="k-num text-xl text-kraveo-ink">{detail.stats.activeCount}</p></div>
            <div className="k-inset px-3 py-2.5"><p className="k-label !text-[10px]">Pièces Affia Foods</p><p className="k-num flex items-center gap-1 text-xl text-kraveo-ink"><Coins className="h-4 w-4 text-kraveo-y700" aria-hidden="true" />{detail.kraveoCoins}</p></div>
          </div>

          <div className="space-y-2.5">
            <InfoRow icon={Mail} label="E-mail (Google)">{detail.email ?? '—'}</InfoRow>
            <InfoRow icon={Phone} label="Téléphone">{detail.phone ? <a className="text-kraveo-g700 hover:underline" href={`tel:${detail.phone}`}>{detail.phone}</a> : '—'}</InfoRow>
            <InfoRow icon={detail.isStudent === false ? UserX : GraduationCap} label="Résidence">{detail.isStudent === null ? 'Pas encore répondu' : detail.isStudent ? `Résident · ${detail.hostelBlock ?? 'bâtiment non précisé'}` : 'Pas de résidence — indique un point de livraison à la commande'}</InfoRow>
            <InfoRow icon={ShoppingBag} label="Première et dernière commande">{detail.stats.firstOrderAt ? `${dateTime(detail.stats.firstOrderAt)} → ${dateTime(detail.stats.lastOrderAt)}` : 'Aucune commande pour l’instant'}</InfoRow>
          </div>

          <div>
            <h3 className="k-label mb-2.5">Commandes {detail.stats.ordersCount > detail.orders.length ? `(les ${detail.orders.length} dernières sur ${detail.stats.ordersCount})` : `(${detail.orders.length})`}</h3>
            <div className="space-y-2.5">
              {detail.orders.length === 0 && <p className="k-inset px-4 py-6 text-center text-sm text-kraveo-ink3">Ce client n’a pas encore passé de commande.</p>}
              {detail.orders.map((o) => <OrderBlock key={o.id} o={o} />)}
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
};
