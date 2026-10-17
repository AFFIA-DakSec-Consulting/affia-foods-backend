import React, { useMemo, useState } from 'react';
import { Ban, CalendarDays, ChefHat, ClipboardList, History, MessageSquareText, Receipt, Star, TrendingUp, UtensilsCrossed, Wallet, BadgePercent } from 'lucide-react';
import { Order, Vendor } from '../types';
import { apiService } from '../services/api';
import { dakarDay } from '../lib/homeStats';
import { isTerminal, orderCode } from '../lib/orders';
import { dayFigures, firstName, restaurantOrders, waitLabel, minutesSince } from '../lib/restaurantStats';
import { inr, timeAgo } from '../lib/tokens';
import { promoValueLabel } from '../lib/platformParse';
import { stateLabel } from './CatalogStateBadge';
import { EmptyState } from './ui/EmptyState';
import { KpiTile } from './ui/KpiTile';
import { PaginationBar, usePagination } from './ui/Pagination';
import { SkeletonCard } from './ui/Skeleton';
import { StatusPill } from './ui/StatusPill';
import { PageHeader } from './ui/PageToolbar';
import { ErrorBanner, Pill, dateOnly, dateTime, useLoad } from './platform/common';

// Screens of the "Mon restaurant" workspace. They show ONE restaurant (picked at the top) and, like the dashboard, only what that
// restaurant is allowed to see: its own prices and earnings, never the customer's payment, fees or commission (Docs/21).

interface ScopeProps { vendors: Vendor[]; vendorId: string; onVendorChange: (id: string) => void }

const Header: React.FC<ScopeProps & { icon: React.ElementType; title: string; subtitle: string; onRefresh?: () => void; refreshing?: boolean }> = ({ vendors, vendorId, onVendorChange, icon, title, subtitle, onRefresh, refreshing }) => (
  <PageHeader icon={icon} title={title} subtitle={subtitle} onRefresh={onRefresh} refreshing={refreshing}
    actions={(
      <select className="k-select !min-h-[40px] !w-auto" value={vendorId} onChange={(e) => onVendorChange(e.target.value)} aria-label="Restaurant affiché">
        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
    )} />
);

const NoVendor: React.FC = () => <div className="k-card p-6"><EmptyState icon={UtensilsCrossed} title="Aucun restaurant" description="Aucun restaurant n’est encore disponible dans l’aperçu." /></div>;

// ───────────────────────── Orders: in progress / history / cancelled ─────────────────────────

export type OrdersMode = 'current' | 'history' | 'returns';
const MODE: Record<OrdersMode, { title: string; subtitle: string; icon: React.ElementType; empty: string }> = {
  current: { title: 'Commandes en cours', subtitle: 'Les commandes payées à accepter, préparer et remettre.', icon: ClipboardList, empty: 'Aucune commande en cours : tout est à jour.' },
  history: { title: 'Historique des commandes', subtitle: 'Toutes vos commandes livrées.', icon: History, empty: 'Aucune commande livrée pour l’instant.' },
  returns: { title: 'Retours & annulations', subtitle: 'Les commandes annulées et la raison.', icon: Ban, empty: 'Aucune commande annulée : bravo.' },
};
const CANCEL_BY: Record<string, string> = { CUSTOMER: 'le client', VENDOR: 'le restaurant', ADMIN: 'l’équipe Affia Foods', SYSTEM: 'le système' };

export const ordersForMode = (orders: Order[], vendorId: string, mode: OrdersMode): Order[] => {
  const mine = mode === 'returns' ? orders.filter((o) => o.vendorId === vendorId && o.status === 'CANCELLED') : restaurantOrders(orders, vendorId);
  const time = (o: Order) => new Date(o.createdAt).getTime();
  if (mode === 'current') return mine.filter((o) => !isTerminal(o.status)).sort((a, b) => time(a) - time(b));
  if (mode === 'history') return mine.filter((o) => o.status === 'DELIVERED').sort((a, b) => time(b) - time(a));
  return mine.sort((a, b) => time(b) - time(a));
};

