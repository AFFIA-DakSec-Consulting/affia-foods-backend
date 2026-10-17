import React, { useEffect, useState } from 'react';
import { Bike, Coins, Loader2, Plus, Ticket, Trash2 } from 'lucide-react';
import { apiService, ApiError } from '../services/api';
import { inr } from '../lib/tokens';
import {
  BONUS_TRIGGERS, BONUS_TRIGGER_LABEL, BonusTrigger, CourierBonus, LOYALTY_TRIGGERS, LOYALTY_TRIGGER_LABEL, LoyaltyRule, LoyaltyTrigger, SubscriptionPlan,
} from '../lib/platformParse';
import { Drawer } from './ui/Drawer';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { SkeletonCard } from './ui/Skeleton';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmDialog';
import { PageHeader } from './ui/PageToolbar';
import { CheckRow, ErrorBanner, Pill, TextInput, errorText, useLoad } from './platform/common';

// Small admin catalogues (subscription plans, loyalty rules, courier bonuses) share one list + drawer. Each screen describes its fields.

type Values = Record<string, string | boolean>;
export interface FieldSpec { key: string; label: string; kind: 'text' | 'int' | 'dec' | 'select' | 'time' | 'bool'; required?: boolean; hint?: string; options?: Array<[string, string]>; showWhen?: (v: Values) => boolean }
type Built = { ok: true; body: Record<string, unknown> } | { ok: false; field: string; message: string };

const text = (v: Values, k: string): string => String(v[k] ?? '').trim();

/** Reads the plain fields of a form into a body: numbers become numbers, empty optional fields become null. */
export const buildBody = (fields: FieldSpec[], v: Values): Built => {
  const body: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.showWhen && !f.showWhen(v)) continue;
    if (f.kind === 'bool') { body[f.key] = Boolean(v[f.key]); continue; }
    const raw = text(v, f.key);
    if (raw === '') {
      if (f.required) return { ok: false, field: f.key, message: 'Ce champ est obligatoire.' };
      if (f.kind !== 'time') body[f.key] = null;
      continue;
    }
    if (f.kind === 'int' || f.kind === 'dec') {
      const n = Number(raw.replace(',', '.'));
      if (!Number.isFinite(n) || (f.kind === 'int' && !Number.isInteger(n)) || n < 0) return { ok: false, field: f.key, message: f.kind === 'int' ? 'Saisissez un nombre entier (0 ou plus).' : 'Saisissez un nombre (0 ou plus).' };
      body[f.key] = n;
    } else if (f.kind === 'time') {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) return { ok: false, field: f.key, message: 'Format HH:MM, par exemple 22:00.' };
      body[f.key] = raw;
    } else body[f.key] = raw;
  }
  return { ok: true, body };
};

