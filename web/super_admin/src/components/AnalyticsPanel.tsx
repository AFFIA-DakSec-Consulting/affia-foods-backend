import React, { useEffect, useMemo, useState } from 'react';
import { Award, Banknote, BarChart3, Clock, RefreshCw, TrendingUp, Users } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AnalyticsData } from '../types';
import { apiService } from '../services/api';
import { palette } from '../lib/tokens';
import { AnimatedNumber } from './ui/AnimatedNumber';
import { EmptyState } from './ui/EmptyState';
import { KpiTile } from './ui/KpiTile';
import { Skeleton } from './ui/Skeleton';

type Range = 'today' | '7d' | '30d';

const RANGE_LABEL: Record<Range, string> = { today: 'Aujourd’hui', '7d': '7 jours', '30d': '30 jours' };

const reducedMotion = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const AXIS = { fill: palette.ink3, fontSize: 11, fontFamily: 'Plus Jakarta Sans Variable, system-ui, sans-serif' };

const tooltipProps = {
  contentStyle: { background: palette.surface2, border: `1px solid ${palette.line}`, borderRadius: 16, fontSize: 12, color: palette.ink, boxShadow: '0 18px 40px rgba(0,0,0,0.42)' },
  labelStyle: { color: palette.ink2, fontWeight: 700, marginBottom: 2 },
  itemStyle: { color: palette.ink },
  cursor: { stroke: palette.line, fill: 'rgba(95,132,236,0.08)' },
} as const;

const ChartCard: React.FC<{ title: string; icon: React.ElementType; insight?: string; index: number; children: React.ReactNode }> = ({ title, icon: Icon, insight, index, children }) => (
  <section className="k-card k-reveal p-4 sm:p-5" style={{ ['--i' as string]: index }}>
    <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
      <h2 className="flex items-center gap-2 font-display text-base font-bold text-kraveo-ink"><Icon className="h-4 w-4 text-kraveo-g600" aria-hidden="true" />{title}</h2>
      {insight && <span className="rounded-full bg-kraveo-surface2 px-3 py-1 text-xs font-semibold text-kraveo-ink2">{insight}</span>}
    </div>
    {children}
  </section>
);

