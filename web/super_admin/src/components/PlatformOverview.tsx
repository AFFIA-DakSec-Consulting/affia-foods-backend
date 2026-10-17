import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Bike, Building2, CircleDollarSign, ClipboardCheck, Hourglass, LifeBuoy, MapPinOff, PackageCheck, RefreshCw, ShoppingBag, Store, TriangleAlert, UserPlus, Users, Wallet } from 'lucide-react';
import { ApiError, apiService } from '../services/api';
import type { AnalyticsData, DriverPartner, Vendor } from '../types';
import type { FinanceSummary } from '../lib/financeParse';
import { presetRange } from '../lib/financeParse';
import type { TabType } from '../lib/navigation';
import { activeClientsOf, oldestWaitDays, partnerFigures, restaurantFigures, riderFigures, share, total } from '../lib/platformStats';
import { inr } from '../lib/tokens';
import { AnimatedNumber } from './ui/AnimatedNumber';
import { Skeleton } from './ui/Skeleton';

type Period = 'today' | '7d' | '30d';
const PERIODS: Array<[Period, string]> = [['today', 'Aujourd’hui'], ['7d', '7 jours'], ['30d', '30 jours']];

interface Props {
  /** Complete lists the dashboard already keeps fresh (every restaurant, every rider). */
  vendors: Vendor[];
  driverPartners: DriverPartner[];
  /** Counters kept by the dashboard. */
  dishesToApprove: number;
  settlementsToPay: number;
  alerts: number;
  /** Bumped when a new application arrives, so the figures reload. */
  refreshKey?: number;
  onNavigate: (tab: TabType) => void;
}

/** One block of server data: loads, keeps its own error (a failing endpoint never shows a made-up zero), reloads on demand. */
function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: '', loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: '' }));
    load()
      .then((data) => { if (mine === seq.current) setState({ data, error: '', loading: false }); })
      .catch((e) => { if (mine === seq.current) setState((s) => ({ data: s.data, error: e instanceof ApiError || e instanceof Error ? e.message : 'Chargement impossible.', loading: false })); });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

const Card: React.FC<{ title: string; hint?: string; icon: React.ElementType; action?: React.ReactNode; className?: string; children: React.ReactNode }> = ({ title, hint, icon: Icon, action, className = '', children }) => (
  <section className={`k-card p-5 sm:p-6 ${className}`} aria-label={title}>
    <header className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-k-sm bg-kraveo-g500/10 text-kraveo-g600"><Icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
        <div className="min-w-0"><h2 className="font-display text-base font-bold leading-tight text-kraveo-ink">{title}</h2>{hint && <p className="truncate text-xs text-kraveo-ink3">{hint}</p>}</div>
      </div>
      {action}
    </header>
    {children}
  </section>
);

const Unavailable: React.FC<{ message: string; onRetry: () => void }> = ({ message, onRetry }) => (
  <div role="alert" className="flex items-center justify-between gap-3 rounded-k-md bg-kraveo-danger/10 px-3.5 py-3 text-sm text-kraveo-ink">
    <span className="flex min-w-0 items-center gap-2"><TriangleAlert className="h-4 w-4 shrink-0 text-kraveo-danger" aria-hidden="true" /><span className="truncate">{message}</span></span>
    <button type="button" onClick={onRetry} className="k-btn-ghost !min-h-[32px] shrink-0 !px-3 text-xs">Réessayer</button>
  </div>
);

/** A number with its label; a button when it leads somewhere. */
const Stat: React.FC<{ label: string; value: number | string | null; tone?: string; note?: string; onClick?: () => void; loading?: boolean }> = ({ label, value, tone = 'text-kraveo-ink', note, onClick, loading }) => {
  const body = (
    <>
      <span className="block text-xs font-semibold text-kraveo-ink3">{label}</span>
      {loading ? <Skeleton className="mt-1.5 h-8 w-16" /> : <span className={`k-num mt-0.5 block text-2xl ${tone}`}>{typeof value === 'number' ? <AnimatedNumber value={value} /> : value ?? '—'}</span>}
      {note && !loading && <span className="block text-[11px] text-kraveo-ink3">{note}</span>}
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} className="rounded-k-md p-2 text-left transition-colors hover:bg-kraveo-surface2">{body}</button>
    : <div className="p-2">{body}</div>;
};

