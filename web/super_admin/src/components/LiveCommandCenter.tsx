import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bike, CheckCircle2, Crosshair, MapPin, PackageCheck, Radio, ShoppingBag, Timer, TriangleAlert, UserX, Users, Wallet } from 'lucide-react';
import { DriverPartner, DriverPin, Order, OrderStatus, Vendor } from '../types';
import { apiService } from '../services/api';
import { DropPointInfo, FALLBACK_DROP_POINTS, LatLng, campusCenter } from '../lib/campus';
import { averageDeliveryMinutes, isMapVendor, trackedRiders } from '../lib/dashboardStats';
import { RIDER_STATE_META, RIDER_STATE_ORDER, RiderMarkerState, countByState, riderMarkerState } from '../lib/riderMarkers';
import type { MapRider, MapVendor } from './CampusMap';
import { PIPELINE_ORDER, STATUS_META, inr, statusMeta, timeAgo } from '../lib/tokens';
import { AnimatedNumber } from './ui/AnimatedNumber';
import { PaymentPill, OtpLockedPill } from './ui/OrderBadges';
import { ReassignHandler, RiderAssignSelect, shortId } from './OrderControls';
import { GroupBadge } from './ui/GroupBadge';
import { preferRiderOrder, riderOrderLabel } from '../lib/orders';
import { groupSearchTerms } from '../lib/orderGroups';
import { Avatar } from './ui/Avatar';
import { StatusPill } from './ui/StatusPill';
import { changePercent, greeting, homeStats } from '../lib/homeStats';
import type { TabType } from '../lib/navigation';
import { EmptyState } from './ui/EmptyState';
import { KpiTile } from './ui/KpiTile';
import { Skeleton } from './ui/Skeleton';

// Leaflet (~150 kB) loads only when the map tab is opened; the rest of the dashboard never pays for it.
const CampusMap = lazy(() => import('./CampusMap'));

/** If the map chunk cannot load (offline, blocked) or the map throws, the list and the pipeline keep working. */
class MapBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: unknown) { console.error('campus map failed:', error instanceof Error ? error.message : 'unknown error'); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center rounded-k-lg border border-kraveo-line bg-kraveo-night/60">
        <EmptyState icon={MapPin} title="La carte n’a pas pu être chargée" description="Vérifiez la connexion et rechargez la page. La liste des livreurs et le suivi des livraisons ne sont pas affectés." />
      </div>
    );
  }
}

interface LiveCommandCenterProps {
  drivers: DriverPin[];
  orders: Order[];
  driverPartners: DriverPartner[];
  /** Restaurants with a real pin are drawn on the map. */
  vendors?: Vendor[];
  onReassignDriver: ReassignHandler;
  /** Opens the order drawer (details, cancel, reset OTP lock). */
  onOpenOrder?: (orderId: string) => void;
  loading?: boolean;
  query?: string;
  /** First name shown in the welcome banner. */
  adminName?: string;
  /** Jumps to another screen (shortcuts of the welcome banner and the to-do list). */
  onNavigate?: (tab: TabType) => void;
}

const EMPTY_VENDORS: Vendor[] = [];