export const RestaurantOrdersPage: React.FC<ScopeProps & { mode: OrdersMode; orders: Order[]; now: number; onOpenOrder: (id: string) => void; loading?: boolean }> = ({ mode, orders, now, onOpenOrder, loading, ...scope }) => {
  const cfg = MODE[mode];
  const rows = useMemo(() => ordersForMode(orders, scope.vendorId, mode), [orders, scope.vendorId, mode]);
  const pager = usePagination(rows, `${scope.vendorId}|${mode}`, 10);
  const earned = rows.reduce((sum, o) => sum + (typeof o.vendorSubtotal === 'number' ? o.vendorSubtotal : 0), 0);
  return (
    <div className="space-y-5">
      <Header {...scope} icon={cfg.icon} title={cfg.title} subtitle={cfg.subtitle} />
      {!scope.vendorId ? <NoVendor /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <KpiTile index={0} loading={loading && rows.length === 0} label={mode === 'returns' ? 'Annulées' : mode === 'history' ? 'Livrées' : 'En cours'} icon={cfg.icon} value={rows.length} />
            {mode !== 'returns' && <KpiTile index={1} loading={loading && rows.length === 0} label="Vous gagnez" icon={Wallet} value={inr(earned)} note="Vos prix, sans commission" />}
          </div>
          {rows.length === 0 && !loading && <div className="k-card p-6"><EmptyState icon={cfg.icon} title={cfg.empty} /></div>}
          {rows.length > 0 && (
            <ul className="k-card divide-y divide-kraveo-line/60 overflow-hidden">
              {pager.pageItems.map((o) => (
                <li key={o.id}>
                  <button type="button" onClick={() => onOpenOrder(o.id)} className="flex w-full flex-col gap-1.5 px-4 py-3 text-left hover:bg-kraveo-surface2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-kraveo-ink">{orderCode(o.id)} · {firstName(o.customerName)} · {o.itemsCount} article{o.itemsCount > 1 ? 's' : ''}</span>
                      <span className="block truncate text-xs text-kraveo-ink3">
                        {mode === 'current' ? `Reçue ${waitLabel(minutesSince(o.createdAt, now))}` : dateTime(o.deliveredAt ?? o.cancelledAt ?? o.createdAt)}
                        {mode === 'returns' && ` · annulée par ${CANCEL_BY[String(o.cancelledBy)] ?? 'inconnu'}${o.cancelReason ? ` : ${o.cancelReason}` : ''}`}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-3">
                      {typeof o.vendorSubtotal === 'number' && mode !== 'returns' && <span className="k-num text-kraveo-ink">{inr(o.vendorSubtotal)}</span>}
                      <StatusPill status={o.status} compact />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <PaginationBar page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} total={pager.total} onPage={pager.setPage} noun="commandes" />
        </>
      )}
    </div>
  );
};

// ───────────────────────── Statistics ─────────────────────────

const DAY_MS = 86_400_000;
export const lastDays = (now: number, count: number): string[] => Array.from({ length: count }, (_, i) => dakarDay(now - (count - 1 - i) * DAY_MS) as string);

export const topDishesOver = (orders: Order[], days: string[], limit = 5): Array<{ name: string; quantity: number }> => {
  const set = new Set(days);
  const totals = new Map<string, number>();
  for (const o of orders) {
    if (o.status === 'CANCELLED' || !set.has(dakarDay(o.createdAt) as string)) continue;
    for (const item of o.items ?? []) totals.set(item.name, (totals.get(item.name) ?? 0) + item.quantity);
  }
  return Array.from(totals, ([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name, 'fr')).slice(0, limit);
};

export const RestaurantStatsPage: React.FC<ScopeProps & { orders: Order[]; now: number }> = ({ orders, now, ...scope }) => {
  const mine = useMemo(() => restaurantOrders(orders, scope.vendorId), [orders, scope.vendorId]);
  const days = useMemo(() => lastDays(now, 7), [now]);
  const figures = days.map((d) => ({ day: d, ...dayFigures(mine, d) }));
  const totalOrders = figures.reduce((s, f) => s + f.orders, 0);
  const totalSales = figures.reduce((s, f) => s + f.sales, 0);
  const best = figures.reduce((a, f) => (f.sales > a.sales ? f : a), figures[0]);
  const max = Math.max(1, ...figures.map((f) => f.sales));
  const top = topDishesOver(mine, days);
  const weekday = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'short', timeZone: 'UTC' });
  return (
    <div className="space-y-5">
      <Header {...scope} icon={TrendingUp} title="Statistiques" subtitle="Vos ventes et vos plats les plus commandés sur 7 jours." />
      {!scope.vendorId ? <NoVendor /> : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiTile index={0} label="Commandes (7 j)" icon={ClipboardList} value={totalOrders} />
            <KpiTile index={1} label="Ventes (7 j)" icon={Wallet} value={inr(totalSales)} note="Vos prix, sans commission" />
            <KpiTile index={2} label="Panier moyen" icon={Receipt} value={totalOrders && totalSales ? inr(Math.round(totalSales / totalOrders)) : '—'} />
            <KpiTile index={3} label="Meilleur jour" icon={CalendarDays} value={best && best.sales > 0 ? weekday(best.day) : '—'} note={best && best.sales > 0 ? inr(best.sales) : 'Pas encore de vente'} />
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="k-card p-4 sm:p-5" aria-label="Ventes par jour">
              <h2 className="mb-4 font-display text-base font-bold text-kraveo-ink">Ventes par jour</h2>
              <div className="flex h-44 items-end gap-2" role="img" aria-label="Ventes des 7 derniers jours">
                {figures.map((f) => (
                  <div key={f.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${weekday(f.day)} : ${inr(f.sales)} · ${f.orders} commande${f.orders > 1 ? 's' : ''}`}>
                    <span className="text-[10px] tabular-nums text-kraveo-ink3">{f.orders}</span>
                    <span className="w-full rounded-t-k-sm bg-kraveo-g500/80" style={{ height: `${Math.max(f.sales > 0 ? 6 : 2, Math.round((f.sales / max) * 100))}%` }} />
                    <span className="text-[11px] font-semibold capitalize text-kraveo-ink2">{weekday(f.day)}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="k-card p-4 sm:p-5" aria-label="Plats populaires">
              <h2 className="mb-3 font-display text-base font-bold text-kraveo-ink">Plats populaires</h2>
              {top.length === 0 ? <EmptyState icon={ChefHat} title="Pas encore de plat vendu" description="Le classement apparaît dès les premières commandes." /> : (
                <ol className="space-y-2">{top.map((d, i) => <li key={d.name} className="k-inset flex items-center justify-between gap-3 px-4 py-2.5 text-sm"><span className="flex min-w-0 gap-3"><span className="k-num w-5 text-kraveo-ink3">{i + 1}</span><span className="truncate font-bold text-kraveo-ink">{d.name}</span></span><span className="shrink-0 text-xs text-kraveo-ink2">{d.quantity} vendu{d.quantity > 1 ? 's' : ''}</span></li>)}</ol>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
};

// ───────────────────────── Reviews ─────────────────────────

export const RestaurantReviewsPage: React.FC<ScopeProps & { onAuthError: (e: unknown) => void }> = ({ onAuthError, ...scope }) => {
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useLoad(() => (scope.vendorId ? apiService.fetchReviews({ vendorId: scope.vendorId }, page, 20) : Promise.resolve(null)), onAuthError, [scope.vendorId, page]);
  const rows = data?.data ?? [];
  const avg = rows.length ? rows.reduce((s, r) => s + r.driverRating, 0) / rows.length : null;
  return (
    <div className="space-y-5">
      <Header {...scope} icon={MessageSquareText} title="Avis clients" subtitle="Ce que vos clients disent de leurs commandes." onRefresh={reload} refreshing={loading} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KpiTile index={0} label="Avis" icon={MessageSquareText} value={data.total} />
          <KpiTile index={1} label="Note de la page" icon={Star} value={avg === null ? '—' : avg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} note="Note de la livraison, sur 5" />
        </div>
      )}
      {loading && !data && <SkeletonCard lines={3} />}
      {data && rows.length === 0 && <div className="k-card p-6"><EmptyState icon={MessageSquareText} title="Aucun avis" description="Les avis apparaissent après les premières livraisons notées." /></div>}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="k-card space-y-2 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-kraveo-ink">{firstName(r.customer)}</p><div className="flex items-center gap-2"><span className="text-sm font-bold text-kraveo-ink">{r.driverRating.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}/5</span>{r.flagged && <Pill tone="amber">En examen</Pill>}</div></div>
            {r.restaurantNotes ? <p className="text-sm text-kraveo-ink">« {r.restaurantNotes} »</p> : <p className="text-sm text-kraveo-ink3">Pas de commentaire sur le restaurant.</p>}
            <p className="text-xs text-kraveo-ink3">{dateOnly(r.createdAt)}</p>
          </li>
        ))}
      </ul>
      {data && <PaginationBar page={page} pageCount={Math.max(1, Math.ceil(data.total / 20))} pageSize={20} total={data.total} onPage={setPage} noun="avis" />}
    </div>
  );
};

// ───────────────────────── Payouts ─────────────────────────

const SETTLEMENT_LABEL: Record<string, string> = { PENDING: 'À venir', ON_HOLD: 'En attente', PAID: 'Versé', CANCELLED: 'Annulé' };

export const RestaurantPayoutsPage: React.FC<ScopeProps & { onAuthError: (e: unknown) => void }> = ({ onAuthError, ...scope }) => {
  const { data, loading, error, reload } = useLoad(() => (scope.vendorId ? apiService.fetchSettlements({ vendorId: scope.vendorId, pageSize: 50 }) : Promise.resolve(null)), onAuthError, [scope.vendorId]);
  return (
    <div className="space-y-5">
      <Header {...scope} icon={Wallet} title="Paiements" subtitle="Les règlements reçus et à venir." onRefresh={reload} refreshing={loading} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {data && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiTile index={0} label="À venir" icon={Wallet} value={inr(data.summary.PENDING.netPayable)} note={`${data.summary.PENDING.count} règlement${data.summary.PENDING.count > 1 ? 's' : ''}`} />
          <KpiTile index={1} label="En attente" icon={Wallet} tone="text-kraveo-status-placed" toneBg="bg-kraveo-status-placed/15" value={inr(data.summary.ON_HOLD.netPayable)} note={`${data.summary.ON_HOLD.count} règlement${data.summary.ON_HOLD.count > 1 ? 's' : ''}`} />
          <KpiTile index={2} label="Déjà versé" icon={Wallet} value={inr(data.summary.PAID.netPayable)} note={`${data.summary.PAID.count} règlement${data.summary.PAID.count > 1 ? 's' : ''}`} />
        </div>
      )}
      {loading && !data && <SkeletonCard lines={3} />}
      {data && data.items.length === 0 && <div className="k-card p-6"><EmptyState icon={Wallet} title="Aucun règlement" description="Un règlement est créé à partir des commandes livrées de la période." /></div>}
      {data && data.items.length > 0 && (
        <ul className="k-card divide-y divide-kraveo-line/60 overflow-hidden">
          {data.items.map((s) => (
            <li key={s.id} className="flex flex-col gap-1.5 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0"><span className="block font-bold text-kraveo-ink">{dateOnly(s.periodStart)} → {dateOnly(s.periodEnd)}</span><span className="block text-xs text-kraveo-ink3">{s.orderCount} commande{s.orderCount > 1 ? 's' : ''}{s.paidAt ? ` · versé le ${dateOnly(s.paidAt)}` : ''}{s.paymentReference ? ` · réf. ${s.paymentReference}` : ''}</span></span>
              <span className="flex shrink-0 items-center gap-3"><span className="k-num text-kraveo-ink">{inr(s.netPayable)}</span><Pill tone={s.status === 'PAID' ? 'green' : s.status === 'ON_HOLD' ? 'amber' : s.status === 'CANCELLED' ? 'red' : 'blue'}>{SETTLEMENT_LABEL[s.status] ?? s.status}</Pill></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ───────────────────────── Menu (read-only) ─────────────────────────

export const RestaurantMenuPage: React.FC<ScopeProps & { onAuthError: (e: unknown) => void }> = ({ onAuthError, ...scope }) => {
  const { data, loading, error, reload } = useLoad(() => (scope.vendorId ? apiService.fetchCatalog({ vendorId: scope.vendorId }) : Promise.resolve(null)), onAuthError, [scope.vendorId]);
  const items = data?.items ?? [];
  const byCategory = useMemo(() => {
    const groups = new Map<string, typeof items>();
    for (const d of items) groups.set(d.category || 'Autres', [...(groups.get(d.category || 'Autres') ?? []), d]);
    return Array.from(groups);
  }, [items]);
  return (
    <div className="space-y-5">
      <Header {...scope} icon={UtensilsCrossed} title="Menu & plats" subtitle="Vos plats, leurs prix et leur validation par Affia Foods." onRefresh={reload} refreshing={loading} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <SkeletonCard lines={4} />}
      {data && items.length === 0 && <div className="k-card p-6"><EmptyState icon={UtensilsCrossed} title="Aucun plat" description="Les plats ajoutés depuis l’application restaurant apparaissent ici." /></div>}
      {byCategory.map(([category, dishes]) => (
        <section key={category} className="space-y-2" aria-label={category}>
          <h2 className="k-label px-1">{category}</h2>
          <ul className="k-card divide-y divide-kraveo-line/60 overflow-hidden">
            {dishes.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="min-w-0"><span className="block truncate font-bold text-kraveo-ink">{d.name}</span><span className="block truncate text-xs text-kraveo-ink3">{d.isAvailable ? 'Disponible' : 'Indisponible'}{d.pendingVendorPrice !== null ? ` · nouveau prix demandé : ${inr(d.pendingVendorPrice)}` : ''}</span></span>
                <span className="flex shrink-0 items-center gap-3"><span className="k-num text-kraveo-ink">{d.vendorPrice === null ? '—' : inr(d.vendorPrice)}</span><Pill tone={d.state === 'LIVE' ? 'green' : d.state === 'REJECTED' || d.state === 'DELETED' ? 'red' : 'amber'}>{stateLabel(d.state)}</Pill></span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className="text-xs text-kraveo-ink3">Pour ajouter ou modifier un plat, utilisez l’application restaurant ; l’équipe Affia Foods valide chaque prix.</p>
    </div>
  );
};

// ───────────────────────── Promotions ─────────────────────────

export const RestaurantPromotionsPage: React.FC<ScopeProps & { onAuthError: (e: unknown) => void }> = ({ onAuthError, ...scope }) => {
  const { data, loading, error, reload } = useLoad(() => apiService.fetchPromotions(1, 100), onAuthError);
  const rows = (data?.data ?? []).filter((p) => p.isActive && (p.eligibleMerchants.length === 0 || p.eligibleMerchants.includes(scope.vendorId)));
  return (
    <div className="space-y-5">
      <Header {...scope} icon={BadgePercent} title="Promotions" subtitle="Les offres Affia Foods qui s’appliquent à vos clients." onRefresh={reload} refreshing={loading} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <SkeletonCard lines={3} />}
      {data && rows.length === 0 && <div className="k-card p-6"><EmptyState icon={BadgePercent} title="Aucune offre active" description="Aucune promotion ne concerne ce restaurant pour le moment." /></div>}
      <ul className="space-y-3">
        {rows.map((p) => (
          <li key={p.id} className="k-card space-y-1.5 p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-kraveo-ink">{p.name}</p><Pill tone={p.fundedBy === 'PLATFORM' ? 'green' : 'blue'}>{p.fundedBy === 'PLATFORM' ? 'Offerte par Affia Foods' : p.fundedBy === 'MERCHANT' ? 'Financée par vous' : `Partagée (${p.merchantSharePct} % pour vous)`}</Pill></div>
            <p className="text-sm text-kraveo-ink2">{promoValueLabel(p)}{p.minCartAmount ? ` · dès ${inr(p.minCartAmount)}` : ''}{p.code ? ` · code ${p.code}` : ' · automatique'}</p>
            {p.endsAt && <p className="text-xs text-kraveo-ink3">Jusqu’au {dateOnly(p.endsAt)} ({timeAgo(p.endsAt)})</p>}
          </li>
        ))}
      </ul>
    </div>
  );
};