const BAR: Array<['PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED', string, string, string]> = [
  ['PENDING', 'En attente', 'bg-kraveo-status-placed', 'text-kraveo-status-placed'],
  ['APPROVED', 'Approuvés', 'bg-kraveo-status-delivered', 'text-kraveo-status-delivered'],
  ['REJECTED', 'Refusés', 'bg-kraveo-danger', 'text-kraveo-danger'],
  ['SUSPENDED', 'Suspendus', 'bg-kraveo-ink3', 'text-kraveo-ink2'],
];

export const PlatformOverview: React.FC<Props> = ({ vendors, driverPartners, dishesToApprove, settlementsToPay, alerts, refreshKey = 0, onNavigate }) => {
  const [period, setPeriod] = useState<Period>('7d');
  const now = Date.now();

  const partners = partnerFigures(vendors, driverPartners);
  const restaurants = restaurantFigures(vendors);
  const riders = riderFigures(driverPartners);

  const waiting = useLoad(() => apiService.fetchApplications('PENDING'), [refreshKey, partners.all.PENDING]);
  const clients = useLoad(() => apiService.fetchCustomers('', null, 1), [refreshKey]);
  const orders = useLoad<AnalyticsData>(() => apiService.fetchAnalytics(period), [period, refreshKey]);
  const money = useLoad<FinanceSummary>(() => apiService.fetchFinanceSummary(presetRange(period)), [period, refreshKey]);
  const refreshAll = () => { waiting.reload(); clients.reload(); orders.reload(); money.reload(); };
  const busy = waiting.loading || clients.loading || orders.loading || money.loading;

  const waitDays = waiting.data ? oldestWaitDays(waiting.data.data, waiting.data.counts.PENDING, now) : null;
  const periodLabel = period === 'today' ? 'aujourd’hui' : period === '7d' ? 'sur 7 jours' : 'sur 30 jours';
  const a = orders.data;
  const f = money.data;

  const todo: Array<{ key: string; count: number; label: string; tab: TabType; icon: React.ElementType; tone: string }> = [
    { key: 'apps', count: partners.all.PENDING, label: 'inscription(s) à valider', tab: 'applications', icon: ClipboardCheck, tone: 'bg-kraveo-status-placed/15 text-kraveo-status-placed' },
    { key: 'dishes', count: dishesToApprove, label: 'plat(s) à approuver', tab: 'catalog', icon: PackageCheck, tone: 'bg-kraveo-g500/10 text-kraveo-g600' },
    { key: 'settle', count: settlementsToPay, label: 'règlement(s) à payer', tab: 'finance', icon: Wallet, tone: 'bg-kraveo-status-delivered/15 text-kraveo-status-delivered' },
    { key: 'alerts', count: alerts, label: 'alerte(s) commandes ou paiements', tab: 'attention', icon: TriangleAlert, tone: 'bg-kraveo-danger/10 text-kraveo-danger' },
    { key: 'pin', count: restaurants.withoutPin, label: 'restaurant(s) sans position', tab: 'vendors', icon: MapPinOff, tone: 'bg-kraveo-surface2 text-kraveo-ink2' },
  ];
  const open = todo.filter((t) => t.count > 0);

  return (
    <section className="space-y-4 sm:space-y-6" aria-label="Vue d’ensemble de la plateforme">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-extrabold tracking-tight text-kraveo-ink sm:text-2xl">Vue d’ensemble</h2>
          <p className="text-sm text-kraveo-ink3">Toute la plateforme, calculée par le serveur sur l’ensemble des données.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5" role="group" aria-label="Période">
            {PERIODS.map(([id, label]) => <button key={id} type="button" className="k-chip" aria-pressed={period === id} onClick={() => setPeriod(id)}>{label}</button>)}
          </div>
          <button type="button" onClick={refreshAll} disabled={busy} className="k-icon-btn" aria-label="Actualiser la vue d’ensemble" title="Actualiser"><RefreshCw className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} aria-hidden="true" /></button>
        </div>
      </div>

      {/* Registrations */}
      <Card title="Inscriptions" hint="Restaurants et livreurs, par décision" icon={UserPlus}
        action={<button type="button" onClick={() => onNavigate('applications')} className="k-btn-ghost !min-h-[34px] !px-3 text-xs">Ouvrir <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>}>
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div><p className="text-xs font-semibold text-kraveo-ink3">Inscrits au total</p><p className="k-num text-4xl text-kraveo-ink"><AnimatedNumber value={partners.registered} /></p></div>
          <div className="min-w-[220px] flex-1">
            <div className="flex h-3 overflow-hidden rounded-full bg-kraveo-line" role="img" aria-label={BAR.map(([k, l]) => `${l} : ${partners.all[k]}`).join(', ')}>
              {BAR.map(([k, , bg]) => partners.all[k] > 0 && <span key={k} className={bg} style={{ width: `${share(partners.all[k], partners.registered)}%` }} />)}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {BAR.map(([k, label, bg, text]) => <span key={k} className="inline-flex items-center gap-1.5 text-kraveo-ink2"><span className={`h-2 w-2 rounded-full ${bg}`} aria-hidden="true" /><span className={`font-bold tabular-nums ${text}`}>{partners.all[k]}</span> {label.toLowerCase()}</span>)}
            </div>
          </div>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead><tr className="text-left text-xs text-kraveo-ink3"><th className="py-1.5 pr-3 font-semibold">&nbsp;</th>{BAR.map(([k, label]) => <th key={k} className="px-2 py-1.5 text-right font-semibold">{label}</th>)}<th className="px-2 py-1.5 text-right font-semibold">Total</th></tr></thead>
            <tbody>
              {([['Restaurants', Store, partners.restaurants], ['Livreurs', Bike, partners.riders]] as const).map(([label, Icon, counts]) => (
                <tr key={label} className="border-t border-kraveo-line">
                  <th scope="row" className="py-2.5 pr-3 text-left font-semibold text-kraveo-ink"><span className="inline-flex items-center gap-2"><Icon className="h-4 w-4 text-kraveo-ink3" aria-hidden="true" />{label}</span></th>
                  {BAR.map(([k, , , text]) => <td key={k} className={`px-2 py-2.5 text-right tabular-nums ${counts[k] > 0 && k !== 'APPROVED' ? `font-bold ${text}` : 'text-kraveo-ink2'}`}>{counts[k]}</td>)}
                  <td className="px-2 py-2.5 text-right font-bold tabular-nums text-kraveo-ink">{total(counts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {waiting.error
          ? <div className="mt-3"><Unavailable message={`Ancienneté des dossiers indisponible : ${waiting.error}`} onRetry={waiting.reload} /></div>
          : waitDays !== null && <p className="mt-3 text-xs text-kraveo-ink3">Le plus ancien dossier attend depuis <b className="text-kraveo-ink">{waitDays === 0 ? 'moins d’un jour' : `${waitDays} jour${waitDays > 1 ? 's' : ''}`}</b>.</p>}
      </Card>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <Card title="Restaurants" hint="Restaurants approuvés" icon={Building2}>
          <div className="grid grid-cols-2 gap-1">
            <Stat label="Ouverts maintenant" value={restaurants.open} tone="text-kraveo-status-delivered" note={`sur ${restaurants.approved}`} onClick={() => onNavigate('vendors')} />
            <Stat label="Fermés" value={restaurants.closed} />
            <Stat label="Fiche à compléter" value={restaurants.incompleteSheet} tone={restaurants.incompleteSheet ? 'text-kraveo-status-placed' : undefined} note="logo, horaires, position…" onClick={() => onNavigate('vendors')} />
            <Stat label="Sans position" value={restaurants.withoutPin} tone={restaurants.withoutPin ? 'text-kraveo-danger' : undefined} note="les livreurs ne les trouvent pas" onClick={() => onNavigate('vendors')} />
          </div>
        </Card>
        <Card title="Livreurs" hint="Livreurs approuvés" icon={Bike}>
          <div className="grid grid-cols-2 gap-1">
            <Stat label="En ligne" value={riders.online} tone="text-kraveo-status-delivered" note={`sur ${riders.approved}`} onClick={() => onNavigate('drivers')} />
            <Stat label="En course" value={riders.inTransit} onClick={() => onNavigate('drivers')} />
            <Stat label="Hors ligne" value={riders.offline} />
            <Stat label="En attente de validation" value={partners.riders.PENDING} tone={partners.riders.PENDING ? 'text-kraveo-status-placed' : undefined} onClick={() => onNavigate('applications')} />
          </div>
        </Card>
        <Card title="Clients" hint="Comptes clients" icon={Users}>
          {clients.error ? <Unavailable message={clients.error} onRetry={clients.reload} /> : (
            <div className="grid grid-cols-2 gap-1">
              <Stat label="Clients inscrits" value={clients.data ? clients.data.total : null} loading={clients.loading && !clients.data} onClick={() => onNavigate('customers')} />
              <Stat label={`Actifs ${periodLabel}`} value={a ? activeClientsOf(a) : null} loading={orders.loading && !a} note="ont commandé" />
            </div>
          )}
          {orders.error && !clients.error && <p className="mt-2 text-xs text-kraveo-danger">Clients actifs indisponible.</p>}
        </Card>
      </div>

      {/* Orders and money of the period */}
      <Card title={`Commandes ${periodLabel}`} hint="Toutes les commandes passées, pas seulement les plus récentes" icon={ShoppingBag}>
        {orders.error && !a ? <Unavailable message={orders.error} onRetry={orders.reload} /> : (
          <div className="grid grid-cols-2 gap-1 lg:grid-cols-4">
            <Stat label="Commandes" value={a ? a.orderCount : null} loading={orders.loading && !a} onClick={() => onNavigate('orders')} />
            <Stat label="Ventes encaissées" value={a ? inr(a.grossOrderVolume) : null} loading={orders.loading && !a} note="commandes payées" />
            <Stat label="Annulations" value={a ? `${a.cancellationRate} %` : null} loading={orders.loading && !a} tone={a && a.cancellationRate >= 15 ? 'text-kraveo-danger' : undefined} />
            <Stat label="Délai moyen" value={a ? (a.averageDeliveryMinutes ? `${a.averageDeliveryMinutes} min` : '—') : null} loading={orders.loading && !a} note="de la commande à la porte" />
          </div>
        )}
      </Card>

      <Card title={`Argent ${periodLabel}`} hint="Commandes livrées, d’après les règles de la finance" icon={CircleDollarSign}
        action={<button type="button" onClick={() => onNavigate('finance')} className="k-btn-ghost !min-h-[34px] !px-3 text-xs">Détail <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" /></button>}>
        {money.error && !f ? <Unavailable message={money.error} onRetry={money.reload} /> : (
          <div className="grid grid-cols-2 gap-1 lg:grid-cols-4">
            <Stat label="Revenu Affia Foods" value={f ? inr(f.platformRevenue) : null} loading={money.loading && !f} tone="text-kraveo-g700" note="commission + frais" />
            <Stat label="Commissions" value={f ? inr(f.commission) : null} loading={money.loading && !f} />
            <Stat label="À reverser aux restaurants" value={f ? inr(f.unsettledAmount) : null} loading={money.loading && !f} note="pas encore réglé" onClick={() => onNavigate('finance')} />
            <Stat label="Remboursements" value={f ? inr(f.refunds.amount) : null} loading={money.loading && !f} note={f ? `${f.refunds.count} commande${f.refunds.count > 1 ? 's' : ''}` : undefined} />
          </div>
        )}
      </Card>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-5">
        <Card title="À traiter par l’équipe" hint="Ce qui attend une décision" icon={ClipboardCheck} className="lg:col-span-3">
          {open.length === 0 ? (
            <p className="rounded-k-md bg-kraveo-status-delivered/10 px-4 py-6 text-center text-sm font-semibold text-kraveo-ink">Rien n’attend de décision.</p>
          ) : (
            <ul className="space-y-2">
              {open.map((t) => (
                <li key={t.key}>
                  <button type="button" onClick={() => onNavigate(t.tab)} className="group flex w-full items-center gap-3 rounded-k-lg border border-kraveo-line p-3 text-left transition-colors hover:bg-kraveo-surface2">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-k-md ${t.tone}`}><t.icon className="h-[18px] w-[18px]" aria-hidden="true" /></span>
                    <span className="min-w-0 flex-1 text-sm font-bold text-kraveo-ink"><span className="k-num mr-1.5 text-lg">{t.count}</span>{t.label}</span>
                    <ArrowRight className="h-4 w-4 shrink-0 text-kraveo-ink3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Support et avis" hint="Réclamations en cours, avis clients" icon={LifeBuoy} className="lg:col-span-2">
          <div className="rounded-k-md border border-dashed border-kraveo-line bg-kraveo-night/60 p-4 text-sm text-kraveo-ink2">
            <p className="flex items-center gap-2 font-semibold text-kraveo-ink"><Hourglass className="h-4 w-4 text-kraveo-ink3" aria-hidden="true" />Pas encore connecté</p>
            <p className="mt-1.5 text-xs">Le serveur ne fournit pas encore le nombre de réclamations ouvertes, en cours ou résolues, ni les notes moyennes. Dès que ces chiffres existent côté API, ils s’affichent ici.</p>
          </div>
        </Card>
      </div>
    </section>
  );
};

/** Delivered orders per day for the last 7 days, from the server (every order, not the loaded page). */
export const DeliveredByDay: React.FC<{ refreshKey?: number }> = ({ refreshKey = 0 }) => {
  const days = useLoad(() => apiService.fetchFinanceByDay(presetRange('7d')), [refreshKey]);
  const rows = days.data?.rows ?? [];
  const max = Math.max(1, ...rows.map((r) => r.orders));
  return (
    <div className="k-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h2 className="font-display text-base font-bold text-kraveo-ink">Commandes livrées, 7 derniers jours</h2><p className="text-xs text-kraveo-ink3">Toutes les livraisons terminées, jour par jour</p></div>
        <span className="rounded-full bg-kraveo-surface2 px-3 py-1 text-xs font-bold tabular-nums text-kraveo-ink2">{rows.reduce((sum, r) => sum + r.orders, 0)} au total</span>
      </div>
      {days.error && !rows.length ? <div className="mt-4"><Unavailable message={days.error} onRetry={days.reload} /></div> : (
        <div className="mt-6 flex h-44 items-end gap-2 sm:gap-4" role="img" aria-label="Commandes livrées par jour sur les 7 derniers jours">
          {days.loading && !rows.length ? Array.from({ length: 7 }, (_, i) => <Skeleton key={i} className="h-24 flex-1" />) : rows.map((r, i) => {
            const today = i === rows.length - 1;
            return (
              <div key={r.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                <span className="text-xs font-bold tabular-nums text-kraveo-ink2">{r.orders}</span>
                <div className={`w-full max-w-[44px] rounded-t-k-sm ${today ? 'bg-kraveo-yellow' : 'bg-kraveo-g500/80'}`} style={{ height: `${Math.max(4, (r.orders / max) * 100)}%` }} />
                <span className={`text-[11px] capitalize ${today ? 'font-bold text-kraveo-ink' : 'text-kraveo-ink3'}`}>{today ? 'Auj.' : new Date(`${r.date}T00:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '')}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
