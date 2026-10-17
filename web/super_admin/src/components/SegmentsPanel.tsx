import React, { useMemo, useState } from 'react';
import { Megaphone, Users } from 'lucide-react';
import { apiService } from '../services/api';
import { CustomerRow } from '../types';
import { SEGMENT_IDS, SEGMENT_INFO, SegmentId, countSegments, segmentsOf } from '../lib/segments';
import { TabType } from '../lib/navigation';
import { inr, timeAgo } from '../lib/tokens';
import { EmptyState } from './ui/EmptyState';
import { PaginationBar, usePagination } from './ui/Pagination';
import { SkeletonCard } from './ui/Skeleton';
import { PageHeader } from './ui/PageToolbar';
import { ErrorBanner, Pill, useLoad } from './platform/common';

const MAX_PAGES = 10; // 300 customers: enough for a pilot city, and the screen says so when there are more

const loadCustomers = async (): Promise<{ rows: CustomerRow[]; total: number }> => {
  const rows: CustomerRow[] = [];
  let cursor: string | null = null;
  let total = 0;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const page = await apiService.fetchCustomers('', cursor, 30);
    total = page.total;
    rows.push(...page.data.filter((c) => !rows.some((r) => r.id === c.id)));
    cursor = page.nextCursor;
    if (!cursor) break;
  }
  return { rows, total };
};

export const SegmentsPanel: React.FC<{ onNavigate: (tab: TabType) => void; onAuthError: (e: unknown) => void }> = ({ onNavigate, onAuthError }) => {
  const { data, loading, error, reload } = useLoad(loadCustomers, onAuthError);
  const [active, setActive] = useState<SegmentId | 'ALL'>('ALL');
  const now = Date.now();
  const rows = data?.rows ?? [];
  const counts = useMemo(() => countSegments(rows, now), [rows, now]);
  const shown = useMemo(() => rows.filter((c) => c.deleted === false && (active === 'ALL' || segmentsOf(c, now).includes(active))), [rows, active, now]);
  const pager = usePagination(shown, active, 10);
  const partial = data !== null && data.total > rows.length;

  return (
    <div className="space-y-5">
      <PageHeader icon={Users} title="Segments clients" subtitle="Des groupes de clients calculés tout seuls, selon leurs habitudes." onRefresh={reload} refreshing={loading}
        actions={<button type="button" className="k-btn-accent" onClick={() => onNavigate('campaigns')}><Megaphone className="h-4 w-4" aria-hidden="true" />Créer une campagne</button>} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <SkeletonCard lines={3} />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" role="group" aria-label="Segments">
            {SEGMENT_IDS.map((id) => (
              <button key={id} type="button" aria-pressed={active === id} onClick={() => setActive(active === id ? 'ALL' : id)} title={SEGMENT_INFO[id].hint}
                className={`k-card p-4 text-left transition-colors ${active === id ? 'border-kraveo-g500 bg-kraveo-g500/10' : 'hover:bg-kraveo-surface2'}`}>
                <span className="k-label block">{SEGMENT_INFO[id].label}</span>
                <span className="k-num mt-1 block text-3xl text-kraveo-ink">{counts[id]}</span>
                <span className="mt-1 block text-[11px] text-kraveo-ink3">{SEGMENT_INFO[id].hint}</span>
              </button>
            ))}
          </div>
          {partial && <p className="text-xs text-kraveo-ink3">Calculé sur les {rows.length} premiers clients sur {data.total}.</p>}
          {shown.length === 0 && <div className="k-card p-6"><EmptyState icon={Users} title="Aucun client dans ce segment" description="Les segments se remplissent à mesure que vos clients commandent." /></div>}
          {shown.length > 0 && (
            <div className="k-card overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead><tr className="border-b border-kraveo-line text-left"><th className="k-label px-4 py-3">Client</th><th className="k-label px-4 py-3">Segments</th><th className="k-label px-4 py-3 text-right">Commandes</th><th className="k-label px-4 py-3 text-right">Total payé</th><th className="k-label px-4 py-3 text-right">Panier moyen</th><th className="k-label px-4 py-3 text-right">Dernière commande</th></tr></thead>
                <tbody>
                  {pager.pageItems.map((c) => (
                    <tr key={c.id} className="border-b border-kraveo-line/60 last:border-0">
                      <td className="px-4 py-3"><span className="block font-bold text-kraveo-ink">{c.name}</span><span className="text-xs text-kraveo-ink3">{c.phone ?? c.email ?? '—'}</span></td>
                      <td className="px-4 py-3"><span className="flex flex-wrap gap-1">{segmentsOf(c, now).map((id) => <Pill key={id} tone={id === 'AT_RISK' ? 'amber' : id === 'LOYAL' ? 'green' : 'grey'}>{SEGMENT_INFO[id].label}</Pill>)}</span></td>
                      <td className="px-4 py-3 text-right tabular-nums text-kraveo-ink2">{c.ordersCount}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-kraveo-ink2">{inr(c.totalSpent)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-kraveo-ink2">{c.ordersCount > 0 ? inr(Math.round(c.totalSpent / c.ordersCount)) : '—'}</td>
                      <td className="px-4 py-3 text-right text-kraveo-ink2">{c.lastOrderAt ? timeAgo(c.lastOrderAt) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <PaginationBar page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} total={pager.total} onPage={pager.setPage} noun="clients" />
        </>
      )}
    </div>
  );
};
