import React, { useState } from 'react';
import { Bike, LifeBuoy, ShoppingBag, Star, Store, UserPlus } from 'lucide-react';
import { apiService } from '../services/api';
import { Compare, StatsRange } from '../lib/platformParse';
import { KpiTile } from './ui/KpiTile';
import { ErrorBanner, useLoad } from './platform/common';

const RANGES: Array<[StatsRange, string]> = [['today', 'Aujourd’hui'], ['7d', '7 jours'], ['30d', '30 jours'], ['90d', '90 jours']];

/** "+12 % vs période précédente", or nothing when there is nothing to compare with. */
export const changeNote = (pct: number | null, current: number, previous: number): string => {
  if (pct !== null) return `${pct > 0 ? '+' : ''}${pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % vs période précédente`;
  return current > 0 && previous === 0 ? 'Rien sur la période précédente' : previous > 0 || current > 0 ? 'Stable' : '';
};
const compareNote = (c: Compare) => changeNote(c.changePct, c.current, c.previous);

/** The platform-wide numbers from one request: orders, sign-ups, partners, reviews and support, each against the previous period. */
export const OverviewStats: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const [range, setRange] = useState<StatsRange>('7d');
  const { data, loading, error, reload } = useLoad(() => apiService.fetchOverview(range), onAuthError, [range]);
  const first = loading && !data;
  const o = data?.orders;
  const cancelledBy = o ? Object.entries(o.cancelledBy).filter(([, n]) => n > 0).map(([k, n]) => `${({ CUSTOMER: 'client', VENDOR: 'restaurant', ADMIN: 'équipe', SYSTEM: 'système' } as Record<string, string>)[k] ?? k} ${n}`).join(' · ') : '';

  return (
    <section aria-label="Vue d’ensemble de la plateforme" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-base font-bold text-kraveo-ink">Vue d’ensemble</h2>
        <div className="flex gap-2" role="group" aria-label="Période de la vue d’ensemble">
          {RANGES.map(([id, label]) => <button key={id} type="button" className="k-chip" aria-pressed={range === id} onClick={() => setRange(id)}>{label}</button>)}
        </div>
      </div>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
        <KpiTile index={0} loading={first} label="Commandes" icon={ShoppingBag} value={o?.total ?? 0}
          note={o ? `${o.delivered} livrées · ${o.cancelled} annulées. ${changeNote(o.totalChangePct, o.total, o.previousTotal)}` : undefined} />
        <KpiTile index={1} loading={first} label="Refusées par les restaurants" icon={Store} tone="text-kraveo-danger" toneBg="bg-kraveo-danger/10" value={o?.rejectedByRestaurant ?? 0}
          note={cancelledBy ? `Annulations : ${cancelledBy}` : 'Aucune annulation'} />
        <KpiTile index={2} loading={first} label="Nouveaux clients" icon={UserPlus} value={data?.signups.clients.current ?? 0} note={data ? compareNote(data.signups.clients) : undefined} />
        <KpiTile index={3} loading={first} label="Restaurants" icon={Store} value={data ? `${data.restaurants.approved}/${data.restaurants.total}` : 0}
          note={data ? `${data.restaurants.active} ouverts · ${data.restaurants.pending} en attente · ${data.signups.restaurants.current} nouveau${data.signups.restaurants.current > 1 ? 'x' : ''}` : undefined} />
        <KpiTile index={4} loading={first} label="Livreurs" icon={Bike} value={data ? `${data.drivers.approved}/${data.drivers.total}` : 0}
          note={data ? `${data.drivers.active} en service · ${data.drivers.pending} en attente · ${data.signups.drivers.current} nouveau${data.signups.drivers.current > 1 ? 'x' : ''}` : undefined} />
        <KpiTile index={5} loading={first} label="Avis" icon={Star} value={data?.reviews.count ?? 0}
          note={data ? `Livreurs ${data.reviews.averageDriverRating?.toLocaleString('fr-FR', { maximumFractionDigits: 1 }) ?? '—'}/5 · ${data.reviews.lowRated} notes basses · ${data.reviews.flaggedOpen} signalés` : undefined} />
      </div>
      {data && (
        <div className="k-card flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3 text-sm text-kraveo-ink2">
          <LifeBuoy className="h-4 w-4 text-kraveo-g600" aria-hidden="true" />
          <span><b className="text-kraveo-ink">{data.support.open}</b> réclamations ouvertes</span>
          <span><b className="text-kraveo-ink">{data.support.inProgress}</b> en cours</span>
          <span>1re réponse : {data.support.avgFirstResponseMinutes === null ? '—' : `${Math.round(data.support.avgFirstResponseMinutes)} min`}</span>
          <span>Résolution : {data.support.avgResolutionHours === null ? '—' : `${data.support.avgResolutionHours.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`}</span>
        </div>
      )}
    </section>
  );
};
