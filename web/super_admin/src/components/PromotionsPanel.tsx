import React, { useEffect, useState } from 'react';
import { BadgePercent, Loader2, Plus, Trash2 } from 'lucide-react';
import { apiService, ApiError } from '../services/api';
import { inr } from '../lib/tokens';
import {
  PROMO_MODULES, PROMO_TYPES, Promotion, PromotionForm, PromotionStats, PromoState, emptyPromotionForm, promoValueLabel, promotionBody, promotionState, promotionToForm,
} from '../lib/platformParse';
import { Drawer } from './ui/Drawer';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { SkeletonCard } from './ui/Skeleton';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmDialog';
import { PageHeader } from './ui/PageToolbar';
import { CheckRow, ErrorBanner, Pill, Tone, TextInput, dateOnly, errorText, useLoad } from './platform/common';

const TYPE_LABEL: Record<string, string> = {
  FREE_DELIVERY: 'Livraison offerte', PERCENT_OFF_DELIVERY: '% sur la livraison', FIXED_OFF_DELIVERY: 'Montant sur la livraison', PERCENT_OFF_CART: '% sur le panier', FIXED_OFF_CART: 'Montant sur le panier',
};
const MODULE_LABEL: Record<string, string> = { 'marketing.promo_codes': 'Code promo', 'marketing.first_order': 'Première commande', 'marketing.free_delivery': 'Livraison gratuite' };
const STATE: Record<PromoState, { label: string; tone: Tone }> = {
  live: { label: 'En cours', tone: 'green' }, scheduled: { label: 'Programmée', tone: 'blue' }, expired: { label: 'Terminée', tone: 'grey' }, exhausted: { label: 'Budget épuisé', tone: 'amber' }, inactive: { label: 'Désactivée', tone: 'grey' },
};
const FUNDING_LABEL = { PLATFORM: 'Affia Foods', MERCHANT: 'Le restaurant', SPLIT: 'Partagé' } as const;

type FieldErrors = Partial<Record<string, string>>;

