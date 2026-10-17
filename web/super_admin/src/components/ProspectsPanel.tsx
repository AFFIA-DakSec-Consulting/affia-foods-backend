import React, { useEffect, useMemo, useState } from 'react';
import { AlarmClock, Loader2, MessageCircle, Phone, Plus, SearchCheck, Send, Trash2 } from 'lucide-react';
import { apiService, ApiError } from '../services/api';
import {
  EVENT_LABEL, EVENT_TYPES, PROSPECT_STAGES, Prospect, ProspectDetail, ProspectKind, ProspectStage, STAGE_LABEL, isOverdue,
} from '../lib/platformParse';
import { timeAgo } from '../lib/tokens';
import { Drawer } from './ui/Drawer';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { KpiTile } from './ui/KpiTile';
import { SkeletonCard } from './ui/Skeleton';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmDialog';
import { PageHeader, SearchField, UnderlineTabs } from './ui/PageToolbar';
import { ErrorBanner, Pill, Tone, TextInput, dateOnly, dateTime, errorText, useLoad } from './platform/common';

const STAGE_TONE: Record<ProspectStage, Tone> = { TO_CONTACT: 'grey', CONTACTED: 'blue', FOLLOW_UP: 'amber', INTERESTED: 'green', SIGNED: 'green', REJECTED: 'red' };
const KIND_LABEL: Record<ProspectKind, string> = { RESTAURANT: 'Restaurant', DRIVER: 'Livreur' };

interface Form { kind: ProspectKind; businessName: string; contactName: string; phone: string; email: string; district: string; category: string; source: string; fit: '' | 'A' | 'B' | 'C'; stage: ProspectStage; nextFollowUpAt: string }
const emptyForm = (): Form => ({ kind: 'RESTAURANT', businessName: '', contactName: '', phone: '', email: '', district: '', category: '', source: '', fit: '', stage: 'TO_CONTACT', nextFollowUpAt: '' });
const formOf = (p: Prospect): Form => ({ kind: p.kind, businessName: p.businessName, contactName: p.contactName ?? '', phone: p.phone ?? '', email: p.email ?? '', district: p.district ?? '', category: p.category ?? '', source: p.source ?? '', fit: p.fit ?? '', stage: p.stage, nextFollowUpAt: p.nextFollowUpAt ? p.nextFollowUpAt.slice(0, 16) : '' });

/** The body the server accepts. Empty optional fields become null so a field can be cleared. */
export const prospectBody = (f: Form): Record<string, unknown> => {
  const text = (v: string) => (v.trim() === '' ? null : v.trim());
  return {
    kind: f.kind, businessName: f.businessName.trim(), contactName: text(f.contactName), phone: text(f.phone), email: text(f.email), district: text(f.district),
    category: text(f.category), source: text(f.source), fit: f.fit === '' ? null : f.fit, stage: f.stage,
    nextFollowUpAt: f.nextFollowUpAt ? new Date(f.nextFollowUpAt).toISOString() : null,
  };
};

