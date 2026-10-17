import React, { useState } from 'react';
import { History } from 'lucide-react';
import { apiService } from '../services/api';
import { AuditEntry, TeamAuditEntry } from '../lib/platformParse';
import { EmptyState } from './ui/EmptyState';
import { PaginationBar } from './ui/Pagination';
import { SkeletonCard } from './ui/Skeleton';
import { PageHeader, UnderlineTabs } from './ui/PageToolbar';
import { ErrorBanner, dateTime, useLoad } from './platform/common';

const ACTION_LABEL: Record<string, string> = {
  ENABLE: 'Module activé', DISABLE: 'Module désactivé', UPDATE_SETTING: 'Réglage modifié', UPDATE_ZONE: 'Zones modifiées',
  CREATE_PROMOTION: 'Promotion créée', UPDATE_PROMOTION: 'Promotion modifiée', DELETE_PROMOTION: 'Promotion supprimée',
  CREATE_PLAN: 'Plan créé', UPDATE_PLAN: 'Plan modifié', DELETE_PLAN: 'Plan supprimé',
  CREATE_CAMPAIGN: 'Campagne créée', UPDATE_CAMPAIGN: 'Campagne modifiée', DELETE_CAMPAIGN: 'Campagne supprimée', SEND_CAMPAIGN: 'Campagne envoyée',
  CREATE_BONUS: 'Prime créée', UPDATE_BONUS: 'Prime modifiée', DELETE_BONUS: 'Prime supprimée',
  CREATE_LOYALTY_RULE: 'Règle de fidélité créée', UPDATE_LOYALTY_RULE: 'Règle de fidélité modifiée', DELETE_LOYALTY_RULE: 'Règle de fidélité supprimée',
};
export const actionLabel = (action: string): string => ACTION_LABEL[action] ?? action.toLowerCase().replace(/_/g, ' ');

/** A stored value as one short line (the log keeps whatever the server wrote). */
export const shortValue = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
};

const TeamLog: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const { data, loading, error, reload } = useLoad(() => apiService.fetchTeamAudit(100), onAuthError);
  const rows = data ?? [];
  return (
    <div className="space-y-4">
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <SkeletonCard lines={5} />}
      {data && rows.length === 0 && <div className="k-card p-6"><EmptyState icon={History} title="Journal vide" description="Les décisions de l’équipe apparaîtront ici." /></div>}
      {rows.length > 0 && (
        <ul className="k-card divide-y divide-kraveo-line/60 overflow-hidden">
          {rows.map((e: TeamAuditEntry) => (
            <li key={e.id} className="space-y-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2"><p className="font-bold text-kraveo-ink">{e.action.toLowerCase().replace(/_/g, ' ')}</p><p className="text-xs text-kraveo-ink3">{dateTime(e.createdAt)}</p></div>
              <p className="break-words text-kraveo-ink2">{e.summary}</p>
              <p className="text-xs text-kraveo-ink3">{e.targetType.toLowerCase()} {e.targetId.slice(0, 8)}</p>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="k-btn-ghost" onClick={reload} disabled={loading}>Actualiser</button>
    </div>
  );
};

export const AuditPanel: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const [tab, setTab] = useState<'platform' | 'team'>('platform');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useLoad(() => apiService.fetchModuleAudit(page, 25), onAuthError, [page]);
  const rows = data?.data ?? [];
  return (
    <div className="space-y-5">
      <PageHeader icon={History} title="Journal d’activité" subtitle="Qui a changé quoi sur les modules, les prix et le marketing." onRefresh={reload} refreshing={loading} />
      <UnderlineTabs label="Type de journal" value={tab} onChange={setTab} tabs={[{ id: 'platform', label: 'Modules et prix' }, { id: 'team', label: 'Décisions de l’équipe' }]} />
      {tab === 'team' && <TeamLog onAuthError={onAuthError} />}
      {tab === 'platform' && error && <ErrorBanner message={error} onRetry={reload} />}
      {tab === 'platform' && loading && !data && <SkeletonCard lines={5} />}
      {tab === 'platform' && data && rows.length === 0 && <div className="k-card p-6"><EmptyState icon={History} title="Journal vide" description="Les modifications apparaîtront ici dès la première." /></div>}
      {tab === 'platform' && rows.length > 0 && (
        <ul className="k-card divide-y divide-kraveo-line/60 overflow-hidden">
          {rows.map((e: AuditEntry) => (
            <li key={e.id} className="space-y-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-bold text-kraveo-ink">{actionLabel(e.action)}{e.settingKey ? ` · ${e.settingKey}` : ''}</p>
                <p className="text-xs text-kraveo-ink3">{dateTime(e.changedAt)}</p>
              </div>
              <p className="text-xs text-kraveo-ink3">{e.moduleCode ?? 'plateforme'}{e.changedBy ? ` · par ${e.changedBy.slice(0, 8)}` : ''}</p>
              {(e.oldValue !== null || e.newValue !== null) && <p className="break-words font-mono text-[11px] text-kraveo-ink2">{shortValue(e.oldValue)} → {shortValue(e.newValue)}</p>}
            </li>
          ))}
        </ul>
      )}
      {tab === 'platform' && data && <PaginationBar page={page} pageCount={Math.max(1, Math.ceil(data.total / 25))} pageSize={25} total={data.total} onPage={setPage} noun="entrées" />}
    </div>
  );
};