const PromotionDrawer: React.FC<{ editing: Promotion | null; open: boolean; onClose: () => void; onSaved: () => void; onAuthError: (e: unknown) => void }> = ({ editing, open, onClose, onSaved, onAuthError }) => {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [form, setForm] = useState<PromotionForm>(emptyPromotionForm());
  const [errors, setErrors] = useState<FieldErrors>({});
  const [general, setGeneral] = useState('');
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<PromotionStats | null>(null);

  useEffect(() => {
    if (!open) return;
    setForm(editing ? promotionToForm(editing) : emptyPromotionForm());
    setErrors({}); setGeneral(''); setStats(null);
    if (editing) apiService.fetchPromotionStats(editing.id).then(setStats).catch(() => setStats(null));
  }, [open, editing]);

  const set = <K extends keyof PromotionForm>(key: K, value: PromotionForm[K]) => { setForm((f) => ({ ...f, [key]: value })); setErrors((e) => ({ ...e, [key]: undefined })); };
  const percent = form.type === 'PERCENT_OFF_CART' || form.type === 'PERCENT_OFF_DELIVERY';
  const isEdit = Boolean(editing);

  const fail = (e: unknown) => {
    onAuthError(e);
    if (e instanceof ApiError && e.field) setErrors({ [e.field]: errorText(e) });
    else setGeneral(errorText(e));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (form.name.trim().length < 2) { setErrors({ name: 'Donnez un nom (2 caractères minimum).' }); return; }
    if (form.description.trim().length < 2) { setErrors({ description: 'Ajoutez une description courte.' }); return; }
    if (form.type !== 'FREE_DELIVERY' && !form.value.trim()) { setErrors({ value: percent ? 'Saisissez un pourcentage.' : 'Saisissez un montant en FCFA.' }); return; }
    setBusy(true); setGeneral('');
    try {
      if (editing) await apiService.updatePromotion(editing.id, promotionBody(form, 'update'));
      else await apiService.createPromotion(promotionBody(form, 'create'));
      toast.success(isEdit ? 'Promotion mise à jour' : 'Promotion créée', form.name.trim());
      onSaved(); onClose();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!editing) return;
    if (!(await confirm({ title: 'Supprimer cette promotion ?', message: 'Possible seulement si elle n’a jamais servi. Sinon, désactivez-la.', confirmLabel: 'Supprimer', danger: true }))) return;
    setBusy(true);
    try { await apiService.deletePromotion(editing.id); toast.success('Promotion supprimée'); onSaved(); onClose(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <Drawer open={open} onClose={onClose} title={isEdit ? 'Modifier la promotion' : 'Nouvelle promotion'} subtitle={editing?.code ? `Code ${editing.code}` : 'Promotion automatique'} icon={BadgePercent} wide
      footer={<div className="flex gap-3 pb-4">
        {isEdit && <button type="button" className="k-btn-danger" onClick={remove} disabled={busy} aria-label="Supprimer la promotion"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
        <button type="button" className="k-btn-ghost flex-1" onClick={onClose}>Annuler</button>
        <button type="submit" form="promo-form" className="k-btn-accent flex-1" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{isEdit ? 'Enregistrer' : 'Créer'}</button>
      </div>}>
      <form id="promo-form" onSubmit={submit} className="space-y-4" noValidate>
        {stats && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[['Utilisations', String(stats.uses)], ['Clients', String(stats.distinctUsers)], ['Remises', inr(stats.discountTotal)], ['Budget restant', stats.budgetLeft === null ? 'Illimité' : inr(stats.budgetLeft)]].map(([l, v]) => (
              <div key={l} className="k-inset px-3 py-2"><p className="k-label">{l}</p><p className="k-num text-lg text-kraveo-ink">{v}</p></div>
            ))}
          </div>
        )}
        {general && <ErrorBanner message={general} />}
        <Field label="Nom" htmlFor="promo-name" required error={errors.name}><TextInput id="promo-name" value={form.name} onChange={(e) => set('name', e.target.value)} invalid={Boolean(errors.name)} maxLength={120} /></Field>
        <Field label="Description" htmlFor="promo-desc" required error={errors.description}><TextInput id="promo-desc" value={form.description} onChange={(e) => set('description', e.target.value)} invalid={Boolean(errors.description)} maxLength={500} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Famille" htmlFor="promo-module" error={errors.moduleCode} hint={isEdit ? 'Ne change plus après la création.' : undefined}>
            <select id="promo-module" className="k-input" value={form.moduleCode} onChange={(e) => set('moduleCode', e.target.value)} disabled={isEdit}>{PROMO_MODULES.map((m) => <option key={m} value={m}>{MODULE_LABEL[m]}</option>)}</select>
          </Field>
          <Field label="Type de remise" htmlFor="promo-type" error={errors.type} hint={isEdit ? 'Ne change plus après la création.' : undefined}>
            <select id="promo-type" className="k-input" value={form.type} onChange={(e) => set('type', e.target.value as PromotionForm['type'])} disabled={isEdit}>{PROMO_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</select>
          </Field>
          <Field label="Code client" htmlFor="promo-code" error={errors.code} hint={isEdit ? 'Ne change plus après la création.' : 'Vide = la promotion s’applique toute seule. 3 à 40 caractères : A-Z, 0-9, - et _.'}>
            <TextInput id="promo-code" value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} disabled={isEdit} invalid={Boolean(errors.code)} maxLength={40} placeholder="BIENVENUE" />
          </Field>
          {form.type !== 'FREE_DELIVERY' && (
            <Field label={percent ? 'Pourcentage' : 'Montant (FCFA)'} htmlFor="promo-value" required error={errors.value}><TextInput id="promo-value" inputMode="decimal" value={form.value} onChange={(e) => set('value', e.target.value)} invalid={Boolean(errors.value)} /></Field>
          )}
        </div>
        <fieldset className="space-y-3 rounded-k-md border border-kraveo-line p-4">
          <legend className="k-label px-1">Conditions (facultatif)</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Panier minimum (FCFA)" htmlFor="promo-min" error={errors.minCartAmount}><TextInput id="promo-min" inputMode="numeric" value={form.minCartAmount} onChange={(e) => set('minCartAmount', e.target.value)} invalid={Boolean(errors.minCartAmount)} /></Field>
            <Field label="Distance max (km)" htmlFor="promo-dist" error={errors.maxDistanceKm}><TextInput id="promo-dist" inputMode="decimal" value={form.maxDistanceKm} onChange={(e) => set('maxDistanceKm', e.target.value)} invalid={Boolean(errors.maxDistanceKm)} /></Field>
            <Field label="Remise max (FCFA)" htmlFor="promo-cap" error={errors.maxDiscountAmount}><TextInput id="promo-cap" inputMode="numeric" value={form.maxDiscountAmount} onChange={(e) => set('maxDiscountAmount', e.target.value)} invalid={Boolean(errors.maxDiscountAmount)} /></Field>
          </div>
          <CheckRow id="promo-first" label="Première commande uniquement" checked={form.firstOrderOnly} onChange={(v) => set('firstOrderOnly', v)} />
        </fieldset>
        <fieldset className="space-y-3 rounded-k-md border border-kraveo-line p-4">
          <legend className="k-label px-1">Limites et dates</legend>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Utilisations totales" htmlFor="promo-total" error={errors.maxUsesTotal}><TextInput id="promo-total" inputMode="numeric" value={form.maxUsesTotal} onChange={(e) => set('maxUsesTotal', e.target.value)} invalid={Boolean(errors.maxUsesTotal)} /></Field>
            <Field label="Par client" htmlFor="promo-per" error={errors.maxUsesPerUser}><TextInput id="promo-per" inputMode="numeric" value={form.maxUsesPerUser} onChange={(e) => set('maxUsesPerUser', e.target.value)} invalid={Boolean(errors.maxUsesPerUser)} /></Field>
            <Field label="Budget (FCFA)" htmlFor="promo-budget" error={errors.budgetTotal} hint="Une promo sans code exige un budget ou une date de fin."><TextInput id="promo-budget" inputMode="numeric" value={form.budgetTotal} onChange={(e) => set('budgetTotal', e.target.value)} invalid={Boolean(errors.budgetTotal)} /></Field>
            <Field label="Début" htmlFor="promo-start" error={errors.startsAt}><TextInput id="promo-start" type="datetime-local" value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} /></Field>
            <Field label="Fin" htmlFor="promo-end" error={errors.endsAt}><TextInput id="promo-end" type="datetime-local" value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} invalid={Boolean(errors.endsAt)} /></Field>
            <Field label="Priorité" htmlFor="promo-prio" error={errors.priority}><TextInput id="promo-prio" inputMode="numeric" value={form.priority} onChange={(e) => set('priority', e.target.value)} /></Field>
          </div>
        </fieldset>
        <fieldset className="space-y-3 rounded-k-md border border-kraveo-line p-4">
          <legend className="k-label px-1">Qui paie la remise ?</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Financement" htmlFor="promo-fund" error={errors.fundedBy} hint="« Le restaurant » et « Partagé » demandent le module « marketing.merchant_funded ».">
              <select id="promo-fund" className="k-input" value={form.fundedBy} onChange={(e) => set('fundedBy', e.target.value as PromotionForm['fundedBy'])}>{Object.entries(FUNDING_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
            </Field>
            {form.fundedBy !== 'PLATFORM' && <Field label="Part du restaurant (%)" htmlFor="promo-share" error={errors.merchantSharePct}><TextInput id="promo-share" inputMode="decimal" value={form.merchantSharePct} onChange={(e) => set('merchantSharePct', e.target.value)} invalid={Boolean(errors.merchantSharePct)} /></Field>}
          </div>
        </fieldset>
        <CheckRow id="promo-stack" label="Cumulable" hint="Peut se combiner avec une autre promotion (si le réglage le permet)." checked={form.stackable} onChange={(v) => set('stackable', v)} />
        <CheckRow id="promo-active" label="Active" hint="Décochez pour la mettre en pause sans la supprimer." checked={form.isActive} onChange={(v) => set('isActive', v)} />
      </form>
      {dialog}
    </Drawer>
  );
};

export const PromotionsPanel: React.FC<{ onAuthError: (e: unknown) => void; merchantOnly?: boolean }> = ({ onAuthError, merchantOnly = false }) => {
  const { data, loading, error, reload } = useLoad(() => apiService.fetchPromotions(1, 100), onAuthError);
  const [drawer, setDrawer] = useState<{ open: boolean; editing: Promotion | null }>({ open: false, editing: null });
  const rows = (data?.data ?? []).filter((p) => !merchantOnly || p.fundedBy !== 'PLATFORM');
  return (
    <div className="space-y-5">
      <PageHeader icon={BadgePercent} title={merchantOnly ? 'Offres restaurants' : 'Codes promo'} subtitle={merchantOnly ? 'Promotions financées en tout ou partie par les restaurants.' : 'Réductions, livraison offerte et offres de première commande.'}
        onRefresh={reload} refreshing={loading} actions={<button type="button" className="k-btn-accent" onClick={() => setDrawer({ open: true, editing: null })}><Plus className="h-4 w-4" aria-hidden="true" />Nouvelle promotion</button>} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <SkeletonCard lines={4} />}
      {data && rows.length === 0 && <div className="k-card p-6"><EmptyState icon={BadgePercent} title="Aucune promotion" description={merchantOnly ? 'Créez une promotion avec « Financement : Le restaurant » ou « Partagé » (module « marketing.merchant_funded » requis).' : 'Créez un code promo ou une offre de bienvenue pour vos clients.'} /></div>}
      {rows.length > 0 && (
        <div className="k-card overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-kraveo-line text-left"><th className="k-label px-4 py-3">Promotion</th><th className="k-label px-4 py-3">Remise</th><th className="k-label px-4 py-3">Financée par</th><th className="k-label px-4 py-3">Budget</th><th className="k-label px-4 py-3">Période</th><th className="k-label px-4 py-3">État</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const state = STATE[promotionState(p)];
                return (
                  <tr key={p.id} className="cursor-pointer border-b border-kraveo-line/60 last:border-0 hover:bg-kraveo-surface2" onClick={() => setDrawer({ open: true, editing: p })}>
                    <td className="px-4 py-3"><button type="button" className="text-left font-bold text-kraveo-ink hover:underline" onClick={(e) => { e.stopPropagation(); setDrawer({ open: true, editing: p }); }}>{p.name}</button><p className="font-mono text-[11px] text-kraveo-ink3">{p.code ?? 'automatique'} · {MODULE_LABEL[p.moduleCode] ?? p.moduleCode}</p></td>
                    <td className="px-4 py-3 text-kraveo-ink2">{promoValueLabel(p)}</td>
                    <td className="px-4 py-3 text-kraveo-ink2">{FUNDING_LABEL[p.fundedBy]}{p.fundedBy !== 'PLATFORM' ? ` (${p.merchantSharePct} %)` : ''}</td>
                    <td className="px-4 py-3 tabular-nums text-kraveo-ink2">{p.budgetTotal === null ? '—' : `${inr(p.budgetSpent)} / ${inr(p.budgetTotal)}`}</td>
                    <td className="px-4 py-3 text-kraveo-ink2">{p.startsAt || p.endsAt ? `${dateOnly(p.startsAt)} → ${p.endsAt ? dateOnly(p.endsAt) : '…'}` : 'Sans limite'}</td>
                    <td className="px-4 py-3"><Pill tone={state.tone}>{state.label}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <PromotionDrawer open={drawer.open} editing={drawer.editing} onClose={() => setDrawer({ open: false, editing: null })} onSaved={reload} onAuthError={onAuthError} />
    </div>
  );
};