const ProspectDrawer: React.FC<{ open: boolean; editing: Prospect | null; onClose: () => void; onSaved: () => void; onAuthError: (e: unknown) => void }> = ({ open, editing, onClose, onSaved, onAuthError }) => {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [form, setForm] = useState<Form>(emptyForm());
  const [detail, setDetail] = useState<ProspectDetail | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [busy, setBusy] = useState(false);
  const [eventType, setEventType] = useState<string>('CALL');
  const [eventBody, setEventBody] = useState('');
  const [eventNext, setEventNext] = useState('');
  const [eventError, setEventError] = useState('');

  const loadDetail = (id: string) => apiService.fetchProspect(id).then(setDetail).catch((e) => { onAuthError(e); setGeneral(errorText(e)); });
  useEffect(() => {
    if (!open) return;
    setErrors({}); setGeneral(''); setEventBody(''); setEventNext(''); setEventError(''); setDetail(null);
    setForm(editing ? formOf(editing) : emptyForm());
    if (editing) loadDetail(editing.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => { setForm((f) => ({ ...f, [key]: value })); setErrors((e) => ({ ...e, [key]: '' })); };
  const fail = (e: unknown) => { onAuthError(e); if (e instanceof ApiError && e.field) setErrors({ [e.field]: errorText(e) }); else setGeneral(errorText(e)); };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.businessName.trim().length < 2) { setErrors({ businessName: 'Saisissez le nom (2 caractères minimum).' }); return; }
    setBusy(true); setGeneral('');
    try { await apiService.saveProspect(editing?.id ?? null, prospectBody(form)); toast.success(editing ? 'Contact mis à jour' : 'Contact ajouté', form.businessName.trim()); onSaved(); onClose(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const addEvent = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    if (eventBody.trim().length < 2) { setEventError('Écrivez ce qui s’est passé.'); return; }
    setBusy(true); setEventError('');
    try {
      await apiService.addProspectEvent(editing.id, { type: eventType, body: eventBody.trim(), ...(eventNext ? { nextFollowUpAt: new Date(eventNext).toISOString() } : {}) });
      toast.success('Échange enregistré');
      setEventBody(''); setEventNext('');
      await loadDetail(editing.id); onSaved();
    } catch (e) { onAuthError(e); setEventError(errorText(e)); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!editing || !(await confirm({ title: `Supprimer « ${editing.businessName} » ?`, message: 'Le contact et son historique sont effacés.', confirmLabel: 'Supprimer', danger: true }))) return;
    setBusy(true);
    try { await apiService.deleteProspect(editing.id); toast.success('Contact supprimé'); onSaved(); onClose(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <Drawer open={open} onClose={onClose} wide icon={SearchCheck} title={editing ? editing.businessName : 'Nouveau contact'} subtitle={editing ? `${KIND_LABEL[editing.kind]} · ${STAGE_LABEL[editing.stage]}` : 'Restaurant ou livreur à recruter'}
      footer={<div className="flex gap-3 pb-4">
        {editing && <button type="button" className="k-btn-danger" onClick={remove} disabled={busy} aria-label="Supprimer le contact"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
        <button type="button" className="k-btn-ghost flex-1" onClick={onClose}>Fermer</button>
        <button type="submit" form="prospect-form" className="k-btn-accent flex-1" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Enregistrer</button>
      </div>}>
      <div className="space-y-6">
        <form id="prospect-form" onSubmit={submit} className="space-y-4" noValidate>
          {general && <ErrorBanner message={general} />}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom de l’établissement ou de la personne" htmlFor="pr-name" required error={errors.businessName}><TextInput id="pr-name" value={form.businessName} onChange={(e) => set('businessName', e.target.value)} invalid={Boolean(errors.businessName)} maxLength={120} /></Field>
            <Field label="Type" htmlFor="pr-kind"><select id="pr-kind" className="k-input" value={form.kind} onChange={(e) => set('kind', e.target.value as ProspectKind)}><option value="RESTAURANT">Restaurant</option><option value="DRIVER">Livreur</option></select></Field>
            <Field label="Contact" htmlFor="pr-contact" error={errors.contactName}><TextInput id="pr-contact" value={form.contactName} onChange={(e) => set('contactName', e.target.value)} maxLength={80} /></Field>
            <Field label="Téléphone" htmlFor="pr-phone" error={errors.phone}><TextInput id="pr-phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} invalid={Boolean(errors.phone)} /></Field>
            <Field label="E-mail" htmlFor="pr-email" error={errors.email}><TextInput id="pr-email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} invalid={Boolean(errors.email)} /></Field>
            <Field label="Quartier" htmlFor="pr-district"><TextInput id="pr-district" value={form.district} onChange={(e) => set('district', e.target.value)} maxLength={60} /></Field>
            <Field label={form.kind === 'DRIVER' ? 'Véhicule' : 'Cuisine'} htmlFor="pr-category"><TextInput id="pr-category" value={form.category} onChange={(e) => set('category', e.target.value)} maxLength={60} /></Field>
            <Field label="Origine du contact" htmlFor="pr-source" hint="Terrain, recommandation, Instagram…"><TextInput id="pr-source" value={form.source} onChange={(e) => set('source', e.target.value)} maxLength={60} /></Field>
            <Field label="Potentiel" htmlFor="pr-fit" hint="A = très bon, C = faible"><select id="pr-fit" className="k-input" value={form.fit} onChange={(e) => set('fit', e.target.value as Form['fit'])}><option value="">Non évalué</option><option value="A">A</option><option value="B">B</option><option value="C">C</option></select></Field>
            <Field label="Étape" htmlFor="pr-stage"><select id="pr-stage" className="k-input" value={form.stage} onChange={(e) => set('stage', e.target.value as ProspectStage)}>{PROSPECT_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}</select></Field>
            <Field label="Prochaine relance" htmlFor="pr-next" error={errors.nextFollowUpAt}><TextInput id="pr-next" type="datetime-local" value={form.nextFollowUpAt} onChange={(e) => set('nextFollowUpAt', e.target.value)} /></Field>
          </div>
        </form>

        {editing && (
          <section className="space-y-3" aria-label="Historique des échanges">
            <h3 className="k-label">Historique</h3>
            <form onSubmit={addEvent} className="k-inset space-y-3 px-4 py-4" noValidate>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Type d’échange">
                {EVENT_TYPES.map((t) => <button key={t} type="button" className="k-chip" aria-pressed={eventType === t} onClick={() => setEventType(t)}>{EVENT_LABEL[t]}</button>)}
              </div>
              <Field label="Ce qui s’est passé" htmlFor="pr-event" error={eventError}><textarea id="pr-event" rows={2} className="k-input" value={eventBody} onChange={(e) => { setEventBody(e.target.value); setEventError(''); }} maxLength={1000} aria-invalid={Boolean(eventError) || undefined} aria-describedby="pr-event-msg" /></Field>
              <Field label="Prochaine relance (facultatif)" htmlFor="pr-event-next"><TextInput id="pr-event-next" type="datetime-local" value={eventNext} onChange={(e) => setEventNext(e.target.value)} /></Field>
              <button type="submit" className="k-btn-accent w-full" disabled={busy}><Send className="h-4 w-4" aria-hidden="true" />Ajouter à l’historique</button>
            </form>
            {!detail && <SkeletonCard lines={2} />}
            <ul className="space-y-2">
              {detail?.events.map((e) => (
                <li key={e.id} className="rounded-k-md bg-kraveo-surface2 px-4 py-3 text-sm">
                  <p className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-kraveo-ink3">{EVENT_LABEL[e.type] ?? e.type} <span className="font-normal normal-case">· {dateTime(e.createdAt)}</span></p>
                  <p className="whitespace-pre-wrap break-words text-kraveo-ink">{e.body}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {dialog}
    </Drawer>
  );
};

type KindFilter = '' | ProspectKind;

export const ProspectsPanel: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const [stage, setStage] = useState<'ALL' | ProspectStage | 'OVERDUE'>('ALL');
  const [kind, setKind] = useState<KindFilter>('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [drawer, setDrawer] = useState<{ open: boolean; editing: Prospect | null }>({ open: false, editing: null });
  useEffect(() => { const t = window.setTimeout(() => setDebounced(search), 350); return () => window.clearTimeout(t); }, [search]);

  const stats = useLoad(() => apiService.fetchProspectStats(), onAuthError);
  const list = useLoad(() => apiService.fetchProspects({ stage: stage === 'ALL' || stage === 'OVERDUE' ? '' : stage, overdue: stage === 'OVERDUE', kind, q: debounced }), onAuthError, [stage, kind, debounced]);
  const s = stats.data;
  const rows = list.data?.data ?? [];
  const reloadList = list.reload; const reloadStats = stats.reload;
  const refresh = () => { reloadList(); reloadStats(); };
  const now = Date.now();
  const tabs = useMemo(() => [
    { id: 'ALL' as const, label: 'Tous', count: s?.total },
    { id: 'OVERDUE' as const, label: 'À relancer maintenant', count: s?.overdue, alert: true },
    ...PROSPECT_STAGES.map((st) => ({ id: st, label: STAGE_LABEL[st], count: s?.counts[st] })),
  ], [s]);

  return (
    <div className="space-y-5">
      <PageHeader icon={SearchCheck} title="Restaurants à recruter" subtitle="Les restaurants et livreurs à convaincre, avec le suivi de chaque contact." onRefresh={refresh} refreshing={list.loading}
        actions={<button type="button" className="k-btn-accent" onClick={() => setDrawer({ open: true, editing: null })}><Plus className="h-4 w-4" aria-hidden="true" />Nouveau contact</button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile index={0} loading={stats.loading && !s} label="Contacts suivis" icon={SearchCheck} value={s?.total ?? 0} />
        <KpiTile index={1} loading={stats.loading && !s} label="À relancer" icon={AlarmClock} tone="text-kraveo-danger" toneBg="bg-kraveo-danger/10" value={s?.overdue ?? 0} note="Date de relance dépassée" />
        <KpiTile index={2} loading={stats.loading && !s} label="Intéressés" icon={MessageCircle} value={s?.counts.INTERESTED ?? 0} />
        <KpiTile index={3} loading={stats.loading && !s} label="Signés" icon={Phone} value={s?.counts.SIGNED ?? 0} note={s ? `${s.conversionRate.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % des dossiers clos` : undefined} />
      </div>
      <UnderlineTabs label="Étape" value={stage} onChange={setStage} tabs={tabs} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1"><SearchField value={search} onChange={setSearch} placeholder="Nom, contact, quartier, téléphone" label="Rechercher un contact" /></div>
        <select aria-label="Type de contact" className="k-input sm:!w-44" value={kind} onChange={(e) => setKind(e.target.value as KindFilter)}><option value="">Tous les types</option><option value="RESTAURANT">Restaurants</option><option value="DRIVER">Livreurs</option></select>
      </div>
      {list.error && <ErrorBanner message={list.error} onRetry={list.reload} />}
      {list.loading && !list.data && <SkeletonCard lines={4} />}
      {list.data && rows.length === 0 && <div className="k-card p-6"><EmptyState icon={SearchCheck} title="Aucun contact" description="Ajoutez les restaurants et livreurs que vous voulez recruter pour suivre chaque échange." /></div>}
      {rows.length > 0 && (
        <ul className="k-card divide-y divide-kraveo-line/60 overflow-hidden">
          {rows.map((p) => {
            const late = isOverdue(p, now);
            return (
              <li key={p.id}>
                <button type="button" onClick={() => setDrawer({ open: true, editing: p })} className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-kraveo-surface2 sm:flex-row sm:items-center sm:justify-between">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2"><span className="truncate font-bold text-kraveo-ink">{p.businessName}</span><Pill>{KIND_LABEL[p.kind]}</Pill>{p.fit && <Pill tone={p.fit === 'A' ? 'green' : p.fit === 'B' ? 'blue' : 'grey'}>Potentiel {p.fit}</Pill>}</span>
                    <span className="block truncate text-xs text-kraveo-ink3">{[p.contactName, p.phone, p.district, p.category].filter(Boolean).join(' · ') || 'Aucune information de contact'}</span>
                    <span className={`block truncate text-xs ${late ? 'font-bold text-kraveo-danger' : 'text-kraveo-ink3'}`}>
                      {p.nextFollowUpAt ? `${late ? 'Relance en retard : ' : 'Relance : '}${dateOnly(p.nextFollowUpAt)}` : 'Pas de relance prévue'}{p.lastContactedAt ? ` · dernier contact ${timeAgo(p.lastContactedAt)}` : ''}
                    </span>
                  </span>
                  <Pill tone={STAGE_TONE[p.stage]}>{STAGE_LABEL[p.stage]}</Pill>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <ProspectDrawer open={drawer.open} editing={drawer.editing} onClose={() => setDrawer({ open: false, editing: null })} onSaved={refresh} onAuthError={onAuthError} />
    </div>
  );
};
