import React, { useEffect, useState } from 'react';
import { Gift, Percent, Trophy, UserCheck, UserPlus, XCircle } from 'lucide-react';
import { apiService } from '../services/api';
import { Referral, ReferralStatus } from '../lib/platformParse';
import { TabType } from '../lib/navigation';
import { EmptyState } from './ui/EmptyState';
import { KpiTile } from './ui/KpiTile';
import { PaginationBar } from './ui/Pagination';
import { SkeletonCard } from './ui/Skeleton';
import { Switch } from './ui/Switch';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmDialog';
import { PageHeader, UnderlineTabs } from './ui/PageToolbar';
import { ErrorBanner, Pill, Tone, dateOnly, errorText, useLoad } from './platform/common';
import { SettingRow } from './ModulesPanel';

const STATUS: Record<ReferralStatus, { label: string; tone: Tone }> = { PENDING: { label: 'En attente', tone: 'amber' }, REWARDED: { label: 'Récompensé', tone: 'green' }, CANCELLED: { label: 'Annulé', tone: 'red' } };
const MODULE = 'marketing.referral';

/** Sponsorship: who invited whom, the reward amounts (module settings) and the on/off switch of the module. */
export const ReferralPanel: React.FC<{ onNavigate: (tab: TabType) => void; onAuthError: (e: unknown) => void }> = ({ onNavigate, onAuthError }) => {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [filter, setFilter] = useState<'' | ReferralStatus>('');
  const [page, setPage] = useState(1);
  const [switching, setSwitching] = useState(false);
  useEffect(() => { setPage(1); }, [filter]);

  const mod = useLoad(() => apiService.fetchModules().then((all) => all.find((m) => m.code === MODULE) ?? null), onAuthError);
  const settings = useLoad(() => apiService.fetchModuleSettings(MODULE), onAuthError);
  const stats = useLoad(() => apiService.fetchReferralStats(), onAuthError);
  const list = useLoad(() => apiService.fetchReferrals(filter, page, 25), onAuthError, [filter, page]);
  const s = stats.data;
  const rows = list.data?.data ?? [];
  const reloadAll = () => { mod.reload(); settings.reload(); stats.reload(); list.reload(); };

  const toggle = async () => {
    const m = mod.data;
    if (!m) return;
    if (m.isEnabled && !(await confirm({ title: 'Désactiver le parrainage ?', message: 'Les nouveaux parrainages ne seront plus récompensés. L’historique est conservé.', confirmLabel: 'Désactiver', danger: true }))) return;
    setSwitching(true);
    try { await apiService.toggleModule(MODULE, !m.isEnabled); toast.success(m.isEnabled ? 'Parrainage désactivé' : 'Parrainage activé'); mod.reload(); } catch (e) { onAuthError(e); toast.error('Changement refusé', errorText(e)); } finally { setSwitching(false); }
  };

  const cancel = async (r: Referral) => {
    if (!(await confirm({ title: 'Annuler ce parrainage ?', message: `${r.referee?.name ?? 'Le filleul'} ne sera plus compté pour ${r.referrer?.name ?? 'son parrain'}. À réserver aux cas suspects.`, confirmLabel: 'Annuler le parrainage', danger: true }))) return;
    try { await apiService.cancelReferral(r.id); toast.success('Parrainage annulé'); reloadAll(); } catch (e) { onAuthError(e); toast.error('Action refusée', errorText(e)); }
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={Gift} title="Parrainage" subtitle="Les clients qui en invitent d’autres, et ce que cela rapporte." onRefresh={reloadAll} refreshing={list.loading}
        actions={mod.data && !mod.data.isCore ? (<div className="flex items-center gap-2 text-sm font-semibold text-kraveo-ink2"><span>{mod.data.isEnabled ? 'Activé' : 'Désactivé'}</span><Switch checked={mod.data.isEnabled} onChange={toggle} label={mod.data.isEnabled ? 'Désactiver le parrainage' : 'Activer le parrainage'} disabled={switching} /></div>) : undefined} />
      {mod.data && !mod.data.effective && <p className="rounded-k-sm bg-kraveo-status-placed/15 px-4 py-3 text-sm font-semibold text-kraveo-status-placed">Le parrainage est {mod.data.isEnabled ? 'en attente d’un module parent' : 'désactivé'} : aucun nouveau parrainage n’est pris en compte pour l’instant.</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile index={0} loading={stats.loading && !s} label="Parrainages" icon={UserPlus} value={s?.total ?? 0} />
        <KpiTile index={1} loading={stats.loading && !s} label="En attente" icon={UserCheck} tone="text-kraveo-status-placed" toneBg="bg-kraveo-status-placed/15" value={s?.pending ?? 0} note="Le filleul n’a pas encore commandé" />
        <KpiTile index={2} loading={stats.loading && !s} label="Récompensés" icon={Trophy} value={s?.rewarded ?? 0} />
        <KpiTile index={3} loading={stats.loading && !s} label="Taux de conversion" icon={Percent} value={`${(s?.conversionRate ?? 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`} note={`${s?.cancelled ?? 0} annulé${(s?.cancelled ?? 0) > 1 ? 's' : ''}`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="k-card space-y-3 p-4 sm:p-5" aria-label="Récompenses">
          <div className="flex items-center justify-between gap-2"><h2 className="font-display text-base font-bold text-kraveo-ink">Récompenses</h2><button type="button" className="text-xs font-bold text-kraveo-g600 hover:underline" onClick={() => onNavigate('loyalty')}>Règles de fidélité</button></div>
          {settings.error && <ErrorBanner message={settings.error} onRetry={settings.reload} />}
          {settings.loading && !settings.data && <SkeletonCard lines={2} />}
          {settings.data?.map((st) => <SettingRow key={st.key} moduleCode={MODULE} setting={st} onAuthError={onAuthError} onSaved={(next) => settings.setData((cur) => cur && cur.map((x) => (x.key === next.key ? next : x)))} />)}
          <p className="text-xs text-kraveo-ink3">Les récompenses sont des pièces Affia Foods. Les montants s’appliquent aux prochains parrainages.</p>
        </section>
        <section className="k-card p-4 sm:p-5" aria-label="Meilleurs parrains">
          <h2 className="mb-3 font-display text-base font-bold text-kraveo-ink">Meilleurs parrains</h2>
          {s && s.topReferrers.length === 0 && <EmptyState icon={Trophy} title="Pas encore de parrain" description="Le classement apparaît dès les premiers parrainages." />}
          <ol className="space-y-2">
            {s?.topReferrers.map((t, i) => (
              <li key={t.id} className="k-inset flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="flex min-w-0 items-center gap-3"><span className="k-num w-5 text-kraveo-ink3">{i + 1}</span><span className="truncate font-bold text-kraveo-ink">{t.name}</span></span>
                <span className="shrink-0 text-xs text-kraveo-ink2">{t.referrals} invité{t.referrals > 1 ? 's' : ''} · {t.rewarded} récompensé{t.rewarded > 1 ? 's' : ''}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <UnderlineTabs label="Statut des parrainages" value={filter} onChange={setFilter}
        tabs={[{ id: '', label: 'Tous', count: s?.total }, { id: 'PENDING', label: 'En attente', count: s?.pending }, { id: 'REWARDED', label: 'Récompensés', count: s?.rewarded }, { id: 'CANCELLED', label: 'Annulés', count: s?.cancelled }]} />
      {list.error && <ErrorBanner message={list.error} onRetry={list.reload} />}
      {list.loading && !list.data && <SkeletonCard lines={4} />}
      {list.data && rows.length === 0 && <div className="k-card p-6"><EmptyState icon={Gift} title="Aucun parrainage" description="Aucun parrainage ne correspond à ce filtre." /></div>}
      {rows.length > 0 && (
        <ul className="k-card divide-y divide-kraveo-line/60 overflow-hidden">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <span className="min-w-0">
                <span className="block truncate font-bold text-kraveo-ink">{r.referrer?.name ?? 'Parrain inconnu'} <span className="font-normal text-kraveo-ink3">a invité</span> {r.referee?.name ?? 'un client'}</span>
                <span className="block truncate text-xs text-kraveo-ink3">Code {r.code} · invité le {dateOnly(r.createdAt)}{r.rewardedAt ? ` · récompensé le ${dateOnly(r.rewardedAt)}` : ''}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Pill>
                {r.status === 'PENDING' && <button type="button" className="k-icon-btn" onClick={() => cancel(r)} aria-label={`Annuler le parrainage de ${r.referee?.name ?? 'ce client'}`}><XCircle className="h-4 w-4" aria-hidden="true" /></button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {list.data && <PaginationBar page={page} pageCount={Math.max(1, Math.ceil(list.data.total / 25))} pageSize={25} total={list.data.total} onPage={setPage} noun="parrainages" />}
      {dialog}
    </div>
  );
};
