import React, { useEffect, useState } from 'react';
import { Loader2, Megaphone, Plus, Send, Trash2 } from 'lucide-react';
import { apiService, ApiError } from '../services/api';
import { Campaign, CampaignSegment, CampaignStats, CampaignStatus } from '../lib/platformParse';
import { Drawer } from './ui/Drawer';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { SkeletonCard } from './ui/Skeleton';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmDialog';
import { PageHeader } from './ui/PageToolbar';
import { ErrorBanner, Pill, Tone, TextInput, dateTime, errorText, useLoad } from './platform/common';

const STATUS: Record<CampaignStatus, { label: string; tone: Tone }> = {
  DRAFT: { label: 'Brouillon', tone: 'grey' }, SCHEDULED: { label: 'Programmée', tone: 'blue' }, SENDING: { label: 'Envoi en cours', tone: 'amber' }, SENT: { label: 'Envoyée', tone: 'green' }, CANCELLED: { label: 'Annulée', tone: 'red' },
};

interface Draft { name: string; description: string; title: string; body: string; scheduledAt: string; inactiveDays: string; minOrders: string; maxOrders: string; city: string }
const emptyDraft = (): Draft => ({ name: '', description: '', title: '', body: '', scheduledAt: '', inactiveDays: '', minOrders: '', maxOrders: '', city: '' });
const draftOf = (c: Campaign): Draft => ({
  name: c.name, description: c.description, title: c.title, body: c.body, scheduledAt: c.scheduledAt ? c.scheduledAt.slice(0, 16) : '',
  inactiveDays: c.segment.last_order_days_gt === undefined ? '' : String(c.segment.last_order_days_gt), minOrders: c.segment.min_orders === undefined ? '' : String(c.segment.min_orders),
  maxOrders: c.segment.max_orders === undefined ? '' : String(c.segment.max_orders), city: c.segment.city ?? '',
});

/** The segment the server accepts, or the field that is wrong. Empty fields are not sent. */
export const segmentOf = (d: Pick<Draft, 'inactiveDays' | 'minOrders' | 'maxOrders' | 'city'>): { ok: true; segment: CampaignSegment } | { ok: false; field: string; message: string } => {
  const segment: CampaignSegment = {};
  const whole = (value: string, field: string, key: 'last_order_days_gt' | 'min_orders' | 'max_orders'): string | null => {
    if (!value.trim()) return null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) return field;
    segment[key] = n;
    return null;
  };
  const bad = whole(d.inactiveDays, 'inactiveDays', 'last_order_days_gt') ?? whole(d.minOrders, 'minOrders', 'min_orders') ?? whole(d.maxOrders, 'maxOrders', 'max_orders');
  if (bad) return { ok: false, field: bad, message: 'Saisissez un nombre entier (0 ou plus).' };
  if (segment.min_orders !== undefined && segment.max_orders !== undefined && segment.min_orders > segment.max_orders) return { ok: false, field: 'maxOrders', message: 'Le maximum doit être supérieur au minimum.' };
  if (d.city.trim()) segment.city = d.city.trim();
  return { ok: true, segment };
};