/** One tracked-runner row. Memoised on primitives, so a position update only re-renders the row that moved. */
const RunnerRow = React.memo(function RunnerRow({ id, name, state, subtitle, onFocus }: { id: string; name: string; state: RiderMarkerState; subtitle: string; onFocus: (id: string) => void }) {
  const meta = RIDER_STATE_META[state];
  return (
    <li>
      <button
        type="button"
        onClick={() => onFocus(id)}
        aria-label={`${name}, ${meta.label.toLowerCase()}. ${subtitle}. Afficher sur la carte`}
        className="flex w-full items-center gap-3 rounded-k-md border border-transparent p-2.5 text-left transition-colors hover:border-kraveo-line hover:bg-kraveo-surface2"
      >
        <Avatar name={name} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold text-kraveo-ink">{name}</span>
          <span className="block truncate text-[11px] text-kraveo-ink3">{subtitle}</span>
        </span>
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold ${meta.text}`}><span className={`k-dot ${meta.dot}`} aria-hidden="true" />{meta.label}</span>
      </button>
    </li>
  );
});

const orderMatches = (order: Order, query: string): boolean => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [order.id, order.vendorName, order.customerName, order.dropoffHostel, order.driverName, ...groupSearchTerms(order.group)]
    .some((value) => Boolean(value) && String(value).toLowerCase().includes(q));
};

export const LiveCommandCenter: React.FC<LiveCommandCenterProps> = ({ drivers, orders, driverPartners, vendors = EMPTY_VENDORS, onReassignDriver, onOpenOrder, loading = false, query = '', adminName, onNavigate }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const initialLoad = loading && orders.length === 0 && driverPartners.length === 0;

  const activeOrders = useMemo(() => orders.filter((order) => !['DELIVERED', 'CANCELLED'].includes(order.status)), [orders]);
  // Only paid orders reach the restaurant (contract 1.2); unpaid ones are waiting on the customer, not the vendor.
  const pendingCount = orders.filter((order) => order.status === 'PLACED' && order.paymentStatus === 'PAID').length;
  const unpaidCount = orders.filter((order) => order.status === 'PLACED' && order.paymentStatus !== 'PAID').length;
  const runnersOnline = driverPartners.filter((driver) => driver.dutyStatus === 'ONLINE' || driver.dutyStatus === 'IN_TRANSIT').length;

  // Average placed -> delivered over delivered orders in the feed: the same definition as the Analytics tab.
  const avgDeliveryMinutes = useMemo(() => averageDeliveryMinutes(orders), [orders]);

  const activeByDriver = useMemo(() => {
    const map = new Map<string, Order>();
    activeOrders.forEach((order) => {
      if (!order.driverId) return;
      const current = map.get(order.driverId);
      if (!current || preferRiderOrder(order, current)) map.set(order.driverId, order);
    });
    return map;
  }, [activeOrders]);

  // Marker state per rider: off duty > stale (> 2 min) > delivering > heading to the restaurant > idle.
  const riderStates = useMemo(() => {
    const map = new Map<string, RiderMarkerState>();
    // The roster is live (driver_duty_update), a position's own duty flag is only as fresh as its last fix.
    const dutyByUser = new Map(driverPartners.filter((partner) => partner.userId).map((partner) => [partner.userId as string, partner.dutyStatus] as const));
    for (const driver of drivers) {
      map.set(driver.id, riderMarkerState({ dutyStatus: dutyByUser.get(driver.id) ?? driver.dutyStatus, lastUpdated: driver.lastUpdated, orderStatus: activeByDriver.get(driver.id)?.status, now }));
    }
    return map;
  }, [drivers, driverPartners, activeByDriver, now]);

  // Riders worth tracking: not off duty, approved, and not an old test row. They may still be in the Drivers roster.
  const tracked = useMemo(() => trackedRiders(drivers, driverPartners, new Set(activeByDriver.keys()), now), [drivers, driverPartners, activeByDriver, now]);
  const plottable = useMemo(() => tracked.filter((driver) => Number.isFinite(driver.lat) && Number.isFinite(driver.lng)), [tracked]);
  const stateCounts = useMemo(() => countByState(plottable.map((driver) => riderStates.get(driver.id) ?? 'stale')), [plottable, riderStates]);

  // Campus data: built-in copy first, the server's answer replaces it when it arrives.
  const [campus, setCampus] = useState<{ center: LatLng; dropPoints: DropPointInfo[] }>(() => ({ center: campusCenter(), dropPoints: FALLBACK_DROP_POINTS }));
  useEffect(() => {
    let alive = true;
    apiService.fetchCampus().then((data) => { if (alive && data) setCampus(data); });
    return () => { alive = false; };
  }, []);

  const mapRiders = useMemo<MapRider[]>(() => plottable.map((driver) => {
    const order = activeByDriver.get(driver.id);
    return {
      id: driver.id,
      name: driver.name,
      lat: driver.lat,
      lng: driver.lng,
      state: riderStates.get(driver.id) ?? 'stale',
      lastUpdated: driver.lastUpdated,
      orderLabel: order ? riderOrderLabel(order) : null,
    };
  }), [plottable, activeByDriver, riderStates]);

  const mapVendors = useMemo<MapVendor[]>(() => vendors
    .filter((vendor) => isMapVendor(vendor))
    .map((vendor) => ({ id: vendor.id, name: vendor.name, lat: vendor.lat as number, lng: vendor.lng as number })), [vendors]);

  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number } | null>(null);
  const focusCounter = useRef(0);
  const focusRider = useCallback((id: string) => { focusCounter.current += 1; setFocusRequest({ id, n: focusCounter.current }); }, []);

  // The parent re-creates these handlers on every render; the pipeline below must not re-render because of that.
  const reassignRef = useRef(onReassignDriver);
  reassignRef.current = onReassignDriver;
  const openOrderRef = useRef(onOpenOrder);
  openOrderRef.current = onOpenOrder;
  const hasOpenOrder = Boolean(onOpenOrder);
  const stableReassign = useCallback<ReassignHandler>((...args) => reassignRef.current(...args), []);
  const stableOpenOrder = useMemo(() => (hasOpenOrder ? (orderId: string) => openOrderRef.current?.(orderId) : undefined), [hasOpenOrder]);


  const unassignedCount = activeOrders.filter((order) => !order.driverId && order.paymentStatus === 'PAID').length;
  const lockedCount = activeOrders.filter((order) => order.otpLocked).length;
  const stats = useMemo(() => homeStats(orders, now), [orders, now]);
  const ordersDelta = changePercent(stats.today.orders, stats.yesterday.orders);
  const revenueDelta = changePercent(stats.today.revenue, stats.yesterday.revenue);
  const deltaNote = (delta: number | null, fallback: string) => (delta === null ? fallback : `${delta > 0 ? '+' : ''}${delta} % par rapport à hier`);
  const weekMax = Math.max(1, ...stats.week.map((day) => day.orders));
  const firstName = adminName?.trim().split(/\s+/)[0];

  const [filter, setFilter] = useState<'all' | 'unassigned' | (typeof PIPELINE_ORDER)[number]>('all');
  const listRef = useRef<HTMLElement>(null);
  const showList = useCallback((next: 'all' | 'unassigned' | (typeof PIPELINE_ORDER)[number]) => {
    setFilter(next);
    listRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }, []);

  const visibleOrders = useMemo(() => activeOrders.filter((order) => orderMatches(order, query)), [activeOrders, query]);
  const counts = useMemo(() => {
    const byKey = new Map<string, number>();
    visibleOrders.forEach((order) => { const key = statusMeta(order.status).key; byKey.set(key, (byKey.get(key) ?? 0) + 1); });
    return byKey;
  }, [visibleOrders]);
  const shownOrders = useMemo(() => visibleOrders
    .filter((order) => (filter === 'all' ? true : filter === 'unassigned' ? !order.driverId : statusMeta(order.status).key === filter))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [visibleOrders, filter]);

  // Rebuilt only when orders, riders or the filter change. A position update (every few seconds per rider)
  // re-renders the map card and the changed list row, never the order list.
  const pipeline = useMemo(() => {
    const chips: Array<{ key: typeof filter; label: string; count: number }> = [
      { key: 'all', label: 'Toutes', count: visibleOrders.length },
      ...PIPELINE_ORDER.map((key) => ({ key, label: STATUS_META[key].label, count: counts.get(key) ?? 0 })).filter((chip) => chip.count > 0 || chip.key === filter),
    ];
    return (
      <section ref={listRef} aria-label="Suivi des livraisons" className="k-card scroll-mt-24 space-y-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-lg font-bold text-kraveo-ink">Commandes en cours</h2>
            <p className="text-xs text-kraveo-ink3">{query.trim() ? `Filtré par « ${query.trim()} »` : 'Les plus récentes en premier. Changez de livreur directement ici.'}</p>
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrer par statut">
            {chips.map((chip) => (
              <button key={chip.key} type="button" onClick={() => setFilter(chip.key)} aria-pressed={filter === chip.key}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition-colors ${filter === chip.key ? 'border-kraveo-g500 bg-kraveo-g500 text-white' : 'border-kraveo-line bg-kraveo-surface text-kraveo-ink2 hover:bg-kraveo-surface2'}`}>
                {chip.label}<span className={`tabular-nums ${filter === chip.key ? 'text-white/80' : 'text-kraveo-ink3'}`}>{chip.count}</span>
              </button>
            ))}
            {filter === 'unassigned' && <span className="inline-flex items-center rounded-full bg-kraveo-status-placed/15 px-3 py-1.5 text-xs font-bold text-kraveo-status-placed">Sans livreur</span>}
          </div>
        </div>

        <div className="space-y-2.5">
          {initialLoad && <><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></>}
          {!initialLoad && shownOrders.length === 0 && (
            <EmptyState icon={PackageCheck} title={query.trim() ? 'Aucune commande correspondante' : 'Aucune commande en cours'} description={query.trim() ? 'Essayez un autre mot dans la recherche.' : 'Les nouvelles commandes apparaissent ici dès qu’elles sont passées.'} className="py-10" />
          )}
          {shownOrders.map((order) => (
            <article key={order.id} className="grid items-center gap-3 rounded-k-lg border border-kraveo-line bg-kraveo-surface p-3.5 transition-colors hover:border-kraveo-g400/50 hover:bg-kraveo-night/60 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_minmax(190px,0.9fr)] md:gap-5">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  {stableOpenOrder
                    ? <button type="button" aria-haspopup="dialog" aria-label={`Ouvrir la commande ${shortId(order.id)}`} onClick={() => stableOpenOrder(order.id)} className="rounded font-mono text-xs font-bold text-kraveo-g700 hover:underline" title={order.id}>{shortId(order.id)}</button>
                    : <span className="font-mono text-xs font-bold text-kraveo-ink" title={order.id}>{shortId(order.id)}</span>}
                  <StatusPill status={order.status} compact />
                  <span className="text-[11px] text-kraveo-ink3">{timeAgo(order.createdAt, now)}</span>
                </div>
                <p className="truncate text-sm font-bold text-kraveo-ink">{order.vendorName}</p>
                {(order.group || order.paymentStatus !== 'PAID' || order.otpLocked) && (
                  <div className="flex flex-wrap gap-1">
                    {order.group && <GroupBadge group={order.group} />}
                    {order.paymentStatus !== 'PAID' && <PaymentPill status={order.paymentStatus} />}
                    <OtpLockedPill order={order} />
                  </div>
                )}
              </div>
              <div className="flex min-w-0 items-center gap-1.5 text-xs text-kraveo-ink2">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-kraveo-ink3" aria-hidden="true" /><span className="truncate">{order.dropoffHostel}</span>
              </div>
              <span className="k-num text-base text-kraveo-ink md:text-right">{inr(order.totalAmount)}</span>
              <div className="min-w-0 space-y-1.5">
                {order.driverName
                  ? <div className="flex items-center gap-2 text-xs"><Avatar name={order.driverName} size="sm" className="!h-6 !w-6 !text-[9px]" /><span className="truncate font-bold text-kraveo-ink">{order.driverName}</span></div>
                  : <span className="inline-flex items-center gap-1.5 rounded-full bg-kraveo-status-placed/15 px-2.5 py-1 text-xs font-bold text-kraveo-status-placed"><UserX className="h-3 w-3" aria-hidden="true" />Non assignée</span>}
                <RiderAssignSelect order={order} riders={driverPartners} onReassign={stableReassign} />
              </div>
            </article>
          ))}
        </div>
      </section>
    );
  }, [counts, filter, visibleOrders.length, shownOrders, query, initialLoad, now, driverPartners, stableOpenOrder, stableReassign]);

  const todo = [
    { key: 'pending', count: pendingCount, label: 'en attente du restaurant', hint: 'Payées, pas encore acceptées', icon: PackageCheck, tone: 'text-kraveo-status-placed bg-kraveo-status-placed/15', onClick: () => showList('placed') },
    { key: 'unassigned', count: unassignedCount, label: 'sans livreur', hint: 'Payées, aucun livreur choisi', icon: UserX, tone: 'text-kraveo-status-preparing bg-kraveo-status-preparing/15', onClick: () => showList('unassigned') },
    { key: 'locked', count: lockedCount, label: 'code de livraison bloqué', hint: 'Le client s’est trompé trop de fois', icon: TriangleAlert, tone: 'text-kraveo-danger bg-kraveo-danger/10', onClick: () => onNavigate?.('attention') },
  ];
  const todoOpen = todo.filter((item) => item.count > 0);

  return (
    <div className="space-y-6 sm:space-y-8">
      {/* Welcome */}
      <section aria-label="Bienvenue" className="relative overflow-hidden rounded-k-xl border border-kraveo-line bg-gradient-to-br from-kraveo-g800 via-kraveo-g700 to-kraveo-g500 p-5 text-white shadow-k-soft sm:p-8">
        <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-kraveo-yellow/25 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-48 w-48 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-white/70">{new Date(now).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })}</p>
            <h1 className="mt-2 font-display text-2xl font-extrabold tracking-tight sm:text-4xl">{greeting(now)}{firstName ? `, ${firstName}` : ''}</h1>
            <p className="mt-2 max-w-xl text-sm text-white/80 sm:text-base">
              {initialLoad ? 'Chargement de l’activité…'
                : activeOrders.length
                  ? <>Il y a <strong className="text-white">{activeOrders.length} commande{activeOrders.length > 1 ? 's' : ''} en cours</strong> et <strong className="text-white">{runnersOnline} livreur{runnersOnline > 1 ? 's' : ''} en ligne</strong> à Thiès.</>
                  : <>Aucune commande en cours pour l’instant. <strong className="text-white">{runnersOnline} livreur{runnersOnline > 1 ? 's' : ''} en ligne</strong>.</>}
            </p>
          </div>
          {onNavigate && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onNavigate('orders')} className="inline-flex items-center gap-2 rounded-full bg-kraveo-yellow px-4 py-2.5 text-sm font-bold text-kraveo-ink shadow-k-soft transition-transform hover:-translate-y-0.5">
                Toutes les commandes <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => onNavigate('applications')} className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-white/10 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-white/20">
                Inscriptions
              </button>
            </div>
          )}
        </div>
      </section>

      {/* KPI strip: every number comes from the loaded feeds; "-" when a source has nothing to report */}
      <section aria-label="Chiffres clés" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiTile index={0} loading={initialLoad} label="Commandes aujourd’hui" icon={ShoppingBag}
          value={<AnimatedNumber value={stats.today.orders} />} note={deltaNote(ordersDelta, stats.yesterday.orders ? 'Comme hier' : 'Pas de commande hier')} />
        <KpiTile index={1} loading={initialLoad} label="Ventes du jour" icon={Wallet} tone="text-kraveo-status-delivered" toneBg="bg-kraveo-status-delivered/15"
          value={<AnimatedNumber value={stats.today.revenue} suffix=" FCFA" />} note={deltaNote(revenueDelta, 'Commandes payées uniquement')} />
        <KpiTile index={2} loading={initialLoad} label="Livreurs en ligne" icon={Users} tone="text-kraveo-status-pickedUp" toneBg="bg-kraveo-status-pickedUp/15"
          value={<AnimatedNumber value={driverPartners.length ? runnersOnline : null} />}
          note={driverPartners.length ? `sur ${driverPartners.length} livreur${driverPartners.length > 1 ? 's' : ''} inscrit${driverPartners.length > 1 ? 's' : ''}` : 'Liste des livreurs indisponible'} />
        <KpiTile index={3} loading={initialLoad} label="Délai moyen de livraison" icon={Timer} tone="text-kraveo-status-atGate" toneBg="bg-kraveo-status-atGate/15"
          value={<AnimatedNumber value={avgDeliveryMinutes ? avgDeliveryMinutes.value : null} decimals={1} suffix={avgDeliveryMinutes ? ' min' : ''} />}
          note={avgDeliveryMinutes ? `De la commande à la livraison, ${avgDeliveryMinutes.count} livrée${avgDeliveryMinutes.count === 1 ? '' : 's'}` : 'Aucune commande livrée pour l’instant'} />
      </section>

      {/* To do + week */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:gap-6" aria-label="À traiter et activité de la semaine">
        <div className="k-card flex flex-col p-5 sm:p-6 lg:col-span-2">
          <h2 className="font-display text-base font-bold text-kraveo-ink">À traiter maintenant</h2>
          <p className="text-xs text-kraveo-ink3">Ce qui demande votre attention</p>
          {todoOpen.length === 0 ? (
            <div className="mt-5 flex flex-1 flex-col items-center justify-center gap-2 rounded-k-lg bg-kraveo-status-delivered/10 px-4 py-8 text-center">
              <CheckCircle2 className="h-8 w-8 text-kraveo-status-delivered" aria-hidden="true" />
              <p className="text-sm font-bold text-kraveo-ink">Tout est sous contrôle</p>
              <p className="text-xs text-kraveo-ink3">Aucune commande ne demande d’action.</p>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {todoOpen.map((item) => (
                <li key={item.key}>
                  <button type="button" onClick={item.onClick} className="group flex w-full items-center gap-3 rounded-k-lg border border-kraveo-line p-3 text-left transition-colors hover:bg-kraveo-surface2">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-k-md ${item.tone}`}><item.icon className="h-5 w-5" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-kraveo-ink"><span className="k-num mr-1 text-lg">{item.count}</span>{item.label}</span>
                      <span className="block truncate text-[11px] text-kraveo-ink3">{item.hint}</span>
                    </span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-kraveo-ink3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {unpaidCount > 0 && <p className="mt-3 text-[11px] text-kraveo-ink3">{unpaidCount} commande{unpaidCount > 1 ? 's' : ''} en attente de paiement du client.</p>}
        </div>

        <div className="k-card p-5 sm:p-6 lg:col-span-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-bold text-kraveo-ink">Commandes des 7 derniers jours</h2>
              <p className="text-xs text-kraveo-ink3">Hors commandes annulées</p>
            </div>
            <span className="rounded-full bg-kraveo-surface2 px-3 py-1 text-xs font-bold tabular-nums text-kraveo-ink2">{stats.week.reduce((sum, day) => sum + day.orders, 0)} au total</span>
          </div>
          <div className="mt-6 flex h-44 items-end gap-2 sm:gap-4" role="img" aria-label="Nombre de commandes par jour sur les 7 derniers jours">
            {stats.week.map((day, index) => {
              const isToday = index === stats.week.length - 1;
              return (
                <div key={day.day} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                  <span className="text-xs font-bold tabular-nums text-kraveo-ink2">{day.orders}</span>
                  <div className={`w-full max-w-[44px] rounded-t-k-sm transition-all ${isToday ? 'bg-kraveo-yellow' : 'bg-kraveo-g500/80'}`} style={{ height: `${Math.max(4, (day.orders / weekMax) * 100)}%` }} />
                  <span className={`text-[11px] capitalize ${isToday ? 'font-bold text-kraveo-ink' : 'text-kraveo-ink3'}`}>{isToday ? 'Auj.' : new Date(`${day.day}T00:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Map + runners */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:gap-6" aria-label="Carte des livreurs">
        <div className="k-card flex h-[460px] min-w-0 flex-col overflow-hidden p-3 sm:h-[520px] sm:p-4 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-k-sm bg-kraveo-g500/10 text-kraveo-g600"><Crosshair className="h-4 w-4" aria-hidden="true" /></span>
              <div>
                <h2 className="font-display text-base font-bold leading-tight text-kraveo-ink">Carte en direct de Thiès</h2>
                <p className="text-[11px] text-kraveo-ink3">Points de livraison, restaurants et livreurs en service</p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-kraveo-surface2 px-3 py-1 text-xs font-bold text-kraveo-ink2" aria-live="polite">
              <Radio className="h-3.5 w-3.5 text-kraveo-g600" aria-hidden="true" />{plottable.length} livreur{plottable.length === 1 ? '' : 's'} sur la carte
            </span>
          </div>

          <div className="relative min-h-0 flex-1 overflow-hidden rounded-k-lg border border-kraveo-line">
            <MapBoundary>
              <Suspense fallback={<div className="h-full w-full animate-pulse bg-kraveo-surface2/60" aria-busy="true" aria-label="Chargement de la carte" />}>
                <CampusMap riders={mapRiders} vendors={mapVendors} dropPoints={campus.dropPoints} center={campus.center} now={now} focusRequest={focusRequest} />
              </Suspense>
            </MapBoundary>
            {plottable.length === 0 && !initialLoad && (
              <p className="pointer-events-none absolute left-1/2 top-3 z-[500] -translate-x-1/2 rounded-full border border-kraveo-line bg-kraveo-night/90 px-3 py-1 text-[11px] text-kraveo-ink2" role="status">
                Aucune position de livreur pour l’instant. Les repères apparaissent quand un livreur se met en service.
              </p>
            )}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-xs text-kraveo-ink2" aria-label="Légende de la carte" role="group">
            {RIDER_STATE_ORDER.map((state) => (
              <span key={state} className="inline-flex items-center gap-1.5">
                <span className="k-dot" style={{ backgroundColor: RIDER_STATE_META[state].hex }} aria-hidden="true" />
                {RIDER_STATE_META[state].label}
                <span className="font-bold tabular-nums text-kraveo-ink">{stateCounts[state]}</span>
              </span>
            ))}
            <span className="ml-auto hidden text-[11px] text-kraveo-ink3 sm:inline">Gris : pas de mise à jour depuis 2 min</span>
          </div>
        </div>

        <div className="k-card flex max-h-[420px] min-w-0 flex-col overflow-hidden p-4 sm:h-[520px] sm:max-h-[520px]">
          <div className="mb-3 flex items-center justify-between border-b border-kraveo-line pb-3">
            <h2 className="flex items-center gap-2 font-display text-base font-bold text-kraveo-ink"><Bike className="h-4 w-4 text-kraveo-g600" aria-hidden="true" /> Livreurs suivis</h2>
            <span className="rounded-full bg-kraveo-surface2 px-2.5 py-0.5 text-xs font-bold tabular-nums text-kraveo-ink2">{tracked.length}</span>
          </div>
          <ul className="-mx-1 flex-1 space-y-1.5 overflow-y-auto px-1" aria-label="Livreurs suivis">
            {initialLoad && Array.from({ length: 4 }).map((_, index) => <li key={index}><Skeleton className="h-14 w-full" /></li>)}
            {!initialLoad && tracked.length === 0 && <li><EmptyState icon={Bike} title="Aucun livreur en service" description="Les livreurs apparaissent ici lorsqu’ils sont en service et envoient leur position." className="py-8" /></li>}
            {tracked.map((driver) => {
              const order = activeByDriver.get(driver.id);
              return (
                <RunnerRow
                  key={driver.id}
                  id={driver.id}
                  name={driver.name}
                  state={riderStates.get(driver.id) ?? 'stale'}
                  subtitle={order ? (order.group ? `Commande groupée (${order.group.size}) · ${order.dropoffHostel}` : `${shortId(order.id)} · ${order.dropoffHostel}`) : `Mis à jour ${timeAgo(driver.lastUpdated, now)}`}
                  onFocus={focusRider}
                />
              );
            })}
          </ul>
        </div>
      </section>

      {pipeline}
    </div>
  );
};
