import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Download, Eye, ImageIcon, Landmark, MapPin, Plus, SearchX, Star, Store } from 'lucide-react';
import { Order, Vendor } from '../types';
import { activeOrderCountByVendor } from '../lib/dashboardStats';
import type { SavedPin } from '../lib/vendorLocation';
import { VendorLocationEditor } from './VendorLocationEditor';
import { CommissionEditor } from './CommissionEditor';
import type { VendorCommission } from '../lib/catalogParse';
import { AddPartnerDrawer } from './AddPartnerDrawer';
import { PayoutAccountPanel } from './PayoutAccountPanel';
import { ApprovalPill } from './ui/ApprovalPill';
import { Avatar } from './ui/Avatar';
import { EmptyState } from './ui/EmptyState';
import { Skeleton, SkeletonCard } from './ui/Skeleton';
import { PaginationBar, usePagination } from './ui/Pagination';
import { ColumnsMenu, PageHeader, SearchField, SelectionBar, SortHeader, UnderlineTabs, ViewToggle, downloadCsv, nextSort, useTablePrefs } from './ui/PageToolbar';
import { Drawer } from './ui/Drawer';
import { VendorProfileEditor } from './VendorProfileEditor';
import type { VendorProfile } from '../lib/vendorProfile';
import { Switch } from './ui/Switch';

interface VendorManagerProps {
  vendors: Vendor[];
  /** The loaded orders: "Active orders" per restaurant is counted from them (the vendors API does not send it). */
  orders?: Order[];
  /** Restaurants whose open/close request is still running: their switch is disabled. */
  busyVendorIds?: ReadonlySet<string>;
  onToggleVendor: (vendorId: string) => void;
  /** Called after a restaurant (with its owner login) was created, so the list reloads. */
  onCreated?: () => void;
  /** Called after an admin saved a restaurant's map pin, so the list (and the live map) use it at once. */
  onLocationSaved?: (vendorId: string, saved: SavedPin) => void;
  /** Called after an admin saved a restaurant's commission, so the list uses it at once. */
  onCommissionSaved?: (vendorId: string, commission: VendorCommission) => void;
  /** Session errors from the commission save (logs out on 401/403). */
  onAuthError?: (error: unknown) => void;
  /** Called after an admin saved a restaurant's public profile (logo, photo, description, phone, hours). */
  onProfileSaved?: (vendorId: string, profile: VendorProfile) => void;
  loading?: boolean;
  query?: string;
  /** Edits the search text (the page owns its search box). */
  onQueryChange?: (value: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  onClearQuery?: () => void;
}

type VendorColumn = 'address' | 'rating' | 'menu' | 'active' | 'approval' | 'open';
const VENDOR_COLUMNS: Array<{ key: VendorColumn; label: string }> = [
  { key: 'address', label: 'Adresse' }, { key: 'rating', label: 'Note' }, { key: 'menu', label: 'Plats au menu' },
  { key: 'active', label: 'Commandes en cours' }, { key: 'approval', label: 'Validation' }, { key: 'open', label: 'Ouvert aux commandes' },
];
type VendorSort = 'name' | 'rating' | 'active';

type VendorFilter = 'ALL' | 'OPEN' | 'CLOSED';

/** Payout details (UPI / bank) of an approved restaurant's owner. Closed by default so the list does not call the server per card. */
const VendorPayout: React.FC<{ vendor: Vendor; onAuthError?: (error: unknown) => void }> = ({ vendor, onAuthError }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button type="button" className="k-btn-ghost !min-h-[36px] w-full justify-between text-xs" aria-expanded={open} onClick={() => setOpen((v) => !v)} aria-label={`Coordonnées de versement de ${vendor.name}`}>
        <span className="flex items-center gap-2"><Landmark className="h-3.5 w-3.5" aria-hidden="true" />Coordonnées de versement</span>
        {open ? <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      {open && <div className="mt-2"><PayoutAccountPanel userId={vendor.userId} name={vendor.name} kind="restaurant" onAuthError={onAuthError} /></div>}
    </div>
  );
};

const NO_ORDERS: Order[] = [];
const NOT_BUSY: ReadonlySet<string> = new Set();

export const VendorManager: React.FC<VendorManagerProps> = ({ vendors, orders = NO_ORDERS, busyVendorIds = NOT_BUSY, onToggleVendor, onCreated, onLocationSaved, onCommissionSaved, onAuthError, onProfileSaved, loading = false, query = '', onClearQuery, onQueryChange, onRefresh, refreshing = false }) => {
  const [showDrawer, setShowDrawer] = useState(false);
  const [filter, setFilter] = useState<VendorFilter>('ALL');

  const counts = useMemo(() => ({
    ALL: vendors.length,
    OPEN: vendors.filter((v) => v.isAcceptingOrders).length,
    CLOSED: vendors.filter((v) => !v.isAcceptingOrders).length,
  }), [vendors]);

  const activeByVendor = useMemo(() => activeOrderCountByVendor(orders), [orders]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vendors.filter((v) => {
      const matches = !q || [v.name, v.category, v.address].some((value) => value.toLowerCase().includes(q));
      const status = filter === 'ALL' || (filter === 'OPEN' ? v.isAcceptingOrders : !v.isAcceptingOrders);
      return matches && status;
    });
  }, [vendors, query, filter]);