const CampaignDrawer: React.FC<{ open: boolean; editing: Campaign | null; onClose: () => void; onSaved: () => void; onAuthError: (e: unknown) => void }> = ({ open, editing, onClose, onSaved, onAuthError }) => {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [d, setD] = useState<Draft>(emptyDraft());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const locked = editing?.status === 'SENT' || editing?.status === 'SENDING';

  useEffect(() => {
    if (!open) return;
    setD(editing ? draftOf(editing) : emptyDraft()); setErrors({}); setGeneral(''); setStats(null);
    if (editing && (editing.status === 'SENT' || editing.status === 'SENDING')) apiService.fetchCampaignStats(editing.id).then(setStats).catch(() => setStats(null));
  }, [open, editing]);

  const set = (key: keyof Draft, value: string) => { setD((cur) => ({ ...cur, [key]: value })); setErrors((cur) => ({ ...cur, [key]: '' })); };
  const fail = (e: unknown) => { onAuthError(e); if (e instanceof ApiError && e.field) setErrors({ [e.field]: errorText(e) }); else setGeneral(errorText(e)); };

  const body = (): Record<string, unknown> | null => {
    if (d.name.trim().length < 2) { setErrors({ name: 'Donnez un nom (2 caractères minimum).' }); return null; }
    if (d.description.trim().length < 2) { setErrors({ description: 'Ajoutez une description courte.' }); return null; }
    const seg = segmentOf(d);
    if (!seg.ok) { setErrors({ [seg.field]: seg.message }); return null; }
    const out: Record<string, unknown> = { name: d.name.trim(), description: d.description.trim(), segment: seg.segment, title: d.title.trim() || null, body: d.body.trim() || null };
    out.scheduledAt = d.scheduledAt ? new Date(d.scheduledAt).toISOString() : null;
    return out;
  };

  const save = async (status?: 'SCHEDULED' | 'DRAFT' | 'CANCELLED') => {
    const payload = body();
    if (!payload) return;
    if (status) payload.status = status;
    setBusy(true); setGeneral('');
    try {
      await apiService.saveCampaign(editing?.id ?? null, payload);
      toast.success(status === 'SCHEDULED' ? 'Campagne programmée' : status === 'CANCELLED' ? 'Campagne annulée' : editing ? 'Campagne mise à jour' : 'Brouillon créé');
      onSaved(); onClose();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const sendNow = async () => {
    if (!editing) return;
    if (!(await confirm({ title: 'Envoyer maintenant ?', message: 'La notification part tout de suite aux clients du segment (hors heures silencieuses). Cette action est définitive.', confirmLabel: 'Envoyer' }))) return;
    setBusy(true); setGeneral('');
    try {
      const out = await apiService.sendCampaign(editing.id);
      if (out.deferred === 'QUIET_HOURS') toast.info('Rien n’est parti', 'Nous sommes dans les heures silencieuses : la campagne reste en l’état.');
      else toast.success('Campagne envoyée', `${out.sent} envoyée${out.sent > 1 ? 's' : ''}, ${out.skipped} ignorée${out.skipped > 1 ? 's' : ''}, ${out.failed} échec${out.failed > 1 ? 's' : ''}.`);
      onSaved(); onClose();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!editing) return;
    if (!(await confirm({ title: 'Supprimer cette campagne ?', message: 'Possible seulement pour un brouillon ou une campagne annulée.', confirmLabel: 'Supprimer', danger: true }))) return;
    setBusy(true);
    try { await apiService.deleteCampaign(editing.id); toast.success('Campagne supprimée'); onSaved(); onClose(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <Drawer open={open} onClose={onClose} title={editing ? editing.name : 'Nouvelle campagne'} subtitle={editing ? STATUS[editing.status].label : 'Notification push aux clients'} icon={Megaphone} wide
      footer={!locked ? <div className="flex flex-wrap gap-2 pb-4">
        {editing && (editing.status === 'DRAFT' || editing.status === 'CANCELLED') && <button type="button" className="k-btn-danger" onClick={remove} disabled={busy} aria-label="Supprimer la campagne"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
        <button type="button" className="k-btn-ghost flex-1" onClick={() => save()} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Enregistrer</button>
        <button type="button" className="k-btn-ghost flex-1" onClick={() => save('SCHEDULED')} disabled={busy}>Programmer</button>
        {editing && <button type="button" className="k-btn-accent flex-1" onClick={sendNow} disabled={busy}><Send className="h-4 w-4" aria-hidden="true" />Envoyer</button>}
      </div> : undefined}>
      <div className="space-y-4">
        {general && <ErrorBanner message={general} />}
        {locked && <p className="rounded-k-sm bg-kraveo-surface2 px-3 py-2 text-sm text-kraveo-ink2">Cette campagne est partie : elle n’est plus modifiable.</p>}
        {stats && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[['Envoyées', stats.sent], ['Échecs', stats.failed], ['Ignorées', stats.skipped], ['Ouvertes', stats.opened], ['Converties', stats.converted], ['Conversion', `${stats.conversionRate.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`]].map(([l, v]) => (
              <div key={String(l)} className="k-inset px-3 py-2"><p className="k-label">{l}</p><p className="k-num text-lg text-kraveo-ink">{v}</p></div>
            ))}
            <p className="col-span-full text-xs text-kraveo-ink3">« Convertie » = le client a commandé dans les 72 h après la notification.</p>
          </div>
        )}
        <fieldset disabled={locked || busy} className="space-y-4">
          <Field label="Nom interne" htmlFor="camp-name" required error={errors.name}><TextInput id="camp-name" value={d.name} onChange={(e) => set('name', e.target.value)} invalid={Boolean(errors.name)} maxLength={120} /></Field>
          <Field label="Description" htmlFor="camp-desc" required error={errors.description}><TextInput id="camp-desc" value={d.description} onChange={(e) => set('description', e.target.value)} invalid={Boolean(errors.description)} maxLength={500} /></Field>
          <Field label={`Titre de la notification (${d.title.length}/65)`} htmlFor="camp-title" error={errors.title}><TextInput id="camp-title" value={d.title} onChange={(e) => set('title', e.target.value)} maxLength={65} invalid={Boolean(errors.title)} /></Field>
          <Field label={`Message (${d.body.length}/240)`} htmlFor="camp-body" error={errors.body}><textarea id="camp-body" rows={3} className="k-input" value={d.body} onChange={(e) => set('body', e.target.value)} maxLength={240} /></Field>
          <fieldset className="space-y-3 rounded-k-md border border-kraveo-line p-4">
            <legend className="k-label px-1">À qui ? (vide = tous les clients)</legend>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Inactifs depuis plus de (jours)" htmlFor="camp-inactive" error={errors.inactiveDays} hint="Parmi ceux qui ont déjà commandé."><TextInput id="camp-inactive" inputMode="numeric" value={d.inactiveDays} onChange={(e) => set('inactiveDays', e.target.value)} invalid={Boolean(errors.inactiveDays)} /></Field>
              <Field label="Ville" htmlFor="camp-city" error={errors.city} hint="Texte contenu dans l’adresse du profil."><TextInput id="camp-city" value={d.city} onChange={(e) => set('city', e.target.value)} invalid={Boolean(errors.city)} /></Field>
              <Field label="Commandes minimum" htmlFor="camp-min" error={errors.minOrders}><TextInput id="camp-min" inputMode="numeric" value={d.minOrders} onChange={(e) => set('minOrders', e.target.value)} invalid={Boolean(errors.minOrders)} /></Field>
              <Field label="Commandes maximum" htmlFor="camp-max" error={errors.maxOrders}><TextInput id="camp-max" inputMode="numeric" value={d.maxOrders} onChange={(e) => set('maxOrders', e.target.value)} invalid={Boolean(errors.maxOrders)} /></Field>
            </div>
          </fieldset>
          <Field label="Envoi programmé" htmlFor="camp-at" error={errors.scheduledAt} hint="Requis pour « Programmer » (avec titre et message). Le module « Campagnes » doit être actif."><TextInput id="camp-at" type="datetime-local" value={d.scheduledAt} onChange={(e) => set('scheduledAt', e.target.value)} /></Field>
        </fieldset>
        <p className="text-xs text-kraveo-ink3">Garde-fous du serveur : un client ne reçoit une campagne qu’une fois, aucun envoi pendant les heures silencieuses, et les clients qui ont coupé le marketing sont ignorés.</p>
      </div>
      {dialog}
    </Drawer>
  );
};

export const CampaignsPanel: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const { data, loading, error, reload } = useLoad(() => apiService.fetchCampaigns(1, 100), onAuthError);
  const [drawer, setDrawer] = useState<{ open: boolean; editing: Campaign | null }>({ open: false, editing: null });
  const rows = data?.data ?? [];
  return (
    <div className="space-y-5">
      <PageHeader icon={Megaphone} title="Campagnes" subtitle="Notifications push ciblées vers vos clients." onRefresh={reload} refreshing={loading}
        actions={<button type="button" className="k-btn-accent" onClick={() => setDrawer({ open: true, editing: null })}><Plus className="h-4 w-4" aria-hidden="true" />Nouvelle campagne</button>} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <SkeletonCard lines={4} />}
      {data && rows.length === 0 && <div className="k-card p-6"><EmptyState icon={Megaphone} title="Aucune campagne" description="Relancez les clients inactifs ou annoncez une offre avec une première campagne." /></div>}
      {rows.length > 0 && (
        <ul className="k-card divide-y divide-kraveo-line/60 overflow-hidden">
          {rows.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => setDrawer({ open: true, editing: c })} className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-kraveo-surface2 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0"><span className="block truncate font-bold text-kraveo-ink">{c.name}</span><span className="block truncate text-xs text-kraveo-ink3">{c.title || 'Sans titre'} · {c.scheduledAt ? `prévue le ${dateTime(c.scheduledAt)}` : `créée le ${dateTime(c.createdAt)}`}{c.status === 'SENT' ? ` · ${c.sentCount} envoyées, ${c.openedCount} ouvertes, ${c.convertedCount} converties` : ''}</span></span>
                <Pill tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Pill>
              </button>
            </li>
          ))}
        </ul>
      )}
      <CampaignDrawer open={drawer.open} editing={drawer.editing} onClose={() => setDrawer({ open: false, editing: null })} onSaved={reload} onAuthError={onAuthError} />
    </div>
  );
};