interface Item { id: string; name: string; isActive: boolean }
interface Config<T extends Item> {
  title: string; subtitle: string; icon: React.ElementType; noun: string; emptyText: string;
  fields: FieldSpec[];
  load: () => Promise<T[]>;
  save: (id: string | null, body: Record<string, unknown>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  initial: () => Values;
  toValues: (row: T) => Values;
  /** Extra fields that are not plain (e.g. bonus conditions). */
  finish?: (v: Values, body: Record<string, unknown>) => Built;
  summary: (row: T) => string;
  deleteHint: string;
}

function RulesScreen<T extends Item>({ cfg, onAuthError }: { cfg: Config<T>; onAuthError: (e: unknown) => void }) {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { data, loading, error, reload } = useLoad(cfg.load, onAuthError);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [values, setValues] = useState<Values>(cfg.initial());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setValues(editing ? cfg.toValues(editing) : cfg.initial()); setErrors({}); setGeneral('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  const set = (key: string, value: string | boolean) => { setValues((cur) => ({ ...cur, [key]: value })); setErrors((cur) => ({ ...cur, [key]: '' })); };
  const fail = (e: unknown) => { onAuthError(e); if (e instanceof ApiError && e.field) setErrors({ [e.field]: errorText(e) }); else setGeneral(errorText(e)); };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    let built = buildBody(cfg.fields, values);
    if (built.ok && cfg.finish) built = cfg.finish(values, built.body);
    if (!built.ok) { setErrors({ [built.field]: built.message }); return; }
    setBusy(true); setGeneral('');
    try { await cfg.save(editing?.id ?? null, built.body); toast.success(editing ? `${cfg.noun} mis à jour` : `${cfg.noun} créé`); setOpen(false); await reload(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!editing) return;
    if (!(await confirm({ title: `Supprimer « ${editing.name} » ?`, message: cfg.deleteHint, confirmLabel: 'Supprimer', danger: true }))) return;
    setBusy(true);
    try { await cfg.remove(editing.id); toast.success(`${cfg.noun} supprimé`); setOpen(false); await reload(); } catch (e) { fail(e); } finally { setBusy(false); }
  };

  const rows = data ?? [];
  return (
    <div className="space-y-5">
      <PageHeader icon={cfg.icon} title={cfg.title} subtitle={cfg.subtitle} onRefresh={reload} refreshing={loading}
        actions={<button type="button" className="k-btn-accent" onClick={() => { setEditing(null); setOpen(true); }}><Plus className="h-4 w-4" aria-hidden="true" />Ajouter</button>} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <SkeletonCard lines={3} />}
      {data && rows.length === 0 && <div className="k-card p-6"><EmptyState icon={cfg.icon} title={`Aucun ${cfg.noun.toLowerCase()}`} description={cfg.emptyText} /></div>}
      {rows.length > 0 && (
        <ul className="k-card divide-y divide-kraveo-line/60 overflow-hidden">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => { setEditing(r); setOpen(true); }} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-kraveo-surface2">
                <span className="min-w-0"><span className="block truncate font-bold text-kraveo-ink">{r.name}</span><span className="block truncate text-xs text-kraveo-ink3">{cfg.summary(r)}</span></span>
                <Pill tone={r.isActive ? 'green' : 'grey'}>{r.isActive ? 'Actif' : 'Désactivé'}</Pill>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Drawer open={open} onClose={() => setOpen(false)} title={editing ? editing.name : `Nouveau ${cfg.noun.toLowerCase()}`} icon={cfg.icon}
        footer={<div className="flex gap-3 pb-4">
          {editing && <button type="button" className="k-btn-danger" onClick={remove} disabled={busy} aria-label="Supprimer"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
          <button type="button" className="k-btn-ghost flex-1" onClick={() => setOpen(false)}>Annuler</button>
          <button type="submit" form="rules-form" className="k-btn-accent flex-1" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Enregistrer</button>
        </div>}>
        <form id="rules-form" onSubmit={submit} className="space-y-4" noValidate>
          {general && <ErrorBanner message={general} />}
          {cfg.fields.filter((f) => !f.showWhen || f.showWhen(values)).map((f) => {
            const id = `rule-${f.key}`;
            if (f.kind === 'bool') return <CheckRow key={f.key} id={id} label={f.label} hint={f.hint} checked={Boolean(values[f.key])} onChange={(v) => set(f.key, v)} />;
            return (
              <Field key={f.key} label={f.label} htmlFor={id} required={f.required} error={errors[f.key]} hint={f.hint}>
                {f.kind === 'select'
                  ? <select id={id} className="k-input" value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)}>{f.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  : <TextInput id={id} value={String(values[f.key] ?? '')} onChange={(e) => set(f.key, e.target.value)} invalid={Boolean(errors[f.key])} inputMode={f.kind === 'int' ? 'numeric' : f.kind === 'dec' ? 'decimal' : 'text'} placeholder={f.kind === 'time' ? '22:00' : undefined} />}
              </Field>
            );
          })}
        </form>
      </Drawer>
      {dialog}
    </div>
  );
}

// ───────────────────────── Subscription plans ─────────────────────────

const PLAN_FIELDS: FieldSpec[] = [
  { key: 'name', label: 'Nom du plan', kind: 'text', required: true },
  { key: 'description', label: 'Description', kind: 'text', required: true },
  { key: 'price', label: 'Prix (FCFA)', kind: 'int', required: true },
  { key: 'durationDays', label: 'Durée (jours)', kind: 'int', required: true, hint: 'Un changement de prix ou de durée ne touche que les futurs abonnements.' },
  { key: 'freeDeliveriesQuota', label: 'Livraisons offertes', kind: 'int', hint: 'Vide = illimité.' },
  { key: 'minCartAmount', label: 'Panier minimum (FCFA)', kind: 'int' },
  { key: 'maxDistanceKm', label: 'Distance max (km)', kind: 'dec' },
  { key: 'isActive', label: 'Plan actif', kind: 'bool', hint: 'Décochez pour le retirer de la vente sans toucher aux abonnés.' },
];

const planCfg: Config<SubscriptionPlan> = {
  title: 'Abonnements', subtitle: 'Plans de livraison offerte vendus aux clients.', icon: Ticket, noun: 'Plan', emptyText: 'Créez un plan d’abonnement pour proposer la livraison offerte.',
  fields: PLAN_FIELDS, load: () => apiService.fetchPlans(), save: (id, body) => apiService.savePlan(id, body), remove: (id) => apiService.deletePlan(id),
  initial: () => ({ name: '', description: '', price: '', durationDays: '30', freeDeliveriesQuota: '', minCartAmount: '', maxDistanceKm: '', isActive: true }),
  toValues: (p) => ({ name: p.name, description: p.description, price: String(p.price), durationDays: String(p.durationDays), freeDeliveriesQuota: p.freeDeliveriesQuota === null ? '' : String(p.freeDeliveriesQuota), minCartAmount: p.minCartAmount === null ? '' : String(p.minCartAmount), maxDistanceKm: p.maxDistanceKm === null ? '' : String(p.maxDistanceKm), isActive: p.isActive }),
  summary: (p) => `${inr(p.price)} pour ${p.durationDays} jours · ${p.freeDeliveriesQuota === null ? 'livraisons illimitées' : `${p.freeDeliveriesQuota} livraisons offertes`}`,
  deleteHint: 'Impossible si le plan a des abonnés : désactivez-le alors.',
};
export const PlansPanel: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => <RulesScreen cfg={planCfg} onAuthError={onAuthError} />;

// ───────────────────────── Loyalty rules ─────────────────────────

const LOYALTY_FIELDS: FieldSpec[] = [
  { key: 'name', label: 'Nom de la règle', kind: 'text', required: true },
  { key: 'description', label: 'Description', kind: 'text', required: true },
  { key: 'triggerType', label: 'Quand gagne-t-on des pièces ?', kind: 'select', options: LOYALTY_TRIGGERS.map((t) => [t, LOYALTY_TRIGGER_LABEL[t]]) },
  { key: 'coinsAmount', label: 'Pièces fixes', kind: 'int', hint: 'Renseignez les pièces fixes ou un pourcentage du panier (au moins un des deux).' },
  { key: 'coinsPercent', label: 'Pourcentage du panier (%)', kind: 'dec', showWhen: (v) => v.triggerType === 'ORDER_COMPLETED' },
  { key: 'minCart', label: 'Panier minimum (FCFA)', kind: 'int' },
  { key: 'maxCoins', label: 'Plafond de pièces', kind: 'int' },
  { key: 'isActive', label: 'Règle active', kind: 'bool' },
];

const loyaltyCfg: Config<LoyaltyRule> = {
  title: 'Fidélité', subtitle: 'Comment les clients gagnent des pièces Affia Foods.', icon: Coins, noun: 'Règle', emptyText: 'Ajoutez une règle pour récompenser les commandes, les inscriptions ou les avis.',
  fields: LOYALTY_FIELDS, load: () => apiService.fetchLoyaltyRules(), save: (id, body) => apiService.saveLoyaltyRule(id, body), remove: (id) => apiService.deleteLoyaltyRule(id),
  initial: () => ({ name: '', description: '', triggerType: 'ORDER_COMPLETED', coinsAmount: '', coinsPercent: '', minCart: '', maxCoins: '', isActive: true }),
  toValues: (r) => ({ name: r.name, description: r.description, triggerType: r.triggerType, coinsAmount: r.coinsAmount === null ? '' : String(r.coinsAmount), coinsPercent: r.coinsPercent === null ? '' : String(r.coinsPercent), minCart: r.minCart === null ? '' : String(r.minCart), maxCoins: r.maxCoins === null ? '' : String(r.maxCoins), isActive: r.isActive }),
  finish: (v, body) => (body.coinsAmount == null && body.coinsPercent == null ? { ok: false, field: 'coinsAmount', message: 'Renseignez des pièces fixes ou un pourcentage.' } : { ok: true, body }),
  summary: (r) => `${LOYALTY_TRIGGER_LABEL[r.triggerType as LoyaltyTrigger]} · ${[r.coinsAmount !== null ? `${r.coinsAmount} pièces` : '', r.coinsPercent !== null ? `${r.coinsPercent} % du panier` : ''].filter(Boolean).join(' + ')}`,
  deleteHint: 'Les pièces déjà distribuées ne sont pas touchées.',
};
export const LoyaltyPanel: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => <RulesScreen cfg={loyaltyCfg} onAuthError={onAuthError} />;

// ───────────────────────── Courier bonuses ─────────────────────────

const bonusCfg = (zones: Array<[string, string]>): Config<CourierBonus> => ({
  title: 'Primes livreurs', subtitle: 'Montants ajoutés au gain d’un livreur dans certaines situations.', icon: Bike, noun: 'Prime', emptyText: 'Ajoutez une prime pour la pluie, la nuit ou les heures de pointe.',
  fields: [
    { key: 'name', label: 'Nom de la prime', kind: 'text', required: true },
    { key: 'description', label: 'Description', kind: 'text', required: true },
    { key: 'triggerType', label: 'Déclencheur', kind: 'select', options: BONUS_TRIGGERS.map((t) => [t, BONUS_TRIGGER_LABEL[t]]) },
    { key: 'amount', label: 'Montant (FCFA)', kind: 'int', required: true },
    { key: 'from', label: 'De (heure)', kind: 'time', required: true, showWhen: (v) => v.triggerType === 'NIGHT' || v.triggerType === 'RUSH_HOUR' },
    { key: 'to', label: 'À (heure)', kind: 'time', required: true, showWhen: (v) => v.triggerType === 'NIGHT' || v.triggerType === 'RUSH_HOUR' },
    { key: 'zoneId', label: 'Zone concernée', kind: 'select', showWhen: (v) => v.triggerType === 'ZONE', options: zones.length > 0 ? zones : [['', 'Aucune zone : créez-en dans « Zones de livraison »']] },
    { key: 'isActive', label: 'Prime active', kind: 'bool' },
  ],
  load: () => apiService.fetchCourierBonuses(), save: (id, body) => apiService.saveCourierBonus(id, body), remove: (id) => apiService.deleteCourierBonus(id),
  initial: () => ({ name: '', description: '', triggerType: 'RAIN', amount: '', from: '', to: '', zoneId: zones[0]?.[0] ?? '', isActive: true }),
  toValues: (b) => ({ name: b.name, description: b.description, triggerType: b.triggerType, amount: String(b.amount), from: b.from, to: b.to, zoneId: b.zoneId || (zones[0]?.[0] ?? ''), isActive: b.isActive }),
  finish: (v, body) => {
    const t = v.triggerType as BonusTrigger;
    const { from, to, zoneId, ...rest } = body;
    if (t === 'NIGHT' || t === 'RUSH_HOUR') return { ok: true, body: { ...rest, conditions: { from, to } } };
    if (t === 'ZONE') return zoneId ? { ok: true, body: { ...rest, conditions: { zoneId } } } : { ok: false, field: 'zoneId', message: 'Choisissez une zone.' };
    return { ok: true, body: { ...rest, conditions: null } };
  },
  summary: (b) => `${BONUS_TRIGGER_LABEL[b.triggerType]} · +${inr(b.amount)}${b.from && b.to ? ` · ${b.from}–${b.to}` : ''}`,
  deleteHint: 'Les courses déjà payées ne sont pas modifiées.',
});

export const BonusesPanel: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const { data: zones } = useLoad(() => apiService.fetchZones('default'), onAuthError);
  const options: Array<[string, string]> = (zones ?? []).map((z) => [z.id, z.label]);
  // The screen is keyed on the zone list so the "zone" select is built from the real zones as soon as they are known.
  return <RulesScreen key={options.map((o) => o[0]).join(',')} cfg={bonusCfg(options)} onAuthError={onAuthError} />;
};