  const onboardButton = (
    <button onClick={() => setShowDrawer(true)} className="k-btn-accent">
      <Plus className="h-4 w-4" aria-hidden="true" /> Ajouter un restaurant
    </button>
  );
  const prefs = useTablePrefs<VendorColumn>('kraveo_vendors_prefs', 'grid');
  const [sort, setSort] = useState<{ field: VendorSort; dir: 'asc' | 'desc' } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailVendor = vendors.find((v) => v.id === detailId) ?? null;
  const [profileId, setProfileId] = useState<string | null>(null);
  const profileVendor = vendors.find((v) => v.id === profileId) ?? null;
  const sorted = useMemo(() => {
    if (!sort) return visible;
    const value = (v: Vendor): string | number => (sort.field === 'name' ? v.name.toLowerCase() : sort.field === 'rating' ? v.rating : activeByVendor.get(v.id) ?? 0);
    return [...visible].sort((a, b) => {
      const x = value(a); const y = value(b);
      const cmp = typeof x === 'string' ? x.localeCompare(String(y), 'fr') : x - (y as number);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [visible, sort, activeByVendor]);
  const pager = usePagination(sorted, `${filter}|${query}`, 10);
  const pageAllSelected = pager.pageItems.length > 0 && pager.pageItems.every((v) => selected.has(v.id));
  const toggleOne = (id: string) => setSelected((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const togglePage = () => setSelected((cur) => { const next = new Set(cur); pager.pageItems.forEach((v) => (pageAllSelected ? next.delete(v.id) : next.add(v.id))); return next; });
  const exportVendors = (rows: Vendor[]) => downloadCsv('restaurants',
    ['Nom', 'Catégorie', 'Adresse', 'Note', 'Plats au menu', 'Commandes en cours', 'Validation', 'Ouvert'],
    rows.map((v) => [v.name, v.category, v.address, v.rating, v.menuItems?.length ?? '', activeByVendor.get(v.id) ?? 0, v.approvalStatus, v.isAcceptingOrders ? 'Oui' : 'Non']));
  const sortState = (field: VendorSort): false | 'asc' | 'desc' => (sort?.field === field ? sort.dir : false);
  const ratingText = (v: Vendor) => (v.rating > 0 ? v.rating.toFixed(1).replace('.', ',') : 'Nouveau');
  const emptyState = vendors.length === 0
    ? <EmptyState icon={Store} title="Aucun restaurant pour l’instant" description="Ajoutez un restaurant ici, ou validez une inscription dans l’onglet Inscriptions." action={onboardButton} />
    : <EmptyState icon={SearchX} title="Aucun restaurant correspondant" description="Rien ne correspond au filtre et à la recherche actuels." action={<button className="k-btn-ghost" onClick={() => { setFilter('ALL'); onClearQuery?.(); }}>Effacer les filtres</button>} />;
  const manage = (v: Vendor) => (
    <>
      {onProfileSaved && <button type="button" className="k-btn-ghost mt-3 w-full justify-center text-xs" onClick={() => setProfileId(v.id)}><ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />Fiche : logo, photo, description, horaires</button>}
      <VendorLocationEditor id={v.id} name={v.name} pin={v} onSaved={onLocationSaved} />
      {onCommissionSaved && <CommissionEditor id={v.id} name={v.name} commissionType={v.commissionType} commissionValue={v.commissionValue} onSaved={onCommissionSaved} onAuthError={onAuthError} />}
      {v.approvalStatus === 'APPROVED' && <VendorPayout vendor={v} onAuthError={onAuthError} />}
    </>
  );
  const initialLoad = loading && vendors.length === 0;

  return (
    <div className="space-y-5">
      <PageHeader icon={Store} title="Restaurants" subtitle="Le réseau de restaurants partenaires et leur disponibilité" actions={onboardButton} onRefresh={onRefresh} refreshing={refreshing} />
      {onQueryChange && <SearchField value={query} onChange={onQueryChange} label="Rechercher un restaurant" placeholder="Rechercher par nom, catégorie ou adresse…" />}
      <UnderlineTabs label="Filtrer les restaurants" value={filter} onChange={setFilter} tabs={[
        { id: 'ALL', label: 'Tous', count: counts.ALL }, { id: 'OPEN', label: 'Ouverts', count: counts.OPEN }, { id: 'CLOSED', label: 'Fermés', count: counts.CLOSED },
      ]} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="px-1 text-xs text-kraveo-ink3" aria-live="polite">{visible.length} restaurant{visible.length > 1 ? 's' : ''}{visible.length !== vendors.length ? ` sur ${vendors.length}` : ''}</p>
        <div className="flex items-center gap-2">
          <button type="button" className="k-btn-ghost" onClick={() => exportVendors(visible)} disabled={visible.length === 0}><Download className="h-4 w-4" aria-hidden="true" />Exporter en CSV</button>
          <ViewToggle value={prefs.view} onChange={prefs.setView} />
          <ColumnsMenu columns={VENDOR_COLUMNS} hidden={prefs.hidden} onToggle={prefs.toggleColumn} onReset={prefs.resetColumns} />
        </div>
      </div>
      {selected.size > 0 && <SelectionBar count={selected.size} noun="restaurant" onExport={() => exportVendors(vendors.filter((v) => selected.has(v.id)))} onClear={() => setSelected(new Set())} />}

      {prefs.view === 'table' && (
        <div className="k-card overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="k-label">
                <th scope="col" className="w-12 border-b border-kraveo-line px-4 py-3.5"><input type="checkbox" checked={pageAllSelected} onChange={togglePage} aria-label="Sélectionner tous les restaurants de la page" className="h-4 w-4 rounded border-kraveo-line accent-[#2F5BE0]" /></th>
                <th scope="col" className="w-[16rem] border-b border-kraveo-line px-4 py-3.5"><SortHeader label="Restaurant" active={sortState('name')} onClick={() => setSort(nextSort(sort, 'name'))} /></th>
                {prefs.show('address') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Adresse</th>}
                {prefs.show('rating') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5"><SortHeader label="Note" active={sortState('rating')} onClick={() => setSort(nextSort(sort, 'rating'))} /></th>}
                {prefs.show('menu') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Plats</th>}
                {prefs.show('active') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5"><SortHeader label="En cours" active={sortState('active')} onClick={() => setSort(nextSort(sort, 'active'))} /></th>}
                {prefs.show('approval') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Validation</th>}
                {prefs.show('open') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Ouvert</th>}
                <th scope="col" className="border-b border-kraveo-line px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {initialLoad && Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={9} className="border-b border-kraveo-line/60 px-4 py-3"><Skeleton className="h-10 w-full" /></td></tr>)}
              {!initialLoad && pager.pageItems.length === 0 && <tr><td colSpan={9}>{emptyState}</td></tr>}
              {pager.pageItems.map((v) => {
                const cell = 'border-b border-kraveo-line/60 px-4 py-3 align-middle';
                return (
                  <tr key={v.id} tabIndex={0} aria-label={`Ouvrir le détail de ${v.name}`} onClick={() => setDetailId(v.id)} onKeyDown={(e) => { if (e.key === 'Enter') setDetailId(v.id); }}
                    className="cursor-pointer outline-none transition-colors hover:bg-kraveo-surface2/60 focus-visible:bg-kraveo-surface2/60">
                    <td className={`${cell} w-12`} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(v.id)} onChange={() => toggleOne(v.id)} aria-label={`Sélectionner ${v.name}`} className="h-4 w-4 rounded border-kraveo-line accent-[#2F5BE0]" /></td>
                    <td className={`${cell} w-[16rem] max-w-[16rem]`}>
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-k-md bg-kraveo-yellow/20 text-kraveo-y700"><Store className="h-5 w-5" aria-hidden="true" /></span>
                        <div className="min-w-0"><p className="truncate font-bold text-kraveo-ink" title={v.name}>{v.name}</p><p className="truncate text-xs font-semibold text-kraveo-g700">{v.category}</p></div>
                      </div>
                    </td>
                    {prefs.show('address') && <td className={`${cell} max-w-[14rem]`}><p className="flex items-center gap-1.5 text-kraveo-ink2"><MapPin className="h-3.5 w-3.5 shrink-0 text-kraveo-ink3" aria-hidden="true" /><span className="truncate" title={v.address}>{v.address}</span></p></td>}
                    {prefs.show('rating') && <td className={`${cell} whitespace-nowrap`}><span className="inline-flex items-center gap-1 rounded-full bg-kraveo-surface2 px-2.5 py-1 text-xs font-bold text-kraveo-ink"><Star className={`h-3.5 w-3.5 ${v.rating > 0 ? 'fill-kraveo-yellow text-kraveo-y700' : 'text-kraveo-ink3'}`} aria-hidden="true" />{ratingText(v)}</span></td>}
                    {prefs.show('menu') && <td className={`k-num ${cell} text-base text-kraveo-ink`}>{v.menuItems ? v.menuItems.length : '-'}</td>}
                    {prefs.show('active') && <td className={`k-num ${cell} text-base text-kraveo-ink`}>{activeByVendor.get(v.id) ?? 0}</td>}
                    {prefs.show('approval') && <td className={cell}><ApprovalPill status={v.approvalStatus} /></td>}
                    {prefs.show('open') && (
                      <td className={cell} onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center gap-2">
                          <Switch checked={v.isAcceptingOrders} onChange={() => onToggleVendor(v.id)} disabled={busyVendorIds.has(v.id)} label={`${v.name} : accepte les commandes`} />
                          <span className={`text-xs font-bold ${v.isAcceptingOrders ? 'text-kraveo-g700' : 'text-kraveo-danger'}`}>{v.isAcceptingOrders ? 'Ouvert' : 'Fermé'}</span>
                        </div>
                      </td>
                    )}
                    <td className={`${cell} text-right`} onClick={(e) => e.stopPropagation()}>
                      <button type="button" title="Voir le détail" aria-label={`Voir le détail de ${v.name}`} onClick={() => setDetailId(v.id)} className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-kraveo-line bg-kraveo-surface text-kraveo-ink2 transition-colors hover:bg-kraveo-surface2"><Eye className="h-4 w-4" aria-hidden="true" /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {prefs.view === 'grid' && (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 2xl:grid-cols-3">
        {initialLoad && Array.from({ length: 6 }).map((_, index) => <SkeletonCard key={index} lines={3} />)}
        {!initialLoad && vendors.length === 0 && (
          <div className="k-card sm:col-span-2 2xl:col-span-3">
            <EmptyState icon={Store} title="Aucun restaurant pour l’instant" description="Ajoutez un restaurant ici, ou validez une candidature dans l’onglet Candidatures." action={onboardButton} />
          </div>
        )}
        {!initialLoad && vendors.length > 0 && visible.length === 0 && (
          <div className="k-card sm:col-span-2 2xl:col-span-3">
            <EmptyState icon={SearchX} title="Aucun restaurant correspondant" description="Rien ne correspond au filtre et à la recherche actuels." action={<button className="k-btn-ghost" onClick={() => { setFilter('ALL'); onClearQuery?.(); }}>Effacer les filtres</button>} />
          </div>
        )}
        {pager.pageItems.map((v, index) => (
          <article key={v.id} className="k-card k-card-hover k-reveal flex flex-col p-5" style={{ ['--i' as string]: Math.min(index, 10) }}>
            <div className="flex items-start gap-3.5">
              <Avatar name={v.name} size="lg" className="!rounded-k-md" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-display text-lg font-bold leading-tight text-kraveo-ink" title={v.name}>{v.name}</h3>
                <p className="truncate text-xs font-semibold text-kraveo-g700">{v.category}</p>
                <ApprovalPill status={v.approvalStatus} className="mt-1.5" />
                <p className="mt-1.5 flex items-center gap-1 text-xs text-kraveo-ink3"><MapPin className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{v.address}</span></p>
              </div>
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-kraveo-surface2 px-2.5 py-1 text-xs font-bold text-kraveo-ink" title={v.totalRatingsCount ? `${v.totalRatingsCount} avis` : 'Pas encore d’avis'}>
                <Star className={`h-3.5 w-3.5 ${v.rating > 0 ? 'fill-kraveo-yellow text-kraveo-y700' : 'text-kraveo-ink3'}`} aria-hidden="true" />
                {v.rating > 0 ? v.rating.toFixed(1).replace('.', ',') : 'Nouveau'}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="k-inset px-3 py-2.5">
                <p className="k-label">Plats au menu</p>
                <p className="k-num text-xl text-kraveo-ink">{v.menuItems ? v.menuItems.length : '-'}</p>
              </div>
              <div className="k-inset px-3 py-2.5">
                <p className="k-label">Commandes en cours</p>
                <p className="k-num text-xl text-kraveo-ink">{activeByVendor.get(v.id) ?? 0}</p>
              </div>
            </div>

            {manage(v)}

            <div className="mt-4 flex items-center justify-between gap-3 border-t border-kraveo-line pt-4">
              <div className="flex items-center gap-2">
                <span className={`k-dot ${v.isAcceptingOrders ? 'bg-kraveo-g400 k-dot-live' : 'bg-kraveo-danger'}`} aria-hidden="true" />
                <div>
                  <p className={`text-sm font-bold ${v.isAcceptingOrders ? 'text-kraveo-g700' : 'text-kraveo-danger'}`}>{v.isAcceptingOrders ? 'Ouvert aux commandes' : 'Fermé'}</p>
                  <p className="text-[11px] text-kraveo-ink3">Accepte les commandes</p>
                </div>
              </div>
              <Switch checked={v.isAcceptingOrders} onChange={() => onToggleVendor(v.id)} disabled={busyVendorIds.has(v.id)} label={`${v.name} : accepte les commandes`} />
            </div>
          </article>
        ))}
      </div>
      )}

      <PaginationBar page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} total={pager.total} onPage={pager.setPage} onPageSize={pager.setPageSize} noun="restaurants" />

      <Drawer
        open={Boolean(detailVendor)}
        onClose={() => setDetailId(null)}
        title={detailVendor?.name ?? 'Restaurant'}
        subtitle={detailVendor ? `${detailVendor.category} · ${detailVendor.address}` : ''}
        icon={Store}
        footer={<button onClick={() => setDetailId(null)} className="k-btn-ghost mb-1 w-full">Fermer</button>}
      >
        {detailVendor && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2"><ApprovalPill status={detailVendor.approvalStatus} showApproved /><span className="inline-flex items-center gap-1 rounded-full bg-kraveo-surface2 px-2.5 py-1 text-xs font-bold text-kraveo-ink"><Star className={`h-3.5 w-3.5 ${detailVendor.rating > 0 ? 'fill-kraveo-yellow text-kraveo-y700' : 'text-kraveo-ink3'}`} aria-hidden="true" />{ratingText(detailVendor)}</span></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="k-inset px-3 py-2.5"><p className="k-label">Plats au menu</p><p className="k-num text-xl text-kraveo-ink">{detailVendor.menuItems ? detailVendor.menuItems.length : '-'}</p></div>
              <div className="k-inset px-3 py-2.5"><p className="k-label">Commandes en cours</p><p className="k-num text-xl text-kraveo-ink">{activeByVendor.get(detailVendor.id) ?? 0}</p></div>
            </div>
            {manage(detailVendor)}
            <div className="flex items-center justify-between gap-3 border-t border-kraveo-line pt-4">
              <p className={`text-sm font-bold ${detailVendor.isAcceptingOrders ? 'text-kraveo-g700' : 'text-kraveo-danger'}`}>{detailVendor.isAcceptingOrders ? 'Ouvert aux commandes' : 'Fermé'}</p>
              <Switch checked={detailVendor.isAcceptingOrders} onChange={() => onToggleVendor(detailVendor.id)} disabled={busyVendorIds.has(detailVendor.id)} label={`${detailVendor.name} : accepte les commandes`} />
            </div>
          </div>
        )}
      </Drawer>

      <Drawer
        open={Boolean(profileVendor)}
        onClose={() => setProfileId(null)}
        title={profileVendor ? `Fiche de ${profileVendor.name}` : 'Fiche du restaurant'}
        subtitle="Photos, adresse, contact, préparation et horaires"
        icon={Store}
        wide
        footer={<button onClick={() => setProfileId(null)} className="k-btn-ghost mb-1 w-full">Fermer</button>}
      >
        {profileVendor && onProfileSaved && <VendorProfileEditor key={profileVendor.id} vendor={profileVendor} layout="drawer" onSaved={onProfileSaved} onLocationSaved={onLocationSaved} onAuthError={onAuthError} />}
      </Drawer>

      <AddPartnerDrawer open={showDrawer} kind="VENDOR" onClose={() => setShowDrawer(false)} onCreated={() => onCreated?.()} />
    </div>
  );
};
