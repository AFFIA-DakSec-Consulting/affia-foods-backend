import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Eye, ImageOff, Plus, SearchX, UtensilsCrossed } from 'lucide-react';
import { Vendor } from '../types';
import { apiService } from '../services/api';
import { CatalogDish, CatalogPage, PendingCounts } from '../lib/catalogParse';
import { commissionLabel, rupees } from '../lib/pricing';
import { CatalogDishDrawer } from './CatalogDishDrawer';
import { StateBadge } from './CatalogStateBadge';
import { EmptyState } from './ui/EmptyState';
import { SkeletonCard } from './ui/Skeleton';
import { PaginationBar } from './ui/Pagination';
import { ColumnsMenu, PageHeader, SearchField, SelectionBar, SortHeader, UnderlineTabs, ViewToggle, downloadCsv, nextSort, useTablePrefs } from './ui/PageToolbar';
import { Switch } from './ui/Switch';
import { useToast } from './ui/Toast';

interface Props {
  /** Restaurants for the filter and for "Add dish". */
  vendors: Vendor[];
  /** The header search box (sent to the server, debounced). */
  query: string;
  onClearQuery: () => void;
  onQueryChange?: (value: string) => void;
  onAuthError: (error: unknown) => void;
  /** Dishes waiting, from the sidebar badge poll: new dishes and price-change requests. */
  pendingCounts: PendingCounts;
  /** Something changed on the server that can move the pending count: refresh the badge. */
  onPendingChanged: () => void;
}

/** `status` is what is sent to GET /api/admin/catalog?status=. Omitted = every dish that is not deleted (the server default). */
const FILTERS = [
  { id: 'ALL', label: 'Tous les plats', status: '' },
  { id: 'PENDING', label: 'À valider', status: 'PENDING' },
  { id: 'CHANGE_PENDING', label: 'Changements de prix', status: 'CHANGE_PENDING' },
  { id: 'LIVE', label: 'En ligne', status: 'LIVE' },
  { id: 'REJECTED', label: 'Refusés', status: 'REJECTED' },
  { id: 'DELETED', label: 'Supprimés', status: 'DELETED' },
] as const;
type FilterId = (typeof FILTERS)[number]['id'];

const SEARCH_DEBOUNCE_MS = 350;

type DishColumn = 'vendor' | 'vendorPrice' | 'commission' | 'price' | 'state' | 'available';
const DISH_COLUMNS: Array<{ key: DishColumn; label: string }> = [
  { key: 'vendor', label: 'Restaurant' }, { key: 'vendorPrice', label: 'Prix restaurant' }, { key: 'commission', label: 'Commission' },
  { key: 'price', label: 'Prix client' }, { key: 'state', label: 'Statut' }, { key: 'available', label: 'Disponible' },
];
type DishSort = 'name' | 'price';

