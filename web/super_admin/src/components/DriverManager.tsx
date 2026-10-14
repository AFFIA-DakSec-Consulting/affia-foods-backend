import React, { useMemo, useState } from 'react';
import { Bike, ChevronRight, Download, Moon, Phone, Plus, SearchX, Truck, Users, Zap } from 'lucide-react';
import { vehicleLabel } from '../lib/tokens';
import { DriverPartner, Order } from '../types';
import { tripsTodayByRider } from '../lib/dashboardStats';
import { AddPartnerDrawer } from './AddPartnerDrawer';
import { AnimatedNumber } from './ui/AnimatedNumber';
import { ApprovalPill } from './ui/ApprovalPill';
import { Avatar } from './ui/Avatar';
import { Drawer } from './ui/Drawer';
import { EmptyState } from './ui/EmptyState';
import { KpiTile } from './ui/KpiTile';
import { Skeleton, SkeletonCard } from './ui/Skeleton';
import { PaginationBar, usePagination } from './ui/Pagination';
import { ColumnsMenu, PageHeader, SearchField, SelectionBar, SortHeader, UnderlineTabs, ViewToggle, downloadCsv, nextSort, useTablePrefs } from './ui/PageToolbar';

interface DriverManagerProps {
  drivers: DriverPartner[];
  /** The loaded orders: "Trips today" is counted from them (deliveries finished today, India time). */
  orders?: Order[];
  /** Current time from the app, so the count rolls over at midnight. */
  now?: number;
  onToggleStatus?: (driverId: string) => void;
  /** Called after a rider was created, so the list reloads. */
  onCreated?: () => void;
  loading?: boolean;
  query?: string;
  onQueryChange?: (value: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  onClearQuery?: () => void;
}

type DriverColumn = 'phone' | 'vehicle' | 'status' | 'approval' | 'trips' | 'joined';
const DRIVER_COLUMNS: Array<{ key: DriverColumn; label: string }> = [
  { key: 'phone', label: 'Téléphone' }, { key: 'vehicle', label: 'Véhicule' }, { key: 'status', label: 'Service' },
  { key: 'approval', label: 'Validation' }, { key: 'trips', label: 'Courses du jour' }, { key: 'joined', label: 'Inscription' },
];
type DriverSort = 'name' | 'trips' | 'joined';

type DutyFilter = 'ALL' | DriverPartner['dutyStatus'];

const DUTY: Record<DriverPartner['dutyStatus'], { label: string; dot: string; text: string; bg: string; live: boolean }> = {
  ONLINE: { label: 'En ligne', dot: 'bg-kraveo-g400', text: 'text-kraveo-g700', bg: 'bg-kraveo-g500/10', live: true },
  IN_TRANSIT: { label: 'En livraison', dot: 'bg-kraveo-status-pickedUp', text: 'text-kraveo-status-pickedUp', bg: 'bg-kraveo-status-pickedUp/15', live: true },
  OFFLINE: { label: 'Hors ligne', dot: 'bg-kraveo-ink3', text: 'text-kraveo-ink2', bg: 'bg-kraveo-surface2', live: false },
};

const DutyPill: React.FC<{ status: DriverPartner['dutyStatus'] }> = ({ status }) => {
  const d = DUTY[status] ?? DUTY.OFFLINE;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${d.bg} ${d.text}`}>
      <span className={`k-dot ${d.dot} ${d.live ? 'k-dot-live' : ''}`} aria-hidden="true" />{d.label}
    </span>
  );
};

const dash = (value?: string): string => (value && value.trim() ? value : '-');

const DetailRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="k-inset px-4 py-3">
    <p className="k-label">{label}</p>
    <div className="mt-0.5 break-words text-sm font-bold text-kraveo-ink">{children}</div>
  </div>
);

const NO_ORDERS: Order[] = [];

export const DriverManager: React.FC<DriverManagerProps> = ({ drivers, orders = NO_ORDERS, now = Date.now(), onCreated, loading = false, query = '', onClearQuery, onQueryChange, onRefresh, refreshing = false }) => {
  const [filter, setFilter] = useState<DutyFilter>('ALL');
  const [showAdd, setShowAdd] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedDriver = drivers.find((d) => d.id === selectedId) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return drivers.filter((d) => {
      const matchesFilter = filter === 'ALL' || d.dutyStatus === filter;
      const matchesSearch = !q || d.name.toLowerCase().includes(q) || d.studentRegNo.toLowerCase().includes(q) || d.runnerCode.toLowerCase().includes(q) || d.phone.toLowerCase().includes(q) || d.vehicleRegNo.toLowerCase().includes(q);
      return matchesFilter && matchesSearch;
    });
  }, [drivers, filter, query]);

  const counts = useMemo(() => ({
    ALL: drivers.length,
    ONLINE: drivers.filter((d) => d.dutyStatus === 'ONLINE').length,
    IN_TRANSIT: drivers.filter((d) => d.dutyStatus === 'IN_TRANSIT').length,
    OFFLINE: drivers.filter((d) => d.dutyStatus === 'OFFLINE').length,
  }), [drivers]);

  const hasData = drivers.length > 0;
  const activeCount = counts.ONLINE + counts.IN_TRANSIT;
  // Counted from the loaded orders (the server keeps no per-rider daily numbers). Order.driverId is the rider's user id.
  const tripsByRider = useMemo(() => tripsTodayByRider(orders, now), [orders, now]);
  const tripsFor = (driver: DriverPartner): number => (driver.userId ? tripsByRider.get(driver.userId) ?? 0 : 0);
  const totalOrdersToday = drivers.reduce((sum, d) => sum + tripsFor(d), 0);
  const prefs = useTablePrefs<DriverColumn>('kraveo_drivers_prefs');
  const [sort, setSort] = useState<{ field: DriverSort; dir: 'asc' | 'desc' } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const value = (d: DriverPartner): string | number => (sort.field === 'name' ? d.name.toLowerCase() : sort.field === 'trips' ? tripsFor(d) : new Date(d.createdAt).getTime());
    return [...filtered].sort((a, b) => {
      const x = value(a); const y = value(b);
      const cmp = typeof x === 'string' ? x.localeCompare(String(y), 'fr') : x - (y as number);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, tripsByRider]);
  const pager = usePagination(sorted, `${filter}|${query}`, 10);
  const pageAllSelected = pager.pageItems.length > 0 && pager.pageItems.every((d) => selected.has(d.id));
  const toggleOne = (id: string) => setSelected((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const togglePage = () => setSelected((cur) => { const next = new Set(cur); pager.pageItems.forEach((d) => (pageAllSelected ? next.delete(d.id) : next.add(d.id))); return next; });
  const exportDrivers = (rows: DriverPartner[]) => downloadCsv('livreurs',
    ['Nom', 'Code', 'Téléphone', 'Véhicule', 'Immatriculation', 'Service', 'Validation', 'Courses du jour', 'Inscription'],
    rows.map((d) => [d.name, d.runnerCode, d.phone, vehicleLabel(d.vehicleType), d.vehicleRegNo, DUTY[d.dutyStatus]?.label, d.approvalStatus, tripsFor(d), d.createdAt]));
  const sortState = (field: DriverSort): false | 'asc' | 'desc' => (sort?.field === field ? sort.dir : false);
  const initialLoad = loading && !hasData;
  const emptyState = !hasData
    ? <EmptyState icon={Bike} title="Aucun livreur pour l’instant" description="Les livreurs apparaissent ici dès que vous en ajoutez un ou validez une candidature dans l’onglet Inscriptions." action={<button className="k-btn-accent" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Ajouter un livreur</button>} />
    : <EmptyState icon={SearchX} title="Aucun livreur correspondant" description="Rien ne correspond au filtre et à la recherche actuels." action={<button className="k-btn-ghost" onClick={() => { setFilter('ALL'); onClearQuery?.(); }}>Effacer les filtres</button>} />;

  return (
    <div className="space-y-5">
      <PageHeader icon={Bike} title="Livreurs" subtitle="Les livreurs partenaires, leur service et leurs courses du jour" onRefresh={onRefresh} refreshing={refreshing}
        actions={<button onClick={() => setShowAdd(true)} className="k-btn-accent"><Plus className="h-4 w-4" aria-hidden="true" /> Ajouter un livreur</button>} />
      <section aria-label="Résumé des livreurs" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiTile index={0} loading={initialLoad} label="En service" icon={Users}
          value={<><AnimatedNumber value={hasData ? activeCount : null} />{hasData && <span className="text-xl text-kraveo-ink3"> / {drivers.length}</span>}</>}
          note={hasData ? `${counts.IN_TRANSIT} en livraison` : 'Aucun livreur inscrit'} />
        <KpiTile index={1} loading={initialLoad} label="Courses du jour" icon={Zap} tone="text-kraveo-status-pickedUp" toneBg="bg-kraveo-status-pickedUp/15"
          value={<AnimatedNumber value={hasData ? totalOrdersToday : null} />} note="Livrées aujourd’hui, d’après les commandes chargées" />
        <KpiTile index={2} loading={initialLoad} label="En livraison" icon={Truck} tone="text-kraveo-status-ready" toneBg="bg-kraveo-status-ready/15"
          value={<AnimatedNumber value={hasData ? counts.IN_TRANSIT : null} />} note="Livreurs en course" />
        <KpiTile index={3} loading={initialLoad} label="Hors ligne" icon={Moon} tone="text-kraveo-status-atGate" toneBg="bg-kraveo-status-atGate/15"
          value={<AnimatedNumber value={hasData ? counts.OFFLINE : null} />} note="Inscrits mais pas en service" />
      </section>

      {onQueryChange && <SearchField value={query} onChange={onQueryChange} label="Rechercher un livreur" placeholder="Rechercher par nom, téléphone, matricule ou code…" />}
      <UnderlineTabs label="Filtrer par statut de service" value={filter} onChange={setFilter} tabs={[
        { id: 'ALL', label: 'Tous les livreurs', count: counts.ALL }, { id: 'ONLINE', label: 'En ligne', count: counts.ONLINE },
        { id: 'IN_TRANSIT', label: 'En livraison', count: counts.IN_TRANSIT }, { id: 'OFFLINE', label: 'Hors ligne', count: counts.OFFLINE },
      ]} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="px-1 text-xs text-kraveo-ink3" aria-live="polite">{filtered.length} livreur{filtered.length > 1 ? 's' : ''}{filtered.length !== drivers.length ? ` sur ${drivers.length}` : ''}</p>
        <div className="flex items-center gap-2">
          <button type="button" className="k-btn-ghost" onClick={() => exportDrivers(filtered)} disabled={filtered.length === 0}><Download className="h-4 w-4" aria-hidden="true" />Exporter en CSV</button>
          <ViewToggle value={prefs.view} onChange={prefs.setView} />
          <ColumnsMenu columns={DRIVER_COLUMNS} hidden={prefs.hidden} onToggle={prefs.toggleColumn} onReset={prefs.resetColumns} />
        </div>
      </div>

      {selected.size > 0 && <SelectionBar count={selected.size} noun="livreur" onExport={() => exportDrivers(drivers.filter((d) => selected.has(d.id)))} onClear={() => setSelected(new Set())} />}

      {prefs.view === 'table' && (
        <div className="k-card overflow-x-auto">
          <table className="w-full min-w-[820px] border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="k-label">
                <th scope="col" className="w-12 border-b border-kraveo-line px-4 py-3.5"><input type="checkbox" checked={pageAllSelected} onChange={togglePage} aria-label="Sélectionner tous les livreurs de la page" className="h-4 w-4 rounded border-kraveo-line accent-[#2F5BE0]" /></th>
                <th scope="col" className="border-b border-kraveo-line px-4 py-3.5"><SortHeader label="Livreur" active={sortState('name')} onClick={() => setSort(nextSort(sort, 'name'))} /></th>
                {prefs.show('phone') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Téléphone</th>}
                {prefs.show('vehicle') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Véhicule</th>}
                {prefs.show('status') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Service</th>}
                {prefs.show('approval') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Validation</th>}
                {prefs.show('trips') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5"><SortHeader label="Courses du jour" active={sortState('trips')} onClick={() => setSort(nextSort(sort, 'trips'))} /></th>}
                {prefs.show('joined') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5"><SortHeader label="Inscription" active={sortState('joined')} onClick={() => setSort(nextSort(sort, 'joined'))} /></th>}
                <th scope="col" className="w-10 border-b border-kraveo-line px-3 py-3.5" />
              </tr>
            </thead>
            <tbody>
              {initialLoad && Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={9} className="border-b border-kraveo-line/60 px-4 py-3"><Skeleton className="h-10 w-full" /></td></tr>)}
              {!initialLoad && pager.pageItems.length === 0 && <tr><td colSpan={9}>{emptyState}</td></tr>}
              {pager.pageItems.map((d) => {
                const cell = 'border-b border-kraveo-line/60 px-4 py-3 align-middle';
                return (
                  <tr key={d.id} tabIndex={0} aria-label={`Ouvrir le détail de ${d.name}`} onClick={() => setSelectedId(d.id)} onKeyDown={(e) => { if (e.key === 'Enter') setSelectedId(d.id); }}
                    className="cursor-pointer outline-none transition-colors hover:bg-kraveo-surface2/60 focus-visible:bg-kraveo-surface2/60">
                    <td className={`${cell} w-12`} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleOne(d.id)} aria-label={`Sélectionner ${d.name}`} className="h-4 w-4 rounded border-kraveo-line accent-[#2F5BE0]" /></td>
                    <td className={cell}><div className="flex items-center gap-3"><Avatar name={d.name} imageUrl={d.avatarUrl} size="sm" /><div className="min-w-0"><p className="truncate font-bold text-kraveo-ink">{d.name}</p><p className="truncate text-xs text-kraveo-ink3">{d.runnerCode ? `Livreur ${d.runnerCode}` : 'Aucun code livreur'}</p></div></div></td>
                    {prefs.show('phone') && <td className={`${cell} text-kraveo-ink2`}>{dash(d.phone)}</td>}
                    {prefs.show('vehicle') && <td className={`${cell} text-kraveo-ink2`}>{vehicleLabel(d.vehicleType) || '-'}{d.vehicleRegNo && d.vehicleRegNo !== 'Non renseignée' ? <span className="block text-xs text-kraveo-ink3">{d.vehicleRegNo}</span> : null}</td>}
                    {prefs.show('status') && <td className={cell}><DutyPill status={d.dutyStatus} /></td>}
                    {prefs.show('approval') && <td className={cell}><ApprovalPill status={d.approvalStatus} /></td>}
                    {prefs.show('trips') && <td className={`k-num ${cell} text-base text-kraveo-ink`}>{tripsFor(d)}</td>}
                    {prefs.show('joined') && <td className={`${cell} text-kraveo-ink2`}>{new Date(d.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</td>}
                    <td className={`${cell} px-3`}><ChevronRight className="h-4 w-4 text-kraveo-ink3" aria-hidden="true" /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {prefs.view === 'grid' && (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 2xl:grid-cols-3">
        {initialLoad && Array.from({ length: 6 }).map((_, index) => <SkeletonCard key={index} lines={2} />)}
        {!initialLoad && !hasData && <div className="k-card sm:col-span-2 2xl:col-span-3"><EmptyState icon={Bike} title="Aucun livreur pour l’instant" description="Les livreurs apparaissent ici dès que vous en ajoutez un ou validez une candidature dans l’onglet Candidatures." action={<button className="k-btn-accent" onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" aria-hidden="true" /> Ajouter un livreur</button>} /></div>}
        {!initialLoad && hasData && filtered.length === 0 && (
          <div className="k-card sm:col-span-2 2xl:col-span-3">
            <EmptyState icon={SearchX} title="Aucun livreur correspondant" description="Rien ne correspond au filtre et à la recherche actuels." action={<button className="k-btn-ghost" onClick={() => { setFilter('ALL'); onClearQuery?.(); }}>Effacer les filtres</button>} />
          </div>
        )}
        {pager.pageItems.map((d, index) => (
          <div
            key={d.id}
            role="button"
            tabIndex={0}
            aria-label={`Ouvrir le détail de ${d.name}`}
            onClick={() => setSelectedId(d.id)}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelectedId(d.id); } }}
            className="k-card k-card-hover k-reveal cursor-pointer p-5 text-left"
            style={{ ['--i' as string]: Math.min(index, 10) }}
          >
            <div className="flex items-start gap-3.5">
              <Avatar name={d.name} imageUrl={d.avatarUrl} size="lg" />
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-display text-lg font-bold leading-tight text-kraveo-ink">{d.name}</h3>
                <p className="truncate text-xs text-kraveo-ink3">{d.runnerCode ? `Livreur ${d.runnerCode}` : 'Aucun code livreur'}{d.phone ? ` · ${d.phone}` : ''}</p>
                <div className="mt-2 flex flex-wrap gap-1.5"><DutyPill status={d.dutyStatus} /><ApprovalPill status={d.approvalStatus} /></div>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-kraveo-ink3" aria-hidden="true" />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 text-center">
              <div className="k-inset px-2 py-2.5"><p className="k-label !text-[10px]">Courses du jour</p><p className="k-num text-lg text-kraveo-ink">{tripsFor(d)}</p></div>
            </div>
          </div>
        ))}
      </div>
      )}

      <Drawer
        open={Boolean(selectedDriver)}
        onClose={() => setSelectedId(null)}
        title={selectedDriver?.name ?? 'Livreur'}
        subtitle={selectedDriver?.runnerCode ? `Code livreur ${selectedDriver.runnerCode}` : 'Détails du livreur'}
        icon={Bike}
        footer={<button onClick={() => setSelectedId(null)} className="k-btn-ghost mb-1 w-full">Fermer</button>}
      >
        {selectedDriver && (
          <div className="space-y-3">
            <div className="flex items-center gap-4 pb-2">
              <Avatar name={selectedDriver.name} imageUrl={selectedDriver.avatarUrl} size="lg" />
              <div><DutyPill status={selectedDriver.dutyStatus} /><p className="mt-2 text-xs text-kraveo-ink3">Inscrit le {new Date(selectedDriver.createdAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <DetailRow label="Courses du jour">{tripsFor(selectedDriver)}</DetailRow>
            </div>
            {selectedDriver.approvalStatus && selectedDriver.approvalStatus !== 'APPROVED' && <DetailRow label="Validation"><ApprovalPill status={selectedDriver.approvalStatus} /></DetailRow>}
            {selectedDriver.studentRegNo && <DetailRow label="Matricule">{dash(selectedDriver.studentRegNo)}</DetailRow>}
            <DetailRow label="Téléphone">
              {selectedDriver.phone ? <a className="inline-flex items-center gap-1.5 text-kraveo-g700 hover:underline" href={`tel:${selectedDriver.phone}`}><Phone className="h-3.5 w-3.5" aria-hidden="true" />{selectedDriver.phone}</a> : '-'}
            </DetailRow>
            <DetailRow label="Téléphone d’urgence">
              {selectedDriver.emergencyPhone ? <a className="inline-flex items-center gap-1.5 text-kraveo-g700 hover:underline" href={`tel:${selectedDriver.emergencyPhone}`}><Phone className="h-3.5 w-3.5" aria-hidden="true" />{selectedDriver.emergencyPhone}</a> : '-'}
            </DetailRow>
            <DetailRow label="Véhicule">{vehicleLabel(selectedDriver.vehicleType)}{selectedDriver.vehicleRegNo !== 'Non renseignée' ? ` (${selectedDriver.vehicleRegNo})` : ''}</DetailRow>
            <DetailRow label="UPI de versement"><span className="font-mono">{dash(selectedDriver.upiId)}</span></DetailRow>
          </div>
        )}
      </Drawer>
      <PaginationBar page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} total={pager.total} onPage={pager.setPage} onPageSize={pager.setPageSize} noun="livreurs" />

      <AddPartnerDrawer open={showAdd} kind="DRIVER" onClose={() => setShowAdd(false)} onCreated={() => onCreated?.()} />
    </div>
  );
};