export const AnalyticsPanel: React.FC = () => {
  const [range, setRange] = useState<Range>('7d');
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const animate = !reducedMotion();

  const load = async (nextRange = range) => {
    setLoading(true); setError('');
    try { setData(await apiService.fetchAnalytics(nextRange)); }
    catch (err) { setError(err instanceof Error ? err.message : 'Les statistiques n’ont pas pu être chargées.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [range]);

  const peak = useMemo(() => {
    const hours = data?.hourlyOrders ?? [];
    return hours.reduce<{ hour: string; orders: number } | null>((best, item) => (item.orders > 0 && (!best || item.orders > best.orders) ? item : best), null);
  }, [data]);
  const topHostel = useMemo(() => {
    const hostels = data?.hostelOrders ?? [];
    return hostels.reduce<{ hostel: string; orders: number } | null>((best, item) => (!best || item.orders > best.orders ? item : best), null);
  }, [data]);

  const hasHourly = Boolean(data?.hourlyOrders.some((item) => item.orders > 0));
  const hostelData = data?.hostelOrders ?? [];
  const firstLoad = loading && !data;
  const noOrders = Boolean(data) && data!.orderCount === 0;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="px-1 text-sm text-kraveo-ink2">Calculé à partir des commandes enregistrées. Vide signifie aucune commande, jamais des données d’exemple.</p>
        <div className="flex items-center gap-2">
          <div className="flex gap-2" role="group" aria-label="Période">
            {(['today', '7d', '30d'] as Range[]).map((option) => (
              <button key={option} className="k-chip" aria-pressed={range === option} onClick={() => setRange(option)}>{RANGE_LABEL[option]}</button>
            ))}
          </div>
          <button aria-label="Actualiser les statistiques" title="Actualiser les statistiques" onClick={() => void load()} disabled={loading} className="k-icon-btn">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 px-4 py-3 text-sm text-kraveo-ink">
          <span>{error}</span>
          <button className="k-btn-ghost !min-h-[36px]" onClick={() => void load()}>Réessayer</button>
        </div>
      )}

      {!data && !loading && !error && (
        <div className="k-card"><EmptyState icon={BarChart3} title="Aucune statistique pour cette période" description="Les chiffres apparaissent dès qu’il y a des commandes sur la période choisie." /></div>
      )}

      {(data || firstLoad) && (
        <>
          <section aria-label="Chiffres clés" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <KpiTile index={0} loading={firstLoad} label="Volume brut" icon={Banknote} tone="text-kraveo-g600"
              value={<AnimatedNumber value={data ? data.grossOrderVolume : null} suffix={' FCFA'} />} note={data ? `${data.orderCount} commande${data.orderCount === 1 ? '' : 's'} sur la période` : undefined} />
            <KpiTile index={1} loading={firstLoad} label="Délai moyen de livraison" icon={Clock} tone="text-kraveo-status-pickedUp" toneBg="bg-kraveo-status-pickedUp/15"
              value={<AnimatedNumber value={data && data.averageDeliveryMinutes > 0 ? data.averageDeliveryMinutes : null} decimals={1} suffix={data && data.averageDeliveryMinutes > 0 ? ' min' : ''} />}
              note={data && data.averageDeliveryMinutes > 0 ? 'De la création à la dernière mise à jour enregistrée' : 'Aucune commande livrée pour l’instant'} />
            <KpiTile index={2} loading={firstLoad} label="Clients actifs" icon={Users} tone="text-kraveo-status-accepted" toneBg="bg-kraveo-status-accepted/15"
              value={<AnimatedNumber value={data ? data.activeStudents : null} />} note={data ? `${data.cancellationRate.toFixed(1).replace('.', ',')} % de taux d’annulation` : undefined} />
            <KpiTile index={3} loading={firstLoad} label="Meilleur restaurant" icon={Award} tone="text-kraveo-status-atGate" toneBg="bg-kraveo-status-atGate/15"
              value={<span className="block truncate text-2xl sm:text-[26px]">{data?.topVendor?.name || '-'}</span>}
              note={data?.topVendor ? `${data.topVendor.deliveredOrders} commande${data.topVendor.deliveredOrders === 1 ? '' : 's'} livrée${data.topVendor.deliveredOrders === 1 ? '' : 's'}` : 'En attente de commandes terminées'} />
          </section>

          <div className="grid grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-2">
            <ChartCard index={4} title="Commandes par heure" icon={TrendingUp} insight={peak ? `Pic ${peak.hour} · ${peak.orders} commande${peak.orders === 1 ? '' : 's'}` : undefined}>
              {firstLoad ? <Skeleton className="h-64 w-full" /> : hasHourly ? (
                <div className="h-64" role="img" aria-label={peak ? `Commandes par heure. L’heure la plus chargée est ${peak.hour} avec ${peak.orders} commandes.` : 'Commandes par heure'}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data!.hourlyOrders} margin={{ top: 12, right: 8, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="kraveoOrdersFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={palette.g400} stopOpacity={0.45} />
                          <stop offset="100%" stopColor={palette.g400} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={palette.line} strokeDasharray="3 5" vertical={false} />
                      <XAxis dataKey="hour" tick={AXIS} tickLine={false} axisLine={{ stroke: palette.line }} interval="preserveStartEnd" minTickGap={20} />
                      <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip {...tooltipProps} formatter={(value: number) => [value, 'Commandes']} />
                      <Area type="monotone" dataKey="orders" stroke={palette.g400} strokeWidth={2.5} fill="url(#kraveoOrdersFill)" isAnimationActive={animate} activeDot={{ r: 5, fill: palette.g400, stroke: palette.night, strokeWidth: 2 }} />
                      {peak && <ReferenceDot x={peak.hour} y={peak.orders} r={6} fill={palette.yellow} stroke={palette.night} strokeWidth={2} />}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : <EmptyState icon={BarChart3} title="Aucune commande sur cette période" description="Le graphique se remplit dès que des commandes sont passées." className="h-64" />}
            </ChartCard>

            <ChartCard index={5} title="Volume par point de livraison" icon={Users} insight={topHostel && topHostel.orders > 0 ? `En tête : ${topHostel.hostel} · ${topHostel.orders}` : undefined}>
              {firstLoad ? <Skeleton className="h-64 w-full" /> : hostelData.length ? (
                <div style={{ height: Math.max(256, hostelData.length * 40 + 24) }} role="img" aria-label="Commandes par point de livraison">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hostelData} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                      <CartesianGrid stroke={palette.line} strokeDasharray="3 5" horizontal={false} />
                      <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
                      <YAxis type="category" dataKey="hostel" tick={AXIS} tickLine={false} axisLine={false} width={96} interval={0} />
                      <Tooltip {...tooltipProps} formatter={(value: number) => [value, 'Commandes']} />
                      <Bar dataKey="orders" radius={[0, 8, 8, 0]} barSize={20} isAnimationActive={animate}>
                        {hostelData.map((entry) => <Cell key={entry.hostel} fill={topHostel && entry.hostel === topHostel.hostel && entry.orders > 0 ? '#93acf5' : palette.g400} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : <EmptyState icon={Users} title={noOrders ? 'Aucune commande sur cette période' : 'Aucune commande non annulée'} description="Les points de livraison apparaissent ici dès que des commandes arrivent." className="h-64" />}
            </ChartCard>
          </div>

          {data && <p className="text-right text-[11px] text-kraveo-ink3">Généré le {new Date(data.generatedAt).toLocaleString('fr-FR')}</p>}
        </>
      )}
    </div>
  );
};