const VegMark: React.FC<{ isVeg: boolean }> = ({ isVeg }) => (
  <span className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border-2 ${isVeg ? 'border-kraveo-g400' : 'border-kraveo-danger'}`} title={isVeg ? 'Végétarien' : 'Non végétarien'}>
    <span className={`h-1.5 w-1.5 rounded-full ${isVeg ? 'bg-kraveo-g400' : 'bg-kraveo-danger'}`} />
    <span className="sr-only">{isVeg ? 'Végétarien' : 'Non végétarien'}</span>
  </span>
);

const Thumb: React.FC<{ url: string | null; name: string; size?: string }> = ({ url, name, size = 'h-11 w-11' }) => {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`flex ${size} shrink-0 items-center justify-center overflow-hidden rounded-k-sm border border-kraveo-line bg-kraveo-surface2 text-kraveo-ink3`}>
      {url && !failed
        ? <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : url ? <ImageOff className="h-4 w-4" aria-label={`Pas de photo pour ${name}`} /> : <UtensilsCrossed className="h-4 w-4" aria-hidden="true" />}
    </span>
  );
};

const SOURCE_LABEL = { DISH: 'ce plat', VENDOR: 'restaurant', GLOBAL: 'par défaut' } as const;

const commissionText = (dish: CatalogDish): string => {
  const rule = dish.commission ? `${commissionLabel(dish.commission.type, dish.commission.value)} · ${SOURCE_LABEL[dish.commission.source]}` : 'Par défaut';
  return dish.effectiveCommission !== null ? `${rupees(dish.effectiveCommission)} (${rule})` : rule;
};

/** The customer price, with a note when today's rules would give a different one (until "Recalculer les prix" runs). */
const CustomerPrice: React.FC<{ dish: CatalogDish }> = ({ dish }) => (
  <>
    {rupees(dish.price)}
    {dish.priceIsStale && dish.computedPrice !== null && <span className="block text-[11px] font-semibold text-kraveo-status-placed" title="Lancez « Recalculer les prix » dans Réglages pour l’appliquer">bientôt {rupees(dish.computedPrice)}</span>}
  </>
);

interface RowProps {
  dish: CatalogDish;
  show?: (column: DishColumn) => boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  busy: boolean;
  onOpen: (dish: CatalogDish) => void;
  onToggle: (dish: CatalogDish) => void;
}

const PriceCell: React.FC<{ dish: CatalogDish }> = ({ dish }) => (
  <>
    {rupees(dish.vendorPrice)}
    {dish.pendingVendorPrice !== null && <span className="block text-[11px] font-semibold text-kraveo-status-preparing">demande {rupees(dish.pendingVendorPrice)}</span>}
  </>
);

const ALL_SHOWN = () => true;
const DishRow = memo<RowProps>(({ dish, busy, onOpen, onToggle, show = ALL_SHOWN, selected = false, onSelect }) => (
  <tr tabIndex={0} onClick={() => onOpen(dish)} onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) onOpen(dish); }}
    className="cursor-pointer outline-none transition-colors hover:bg-kraveo-surface2/60 focus-visible:bg-kraveo-surface2/60" aria-label={`Ouvrir ${dish.name}`}>
    <td className="w-12 border-b border-kraveo-line/60 px-4 py-3" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected} onChange={() => onSelect?.(dish.id)} aria-label={`Sélectionner ${dish.name}`} className="h-4 w-4 rounded border-kraveo-line accent-[#2F5BE0]" /></td>
    <td className="w-[18rem] max-w-[18rem] border-b border-kraveo-line/60 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Thumb url={dish.imageUrl} name={dish.name} />
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-bold text-kraveo-ink"><VegMark isVeg={dish.isVeg} /><span className="min-w-0 truncate" title={dish.name}>{dish.name}</span></p>
          <p className="truncate text-xs text-kraveo-ink3">{dish.category || 'Sans catégorie'}</p>
        </div>
      </div>
    </td>
    {show('vendor') && <td className="max-w-[12rem] truncate border-b border-kraveo-line/60 px-4 py-3 text-kraveo-ink2" title={dish.vendorName}>{dish.vendorName}</td>}
    {show('vendorPrice') && <td className="k-num border-b border-kraveo-line/60 px-4 py-3 text-kraveo-ink"><PriceCell dish={dish} /></td>}
    {show('commission') && <td className="border-b border-kraveo-line/60 px-4 py-3 text-xs text-kraveo-ink2">{commissionText(dish)}</td>}
    {show('price') && <td className="k-num border-b border-kraveo-line/60 px-4 py-3 text-kraveo-ink"><CustomerPrice dish={dish} /></td>}
    {show('state') && <td className="border-b border-kraveo-line/60 px-4 py-3"><StateBadge state={dish.state} /></td>}
    {show('available') && (
      <td className="border-b border-kraveo-line/60 px-4 py-3" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        <Switch checked={dish.isAvailable} onChange={() => onToggle(dish)} disabled={busy || dish.state === 'DELETED'} label={`${dish.name} : disponible à la commande`} />
      </td>
    )}
    <td className="border-b border-kraveo-line/60 px-4 py-3 text-right" onClick={(event) => event.stopPropagation()}>
      <button type="button" title="Voir le détail" aria-label={`Voir le détail de ${dish.name}`} onClick={() => onOpen(dish)} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-kraveo-line bg-kraveo-surface text-kraveo-ink2 transition-colors hover:bg-kraveo-surface2"><Eye className="h-4 w-4" aria-hidden="true" /></button>
    </td>
  </tr>
));
DishRow.displayName = 'DishRow';

const DishCard = memo<RowProps & { index: number }>(({ dish, busy, onOpen, onToggle, index }) => (
  <div className="k-card k-reveal p-4" style={{ ['--i' as string]: Math.min(index, 10) }}>
    <button type="button" className="flex w-full items-start gap-3 text-left" onClick={() => onOpen(dish)} aria-label={`Ouvrir ${dish.name}`}>
      <Thumb url={dish.imageUrl} name={dish.name} size="h-14 w-14" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 break-words font-bold text-kraveo-ink"><VegMark isVeg={dish.isVeg} /><span className="min-w-0 break-words">{dish.name}</span></span>
        <span className="block break-words text-xs text-kraveo-ink3">{dish.vendorName}{dish.category ? ` · ${dish.category}` : ''}</span>
        <span className="mt-1.5 block"><StateBadge state={dish.state} /></span>
      </span>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-kraveo-ink3" aria-hidden="true" />
    </button>
    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
      <div className="k-inset px-2 py-2"><p className="k-label !text-[10px]">Restaurant</p><p className="k-num text-base text-kraveo-ink"><PriceCell dish={dish} /></p></div>
      <div className="k-inset px-2 py-2"><p className="k-label !text-[10px]">Commission</p><p className="break-words text-xs font-bold text-kraveo-ink">{commissionText(dish)}</p></div>
      <div className="k-inset px-2 py-2"><p className="k-label !text-[10px]">Client</p><p className="k-num text-base text-kraveo-ink"><CustomerPrice dish={dish} /></p></div>
    </div>
    <div className="mt-3 flex items-center justify-between gap-3">
      <span className="text-xs text-kraveo-ink3">{dish.isAvailable ? 'Disponible' : 'Épuisé'}</span>
      <Switch checked={dish.isAvailable} onChange={() => onToggle(dish)} disabled={busy || dish.state === 'DELETED'} label={`${dish.name} : disponible à la commande`} />
    </div>
  </div>
));
DishCard.displayName = 'DishCard';

const CatalogPanelBase: React.FC<Props> = ({ vendors, query, onClearQuery, onQueryChange, onAuthError, pendingCounts, onPendingChanged }) => {
  const toast = useToast();
  const [filter, setFilter] = useState<FilterId>('ALL');
  const [vendorId, setVendorId] = useState('');
  const [pageState, setPageState] = useState<{ key: string; page: number }>({ key: '', page: 1 });
  const [data, setData] = useState<CatalogPage | null>(null);
  const [items, setItems] = useState<CatalogDish[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);
  const [togglingIds, setTogglingIds] = useState<ReadonlySet<string>>(() => new Set());
  const togglingRef = useRef<Set<string>>(new Set());
  const [drawer, setDrawer] = useState<{ kind: 'edit'; dish: CatalogDish } | { kind: 'create' } | null>(null);
  const seq = useRef(0);
  // Totals the server reported for each tab on this restaurant/search; a tab shows its number once it has been opened.
  const [totals, setTotals] = useState<{ scope: string; byFilter: Partial<Record<FilterId, number>> }>({ scope: '', byFilter: {} });

  const status = FILTERS.find((entry) => entry.id === filter)?.status ?? '';
  const filterKey = `${filter}|${vendorId}|${query.trim()}`;
  const page = pageState.key === filterKey ? pageState.page : 1;

  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const result = await apiService.fetchCatalog({ status, vendorId, q: query, page });
        if (mine !== seq.current) return;
        setData(result);
        setItems(result.items);
        if (result.total !== null) setTotals((current) => ({ scope: `${vendorId}|${query.trim()}`, byFilter: { ...(current.scope === `${vendorId}|${query.trim()}` ? current.byFilter : {}), [filter]: result.total as number } }));
        setError('');
      } catch (failure) {
        if (mine !== seq.current) return;
        onAuthError(failure);
        setError(failure instanceof Error ? failure.message : 'Les plats n’ont pas pu être chargés.');
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    }, query.trim() ? SEARCH_DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [status, vendorId, query, page, reloadKey, onAuthError]); // eslint-disable-line react-hooks/exhaustive-deps

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);
  const handleChanged = useCallback(() => { reload(); onPendingChanged(); }, [reload, onPendingChanged]);
  const closeDrawer = useCallback(() => setDrawer(null), []);
  const openDish = useCallback((dish: CatalogDish) => setDrawer({ kind: 'edit', dish }), []);

  /** The availability switch: flips at once and goes back if the server says no. */
  const toggleAvailability = useCallback(async (dish: CatalogDish) => {
    if (togglingRef.current.has(dish.id)) return;
    togglingRef.current.add(dish.id);
    setTogglingIds(new Set(togglingRef.current));
    const next = !dish.isAvailable;
    const apply = (value: boolean) => setItems((current) => current.map((row) => (row.id === dish.id ? { ...row, isAvailable: value } : row)));
    apply(next);
    try {
      await apiService.updateCatalogItem(dish.id, { isAvailable: next });
    } catch (failure) {
      apply(dish.isAvailable);
      onAuthError(failure);
      toast.error('Disponibilité non modifiée', failure instanceof Error ? failure.message : 'Veuillez réessayer.');
    } finally {
      togglingRef.current.delete(dish.id);
      setTogglingIds(new Set(togglingRef.current));
    }
  }, [onAuthError, toast]);

  const sortedVendors = useMemo(() => [...vendors].sort((a, b) => a.name.localeCompare(b.name)), [vendors]);
  const categories = useMemo(() => Array.from(new Set(items.map((dish) => dish.category).filter(Boolean))).sort(), [items]);

  const prefs = useTablePrefs<DishColumn>('kraveo_catalog_prefs');
  const [sort, setSort] = useState<{ field: DishSort; dir: 'asc' | 'desc' } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const shownItems = useMemo(() => {
    if (!sort) return items;
    const value = (d: CatalogDish): string | number => (sort.field === 'name' ? d.name.toLowerCase() : d.price ?? 0);
    return [...items].sort((a, b) => {
      const x = value(a); const y = value(b);
      const cmp = typeof x === 'string' ? x.localeCompare(String(y), 'fr') : x - (y as number);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [items, sort]);
  const pageAllSelected = shownItems.length > 0 && shownItems.every((d) => selected.has(d.id));
  const toggleOne = useCallback((id: string) => setSelected((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; }), []);
  const togglePage = () => setSelected((cur) => { const next = new Set(cur); shownItems.forEach((d) => (pageAllSelected ? next.delete(d.id) : next.add(d.id))); return next; });
  const exportDishes = (rows: CatalogDish[]) => downloadCsv('plats',
    ['Plat', 'Catégorie', 'Restaurant', 'Prix restaurant', 'Prix client', 'Commission', 'Statut', 'Disponible'],
    rows.map((d) => [d.name, d.category, d.vendorName, d.vendorPrice, d.price, commissionText(d), d.state, d.isAvailable ? 'Oui' : 'Non']));
  const sortState = (field: DishSort): false | 'asc' | 'desc' => (sort?.field === field ? sort.dir : false);
  const initialLoad = loading && items.length === 0 && !error;
  const empty = !loading && !error && items.length === 0;
  const totalPages = data?.totalPages ?? null;
  const showPager = data !== null && (page > 1 || data.hasMore);
  /** Number on a tab: the sidebar badge for the two queues, the server total once a tab has been opened, 0 until then. */
  const counts = (id: FilterId): number => {
    const known = totals.scope === `${vendorId}|${query.trim()}` ? totals.byFilter[id] : undefined;
    const pending = id === 'PENDING' ? pendingCounts.pending : id === 'CHANGE_PENDING' ? pendingCounts.changePending : undefined;
    return pending ?? (id === filter && data?.total != null ? data.total : known ?? 0);
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={UtensilsCrossed} title="Menus & plats" subtitle="Validez les plats des restaurants et fixez le prix payé par les clients" onRefresh={reload} refreshing={loading}
        actions={<button type="button" className="k-btn-accent" onClick={() => setDrawer({ kind: 'create' })} disabled={vendors.length === 0} title={vendors.length === 0 ? 'Aucun restaurant chargé pour l’instant' : undefined}><Plus className="h-4 w-4" aria-hidden="true" />Ajouter un plat</button>} />
      {onQueryChange && <SearchField value={query} onChange={onQueryChange} label="Rechercher un plat" placeholder="Rechercher par nom de plat, catégorie ou restaurant…" />}
      <UnderlineTabs label="Filtrer les plats" value={filter} onChange={setFilter} tabs={FILTERS.map((entry) => ({ id: entry.id, label: entry.label, count: counts(entry.id), alert: entry.id === 'PENDING' || entry.id === 'CHANGE_PENDING' }))} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <label className="sr-only" htmlFor="catalog-vendor-filter">Restaurant</label>
          <select id="catalog-vendor-filter" className="k-select !min-h-[40px] w-full sm:w-64" value={vendorId} onChange={(event) => setVendorId(event.target.value)}>
            <option value="">Tous les restaurants</option>
            {sortedVendors.map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="k-btn-ghost" onClick={() => exportDishes(items)} disabled={items.length === 0}><Download className="h-4 w-4" aria-hidden="true" />Exporter en CSV</button>
          <ViewToggle value={prefs.view} onChange={prefs.setView} />
          <ColumnsMenu columns={DISH_COLUMNS} hidden={prefs.hidden} onToggle={prefs.toggleColumn} onReset={prefs.resetColumns} />
        </div>
      </div>
      {selected.size > 0 && <SelectionBar count={selected.size} noun="plat" onExport={() => exportDishes(items.filter((d) => selected.has(d.id)))} onClear={() => setSelected(new Set())} />}

      {error && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 px-4 py-3 text-sm text-kraveo-ink">
          <span className="min-w-0 break-words">{error}</span>
          <button type="button" className="k-btn-ghost !min-h-[36px] shrink-0 !px-3 text-xs" onClick={reload}>Réessayer</button>
        </div>
      )}

      {data && data.total !== null && !error && <p className="text-xs text-kraveo-ink3" aria-live="polite">{data.total} {data.total === 1 ? 'plat' : 'plats'}{query.trim() ? ` pour « ${query.trim()} »` : ''}</p>}

      {empty && (
        <div className="k-card">
          <EmptyState
            icon={query.trim() ? SearchX : UtensilsCrossed}
            title={query.trim() ? 'Aucun plat correspondant' : filter === 'PENDING' ? 'Rien en attente de validation' : 'Aucun plat ici'}
            description={query.trim() ? 'Essayez un nom de plat, une catégorie ou un restaurant.' : filter === 'PENDING' ? 'Les nouveaux plats des restaurants apparaissent ici pour validation.' : 'Rien ne correspond à ce filtre.'}
            action={query.trim() ? <button type="button" className="k-btn-ghost" onClick={onClearQuery}>Effacer la recherche</button> : filter !== 'ALL' ? <button type="button" className="k-btn-ghost" onClick={() => setFilter('ALL')}>Afficher tous les plats</button> : undefined}
          />
        </div>
      )}

      {items.length > 0 && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'} aria-busy={loading}>
          <div className={`k-card hidden overflow-x-auto ${prefs.view === 'table' ? 'xl:block' : ''}`}>
            <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
              <caption className="sr-only">Plats</caption>
              <thead>
                <tr className="k-label">
                  <th scope="col" className="w-12 border-b border-kraveo-line px-4 py-3.5"><input type="checkbox" checked={pageAllSelected} onChange={togglePage} aria-label="Sélectionner tous les plats de la page" className="h-4 w-4 rounded border-kraveo-line accent-[#2F5BE0]" /></th>
                  <th scope="col" className="w-[18rem] border-b border-kraveo-line px-4 py-3.5"><SortHeader label="Plat" active={sortState('name')} onClick={() => setSort(nextSort(sort, 'name'))} /></th>
                  {prefs.show('vendor') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Restaurant</th>}
                  {prefs.show('vendorPrice') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Prix restaurant</th>}
                  {prefs.show('commission') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Commission</th>}
                  {prefs.show('price') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5"><SortHeader label="Prix client" active={sortState('price')} onClick={() => setSort(nextSort(sort, 'price'))} /></th>}
                  {prefs.show('state') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Statut</th>}
                  {prefs.show('available') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Disponible</th>}
                  <th scope="col" className="border-b border-kraveo-line px-4 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shownItems.map((dish) => <DishRow key={dish.id} dish={dish} busy={togglingIds.has(dish.id)} onOpen={openDish} onToggle={toggleAvailability} show={prefs.show} selected={selected.has(dish.id)} onSelect={toggleOne} />)}
              </tbody>
            </table>
          </div>
          <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${prefs.view === 'table' ? 'xl:hidden' : 'xl:grid-cols-3'}`}>
            {shownItems.map((dish, index) => <DishCard key={dish.id} dish={dish} index={index} busy={togglingIds.has(dish.id)} onOpen={openDish} onToggle={toggleAvailability} />)}
          </div>
        </div>
      )}
      {initialLoad && <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, index) => <SkeletonCard key={index} lines={2} />)}</div>}

      {data !== null && data.total !== null && data.pageSize ? (
        <PaginationBar page={page} pageCount={Math.max(1, totalPages ?? Math.ceil(data.total / data.pageSize))} pageSize={data.pageSize} total={data.total} onPage={(next) => setPageState({ key: filterKey, page: next })} noun="plats" />
      ) : showPager && (
        <nav className="flex items-center justify-center gap-3" aria-label="Pages">
          <button type="button" className="k-btn-ghost" onClick={() => setPageState({ key: filterKey, page: page - 1 })} disabled={page <= 1 || loading}><ChevronLeft className="h-4 w-4" aria-hidden="true" />Précédent</button>
          <span className="text-sm text-kraveo-ink2" aria-live="polite">Page {page}{totalPages ? ` sur ${totalPages}` : ''}</span>
          <button type="button" className="k-btn-ghost" onClick={() => setPageState({ key: filterKey, page: page + 1 })} disabled={!data?.hasMore || loading}>Suivant<ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
        </nav>
      )}

      {drawer && (
        <CatalogDishDrawer
          key={drawer.kind === 'edit' ? drawer.dish.id : 'new'}
          open
          item={drawer.kind === 'edit' ? drawer.dish : null}
          vendors={sortedVendors}
          categories={categories}
          onClose={closeDrawer}
          onChanged={handleChanged}
          onAuthError={onAuthError}
        />
      )}
    </div>
  );
};

/** Memoised: a live order event re-renders the app but not this table (its props only change when its own data does). */
export const CatalogPanel = memo(CatalogPanelBase);
