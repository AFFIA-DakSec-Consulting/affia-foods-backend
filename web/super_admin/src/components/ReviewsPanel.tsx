import React, { useEffect, useState } from 'react';
import { Flag, FlagOff, MessageSquareText, Star, ThumbsDown } from 'lucide-react';
import { apiService } from '../services/api';
import { Review } from '../lib/platformParse';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { KpiTile } from './ui/KpiTile';
import { PaginationBar } from './ui/Pagination';
import { SkeletonCard } from './ui/Skeleton';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmDialog';
import { Drawer } from './ui/Drawer';
import { PageHeader, UnderlineTabs } from './ui/PageToolbar';
import { ErrorBanner, Pill, dateTime, errorText, useLoad } from './platform/common';

const Stars: React.FC<{ value: number }> = ({ value }) => (
  <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} sur 5`}>
    {[1, 2, 3, 4, 5].map((n) => <Star key={n} className={`h-4 w-4 ${value >= n - 0.25 ? 'fill-kraveo-status-placed text-kraveo-status-placed' : 'text-kraveo-line'}`} aria-hidden="true" />)}
  </span>
);

const flaggedByLabel = (by: string | null) => (by?.startsWith('VENDOR') ? 'Signalé par le restaurant' : by?.startsWith('ADMIN') ? 'Signalé par l’équipe' : 'Signalé');

export const ReviewsPanel: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [filter, setFilter] = useState<'all' | 'flagged' | 'low'>('all');
  const [page, setPage] = useState(1);
  const [flagging, setFlagging] = useState<Review | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setPage(1); }, [filter]);

  const stats = useLoad(() => apiService.fetchReviewStats('30d'), onAuthError);
  const list = useLoad(() => apiService.fetchReviews({ flagged: filter === 'flagged' ? 'true' : '', rating: '' }, page, 25), onAuthError, [filter, page]);
  const s = stats.data;
  const all = list.data?.data ?? [];
  // "Low" is a view on the loaded page: the server filters one exact rating at a time.
  const rows = filter === 'low' ? all.filter((r) => r.driverRating <= 2) : all;

  const reloadAll = () => { list.reload(); stats.reload(); };

  const submitFlag = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!flagging) return;
    const text = reason.trim();
    if (text.length < 3) { setReasonError('Expliquez le motif en 3 caractères minimum.'); return; }
    setBusy(true); setReasonError('');
    try { await apiService.flagReview(flagging.id, true, text); toast.success('Avis signalé'); setFlagging(null); setReason(''); reloadAll(); } catch (e) { onAuthError(e); setReasonError(errorText(e)); } finally { setBusy(false); }
  };

  const unflag = async (r: Review) => {
    if (!(await confirm({ title: 'Lever le signalement ?', message: 'L’avis ne sera plus marqué comme litigieux.', confirmLabel: 'Lever le signalement' }))) return;
    try { await apiService.flagReview(r.id, false); toast.success('Signalement levé'); reloadAll(); } catch (e) { onAuthError(e); toast.error('Action refusée', errorText(e)); }
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={Star} title="Avis clients" subtitle="Notes des livreurs et des plats, et signalements à examiner." onRefresh={reloadAll} refreshing={list.loading} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Avis (30 j)" value={s?.count ?? 0} note={s?.countChangePct == null ? undefined : `${s.countChangePct > 0 ? '+' : ''}${s.countChangePct} % vs période précédente`} icon={MessageSquareText} loading={stats.loading && !s} index={0} />
        <KpiTile label="Note livreurs" value={s?.averageDriverRating == null ? '—' : s.averageDriverRating.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} icon={Star} loading={stats.loading && !s} index={1} />
        <KpiTile label="Note des plats" value={s?.averageDishRating == null ? '—' : s.averageDishRating.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} icon={Star} loading={stats.loading && !s} index={2} />
        <KpiTile label="Notes basses" value={s?.lowRated ?? 0} note={`${s?.flaggedOpen ?? 0} signalé${(s?.flaggedOpen ?? 0) > 1 ? 's' : ''}`} icon={ThumbsDown} tone="text-kraveo-danger" toneBg="bg-kraveo-danger/10" loading={stats.loading && !s} index={3} />
      </div>
      <UnderlineTabs label="Filtre des avis" value={filter} onChange={setFilter} tabs={[{ id: 'all', label: 'Tous' }, { id: 'flagged', label: 'Signalés', count: s?.flaggedOpen, alert: true }, { id: 'low', label: 'Notes basses (page)' }]} />
      {list.error && <ErrorBanner message={list.error} onRetry={list.reload} />}
      {list.loading && !list.data && <SkeletonCard lines={4} />}
      {list.data && rows.length === 0 && <div className="k-card p-6"><EmptyState icon={Star} title="Aucun avis" description="Aucun avis ne correspond à ce filtre." /></div>}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className={`k-card space-y-3 p-4 sm:p-5 ${r.flagged ? 'border-kraveo-danger/40' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-bold text-kraveo-ink">{r.restaurant}</p>
                <p className="text-xs text-kraveo-ink3">{r.customer} · {dateTime(r.createdAt)}{r.driver ? ` · livreur ${r.driver}` : ''}</p>
              </div>
              <div className="flex items-center gap-2"><Stars value={r.driverRating} />{r.flagged && <Pill tone="red">Signalé</Pill>}</div>
            </div>
            {r.driverTags.length > 0 && <div className="flex flex-wrap gap-1.5">{r.driverTags.map((t) => <Pill key={t}>{t}</Pill>)}</div>}
            {r.driverNotes && <p className="text-sm text-kraveo-ink">« {r.driverNotes} »</p>}
            {r.restaurantNotes && <p className="text-sm text-kraveo-ink2">Sur le restaurant : « {r.restaurantNotes} »</p>}
            {r.dishReviews.length > 0 && <ul className="space-y-1 text-sm text-kraveo-ink2">{r.dishReviews.map((d, i) => <li key={i}>{d.name}{d.rating !== null ? ` : ${d.rating}/5` : ''}{d.comment ? ` — ${d.comment}` : ''}</li>)}</ul>}
            {r.flagged && <p className="rounded-k-sm bg-kraveo-danger/10 px-3 py-2 text-xs text-kraveo-ink"><span className="font-bold">{flaggedByLabel(r.flaggedBy)}</span>{r.flagReason ? ` : ${r.flagReason}` : ''}</p>}
            <div className="flex justify-end">
              {r.flagged
                ? <button type="button" className="k-btn-ghost !min-h-[36px] text-xs" onClick={() => unflag(r)}><FlagOff className="h-4 w-4" aria-hidden="true" />Lever le signalement</button>
                : <button type="button" className="k-btn-ghost !min-h-[36px] text-xs" onClick={() => { setFlagging(r); setReason(''); setReasonError(''); }}><Flag className="h-4 w-4" aria-hidden="true" />Signaler</button>}
            </div>
          </li>
        ))}
      </ul>
      {list.data && filter !== 'low' && <PaginationBar page={page} pageCount={Math.max(1, Math.ceil(list.data.total / 25))} pageSize={25} total={list.data.total} onPage={setPage} noun="avis" />}
      <Drawer open={Boolean(flagging)} onClose={() => setFlagging(null)} title="Signaler cet avis" subtitle={flagging?.restaurant} icon={Flag}
        footer={<div className="flex gap-3 pb-4"><button type="button" className="k-btn-ghost flex-1" onClick={() => setFlagging(null)}>Annuler</button><button type="submit" form="flag-form" className="k-btn-danger flex-1" disabled={busy}>Signaler</button></div>}>
        <form id="flag-form" onSubmit={submitFlag} noValidate>
          <Field label="Motif" htmlFor="flag-reason" required error={reasonError} hint="3 à 300 caractères, sans < ni >. Visible par l’équipe.">
            <textarea id="flag-reason" rows={4} className="k-input" value={reason} onChange={(e) => { setReason(e.target.value); setReasonError(''); }} maxLength={300} aria-invalid={Boolean(reasonError) || undefined} aria-describedby="flag-reason-msg" />
          </Field>
        </form>
      </Drawer>
      {dialog}
    </div>
  );
};
