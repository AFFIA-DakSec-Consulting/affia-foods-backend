import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { apiService, SettingsGroup } from '../services/api';
import { parseSettlementSettings, PayoutProvider } from '../lib/financeParse';
import { validateSettlementSettings, MAX_HOLD_DAYS } from '../lib/financeInput';
import { Switch } from './ui/Switch';
import { asNum, parseFeeLines, RecalcResult } from '../lib/catalogParse';
import {
  CommissionType, DEFAULT_RESTAURANTS_PER_ORDER, FeesForm, MAX_EXTRA_RESTAURANT_FEE, MAX_RESTAURANTS_PER_ORDER, MIN_RESTAURANTS_PER_ORDER, ROUNDING_STEPS, RoundingStep, amountText, isRoundingStep, rupees, validateCommissionSetting, validateFees,
} from '../lib/pricing';
import { Field } from './ui/Field';
import { Skeleton } from './ui/Skeleton';
import { useConfirm } from './ui/ConfirmDialog';
import { useToast } from './ui/Toast';

interface Props {
  onAuthError: (error: unknown) => void;
}

type Raw = Record<string, unknown>;
/** What a save tells the panel: did anything change, and does the server recommend recalculating prices. */
interface Outcome { changed: boolean; recalculateRecommended: boolean; message: string }
type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; raw: Raw };

const plain = (error: unknown): string => (error instanceof Error ? error.message : 'Un problème est survenu. Veuillez réessayer.');

/** Loads one settings group and saves it back whole. */
const useGroup = (group: SettingsGroup, onAuthError: (error: unknown) => void) => {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    apiService.fetchSettings(group)
      .then((view) => { if (!cancelled) setLoad({ status: 'ready', raw: view.value }); })
      .catch((error) => {
        if (cancelled) return;
        onAuthError(error);
        setLoad({ status: 'error', message: plain(error) });
      });
    return () => { cancelled = true; };
  }, [group, attempt, onAuthError]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const saved = useCallback((raw: Raw) => setLoad({ status: 'ready', raw }), []);
  return { load, retry, saved };
};

const Card: React.FC<{ title: string; description: string; children: React.ReactNode; className?: string }> = ({ title, description, children, className = '' }) => (
  <section className={`k-card space-y-4 p-5 ${className}`} aria-label={title}>
    <header>
      <h2 className="font-display text-lg font-bold text-kraveo-ink">{title}</h2>
      <p className="mt-0.5 text-sm text-kraveo-ink2">{description}</p>
    </header>
    {children}
  </section>
);

const Loading: React.FC<{ load: Load; onRetry: () => void; children: (raw: Raw) => React.ReactNode }> = ({ load, onRetry, children }) => {
  if (load.status === 'loading') return <div role="status" aria-label="Chargement" className="space-y-3"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-2/3" /></div>;
  if (load.status === 'error') {
    return (
      <div role="alert" className="flex items-center justify-between gap-3 rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 px-4 py-3 text-sm text-kraveo-ink">
        <span className="min-w-0 break-words">{load.message}</span>
        <button type="button" className="k-btn-ghost !min-h-[36px] shrink-0 !px-3 text-xs" onClick={onRetry}>Réessayer</button>
      </div>
    );
  }
  return <>{children(load.raw)}</>;
};

const SaveBar: React.FC<{ dirty: boolean; saving: boolean; error: string; onSave: () => void; onUndo: () => void; note?: string }> = ({ dirty, saving, error, onSave, onUndo, note }) => (
  <div className="space-y-2">
    {error && <p role="alert" className="break-words rounded-k-sm border border-kraveo-danger/30 bg-kraveo-danger/10 px-3 py-2 text-sm text-kraveo-ink">{error}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" className="k-btn-primary" onClick={onSave} disabled={!dirty || saving} aria-busy={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Enregistrer</button>
      <button type="button" className="k-btn-ghost" onClick={onUndo} disabled={!dirty || saving}>Annuler les modifications</button>
      {dirty && !saving && <span className="text-xs font-semibold text-kraveo-status-placed">Modifications non enregistrées</span>}
      {!dirty && note && <span className="text-xs text-kraveo-ink3">{note}</span>}
    </div>
  </div>
);

// ───────────────────────────── Fees ─────────────────────────────

let rowCounter = 0;
const newRowId = () => { rowCounter += 1; return rowCounter; };

const feesFormFrom = (raw: Raw): FeesForm => ({
  baseFee: amountText(asNum(raw.baseFee)),
  lines: parseFeeLines(raw.lines).map((line) => ({ rowId: newRowId(), key: line.key, label: line.label, amount: amountText(line.amount) })),
  extraRestaurantFee: amountText(asNum(raw.extraRestaurantFee)),
  freeFeeAbove: amountText(asNum(raw.freeFeeAbove)),
  smallOrderBelow: amountText(asNum(raw.smallOrderBelow)),
  smallOrderFee: amountText(asNum(raw.smallOrderFee)),
  gstOnFeesPercent: amountText(asNum(raw.gstOnFeesPercent)),
  gstOnFoodPercent: amountText(asNum(raw.gstOnFoodPercent)),
  // A stored row from before Docs/22 has no value: the server then uses 3, so the form shows 3.
  maxRestaurantsPerOrder: raw.maxRestaurantsPerOrder === undefined || raw.maxRestaurantsPerOrder === null ? String(DEFAULT_RESTAURANTS_PER_ORDER) : amountText(asNum(raw.maxRestaurantsPerOrder)),
});

const MAX_OPTIONS = Array.from({ length: MAX_RESTAURANTS_PER_ORDER - MIN_RESTAURANTS_PER_ORDER + 1 }, (_, i) => String(MIN_RESTAURANTS_PER_ORDER + i));

/** Plain explanation under the "most restaurants" field, for the value currently chosen. */
const maxRestaurantsHint = (text: string): string => {
  const n = Number(text);
  if (n === 1) return 'Désactivé : les clients commandent dans un seul restaurant à la fois. Les commandes déjà passées ne sont pas concernées.';
  if (Number.isInteger(n) && n > 1 && n <= MAX_RESTAURANTS_PER_ORDER) {
    return `Les clients peuvent regrouper jusqu’à ${n} restaurants en un seul paiement : un paiement, un livreur, un code de livraison. Si un restaurant ne peut pas accepter, toute la commande est annulée et intégralement remboursée. 1 désactive cette option.`;
  }
  return `Choisissez un nombre entier de ${MIN_RESTAURANTS_PER_ORDER} à ${MAX_RESTAURANTS_PER_ORDER}. 1 désactive les commandes groupées.`;
};

const feesKey = (form: FeesForm): string => JSON.stringify({ ...form, lines: form.lines.map(({ label, amount }) => [label, amount]) });

const FeesCard: React.FC<{ raw: Raw; onSaved: (raw: Raw, outcome: Outcome) => void; onDirty: (dirty: boolean) => void; onAuthError: (error: unknown) => void }> = ({ raw, onSaved, onDirty, onAuthError }) => {
  const toast = useToast();
  const [form, setForm] = useState<FeesForm>(() => feesFormFrom(raw));
  const [baseline, setBaseline] = useState(() => feesKey(feesFormFrom(raw)));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const result = useMemo(() => validateFees(form), [form]);
  const dirty = feesKey(form) !== baseline;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);
  const maxHint = maxRestaurantsHint(form.maxRestaurantsPerOrder);

  const field = (key: keyof Omit<FeesForm, 'lines'>) => (event: React.ChangeEvent<HTMLInputElement>) => { setForm((f) => ({ ...f, [key]: event.target.value })); setError(''); };
  const err = (key: keyof Omit<FeesForm, 'lines'>) => (touched ? (result.errors[key] as string | undefined) : undefined);
  const input = (key: keyof Omit<FeesForm, 'lines'>, id: string) => (
    <input id={id} className="k-input" inputMode="decimal" value={form[key]} onChange={field(key)} aria-invalid={Boolean(err(key))} aria-describedby={`${id}-msg`} autoComplete="off" />
  );
  const setLine = (rowId: number, patch: Partial<{ label: string; amount: string }>) => { setForm((f) => ({ ...f, lines: f.lines.map((line) => (line.rowId === rowId ? { ...line, ...patch } : line)) })); setError(''); };

  const save = async () => {
    setTouched(true);
    if (!result.ok || !result.value || savingRef.current) { if (!result.ok) setError('Corrigez d’abord les champs signalés.'); return; }
    savingRef.current = true; setSaving(true); setError('');
    try {
      const saved = await apiService.saveSettings('fees', { ...raw, ...result.value });
      const next = feesFormFrom(saved.value);
      setForm(next); setBaseline(feesKey(next)); setTouched(false);
      onSaved(saved.value, saved);
      toast.success('Frais enregistrés', 'Les nouvelles commandes utilisent ces frais.');
    } catch (failure) {
      onAuthError(failure);
      setError(plain(failure));
    } finally { savingRef.current = false; setSaving(false); }
  };
  const undo = () => { const original = feesFormFrom(raw); setForm(original); setBaseline(feesKey(original)); setTouched(false); setError(''); };

  const linesTotalLabel = form.lines.length > 0 ? `Total des lignes : ${rupees(result.lineTotal)}` : '';

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Frais tout compris par commande (FCFA)" htmlFor="fee-base" required error={err('baseFee')} hint="Une seule ligne pour le client : livraison, TVA, emballage et frais du restaurant réunis.">{input('baseFee', 'fee-base')}</Field>
        <Field label="Frais par restaurant supplémentaire (FCFA)" htmlFor="fee-extra" required error={err('extraRestaurantFee')} hint={`Ajoutés une fois pour chaque restaurant après le premier dans une commande groupée (0 à ${MAX_EXTRA_RESTAURANT_FEE}). Exemple : 100 FCFA et 3 restaurants ajoutent 200 FCFA aux frais tout compris. Non utilisé tant que les commandes groupées sont désactivées.`}>{input('extraRestaurantFee', 'fee-extra')}</Field>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Nombre maximum de restaurants par commande" htmlFor="fee-max-restaurants" required error={err('maxRestaurantsPerOrder')} hint={maxHint}>
          <select
            id="fee-max-restaurants"
            className="k-select"
            value={form.maxRestaurantsPerOrder}
            onChange={(event) => { setForm((f) => ({ ...f, maxRestaurantsPerOrder: event.target.value })); setError(''); }}
            aria-invalid={Boolean(err('maxRestaurantsPerOrder'))}
            aria-describedby="fee-max-restaurants-msg"
          >
            {/* A stored value outside 1-5 stays visible (and fails validation) instead of silently showing another number. */}
            {!MAX_OPTIONS.includes(form.maxRestaurantsPerOrder) && <option value={form.maxRestaurantsPerOrder}>{form.maxRestaurantsPerOrder || 'Non défini'} (non autorisé)</option>}
            {MAX_OPTIONS.map((value) => <option key={value} value={value}>{value === '1' ? '1 (commandes groupées désactivées)' : value}</option>)}
          </select>
        </Field>
      </div>

      <fieldset className="space-y-3">
        <legend className="k-label mb-1">Lignes détaillées (facultatif, pour la comptabilité)</legend>
        <p className="text-xs text-kraveo-ink3">Le client ne voit toujours qu’un seul montant de frais. Si vous ajoutez des lignes, leur total doit être exactement égal aux frais tout compris.</p>
        {form.lines.map((line, index) => {
          const lineErr = touched ? result.errors.lineErrors?.[line.rowId] : undefined;
          return (
            <div key={line.rowId} className="grid grid-cols-[1fr_7rem_auto] items-start gap-2">
              <Field label={`Nom de la ligne ${index + 1}`} htmlFor={`fee-line-label-${line.rowId}`} error={lineErr?.label}>
                <input id={`fee-line-label-${line.rowId}`} className="k-input" value={line.label} maxLength={40} onChange={(e) => setLine(line.rowId, { label: e.target.value })} aria-invalid={Boolean(lineErr?.label)} aria-describedby={`fee-line-label-${line.rowId}-msg`} autoComplete="off" />
              </Field>
              <Field label="FCFA" htmlFor={`fee-line-amount-${line.rowId}`} error={lineErr?.amount}>
                <input id={`fee-line-amount-${line.rowId}`} className="k-input" inputMode="decimal" value={line.amount} onChange={(e) => setLine(line.rowId, { amount: e.target.value })} aria-invalid={Boolean(lineErr?.amount)} aria-describedby={`fee-line-amount-${line.rowId}-msg`} autoComplete="off" />
              </Field>
              <button type="button" className="k-icon-btn mt-[1.45rem]" aria-label={`Supprimer la ligne ${index + 1}`} onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((l) => l.rowId !== line.rowId) }))}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="k-btn-ghost !min-h-[36px] text-xs" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, { rowId: newRowId(), label: '', amount: '' }] }))}><Plus className="h-4 w-4" aria-hidden="true" />Ajouter une ligne</button>
          {linesTotalLabel && <span className={`text-xs font-semibold ${touched && result.errors.lines ? 'text-kraveo-danger' : 'text-kraveo-ink2'}`} aria-live="polite">{linesTotalLabel}</span>}
        </div>
        {touched && result.errors.lines && <p role="alert" className="text-xs font-semibold text-kraveo-danger">{result.errors.lines}</p>}
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Livraison gratuite à partir de (FCFA, 0 = désactivé)" htmlFor="fee-free" error={err('freeFeeAbove')} hint="Les commandes dont les repas atteignent ce montant ne paient pas de frais.">{input('freeFeeAbove', 'fee-free')}</Field>
        <div className="hidden sm:block" />
        <Field label="Petite commande en dessous de (FCFA, 0 = désactivé)" htmlFor="fee-small-below" error={err('smallOrderBelow')}>{input('smallOrderBelow', 'fee-small-below')}</Field>
        <Field label="Frais de petite commande (FCFA)" htmlFor="fee-small" error={err('smallOrderFee')} hint="Ajoutés quand le total des repas est sous le seuil.">{input('smallOrderFee', 'fee-small')}</Field>
        <Field label="TVA sur les frais (%) – pour la comptabilité" htmlFor="fee-gst-fees" error={err('gstOnFeesPercent')} hint="À titre indicatif en attendant la décision du comptable.">{input('gstOnFeesPercent', 'fee-gst-fees')}</Field>
        <Field label="TVA sur les repas (%) – pour la comptabilité" htmlFor="fee-gst-food" error={err('gstOnFoodPercent')} hint="À titre indicatif.">{input('gstOnFoodPercent', 'fee-gst-food')}</Field>
      </div>
      <SaveBar dirty={dirty} saving={saving} error={error} onSave={save} onUndo={undo} />
    </div>
  );
};

// ───────────────────────────── Commission ─────────────────────────────

const CommissionCard: React.FC<{ raw: Raw; onSaved: (raw: Raw, outcome: Outcome) => void; onDirty: (dirty: boolean) => void; onAuthError: (error: unknown) => void }> = ({ raw, onSaved, onDirty, onAuthError }) => {
  const toast = useToast();
  const initialType: CommissionType = raw.type === 'FLAT' ? 'FLAT' : 'PERCENT';
  const [type, setType] = useState<CommissionType>(initialType);
  const [value, setValue] = useState(amountText(asNum(raw.value)));
  const [baseline, setBaseline] = useState(`${initialType}|${amountText(asNum(raw.value))}`);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const checked = validateCommissionSetting(type, value);
  const dirty = `${type}|${value.trim()}` !== baseline;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);

  const save = async () => {
    setTouched(true);
    if (!checked.ok || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const saved = await apiService.saveSettings('commission', { ...raw, type: checked.value.type, value: checked.value.value });
      const stored = saved.value;
      const t: CommissionType = stored.type === 'FLAT' ? 'FLAT' : stored.type === 'PERCENT' ? 'PERCENT' : checked.value.type;
      const v = amountText(asNum(stored.value) ?? checked.value.value);
      setType(t); setValue(v); setBaseline(`${t}|${v}`); setTouched(false);
      onSaved(stored, saved);
      toast.success('Commission enregistrée', saved.message || 'Le prix des plats change quand vous lancez « Recalculer les prix » ci-dessous.');
    } catch (failure) {
      onAuthError(failure);
      setError(plain(failure));
    } finally { savingRef.current = false; setSaving(false); }
  };
  const undo = () => { const t: CommissionType = initialType; setType(t); setValue(amountText(asNum(raw.value))); setBaseline(`${t}|${amountText(asNum(raw.value))}`); setTouched(false); setError(''); };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Type de commission" htmlFor="commission-type">
          <select id="commission-type" className="k-select" value={type} onChange={(e) => { setType(e.target.value as CommissionType); setError(''); }}>
            <option value="PERCENT">Pourcentage du prix restaurant</option>
            <option value="FLAT">Montant fixe en FCFA par plat</option>
          </select>
        </Field>
        <Field label={type === 'PERCENT' ? 'Pourcentage (%)' : 'Montant par plat (FCFA)'} htmlFor="commission-value" required error={touched && !checked.ok ? checked.message : undefined}>
          <input id="commission-value" className="k-input" inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); setError(''); }} aria-invalid={touched && !checked.ok} aria-describedby="commission-value-msg" autoComplete="off" />
        </Field>
      </div>
      <p className="text-xs text-kraveo-ink3">Un restaurant ou un plat peut avoir sa propre commission ; la plus spécifique l’emporte. Celle-ci s’applique par défaut à tout le reste.</p>
      <SaveBar dirty={dirty} saving={saving} error={error} onSave={save} onUndo={undo} />
    </div>
  );
};

// ───────────────────────────── Rounding ─────────────────────────────

const STEP_LABEL: Record<RoundingStep, string> = { 0: 'Pas d’arrondi', 1: 'Arrondir au FCFA supérieur', 2: 'Arrondir au multiple de 2 FCFA supérieur', 5: 'Arrondir au multiple de 5 FCFA supérieur', 10: 'Arrondir au multiple de 10 FCFA supérieur' };

const RoundingCard: React.FC<{ raw: Raw; onSaved: (raw: Raw, outcome: Outcome) => void; onDirty: (dirty: boolean) => void; onAuthError: (error: unknown) => void }> = ({ raw, onSaved, onDirty, onAuthError }) => {
  const toast = useToast();
  const current = isRoundingStep(raw.step) ? raw.step : null;
  const [step, setStep] = useState<RoundingStep | null>(current);
  const [baseline, setBaseline] = useState<RoundingStep | null>(current);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const dirty = step !== baseline;
  useEffect(() => { onDirty(dirty); }, [dirty, onDirty]);

  const save = async () => {
    if (step === null || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const saved = await apiService.saveSettings('rounding', { ...raw, step });
      const next = isRoundingStep(saved.value.step) ? saved.value.step : step;
      setStep(next); setBaseline(next);
      onSaved(saved.value, saved);
      toast.success('Arrondi enregistré', saved.message || 'Le prix des plats change quand vous lancez « Recalculer les prix » ci-dessous.');
    } catch (failure) {
      onAuthError(failure);
      setError(plain(failure));
    } finally { savingRef.current = false; setSaving(false); }
  };

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="Pas d’arrondi" className="space-y-2">
        {ROUNDING_STEPS.map((option) => (
          <label key={option} className={`k-inset flex cursor-pointer items-center gap-3 px-4 py-3 text-sm font-bold ${step === option ? 'border-kraveo-g400/60 text-kraveo-g700' : 'text-kraveo-ink'}`}>
            <input type="radio" name="rounding-step" className="h-4 w-4 accent-kraveo-g400" checked={step === option} onChange={() => { setStep(option); setError(''); }} />
            {STEP_LABEL[option]}
          </label>
        ))}
      </div>
      {step === null && <p className="text-xs text-kraveo-danger">Le serveur n’a pas indiqué de pas d’arrondi. Choisissez-en un et enregistrez.</p>}
      <p className="text-xs text-kraveo-ink3">Le prix client est arrondi à ce pas, vers le haut. Les FCFA en plus comptent comme commission Affia Foods.</p>
      <SaveBar dirty={dirty} saving={saving} error={error} onSave={save} onUndo={() => { setStep(baseline); setError(''); }} />
    </div>
  );
};

// ───────────────────────────── Recalculate ─────────────────────────────

const RecalcCard: React.FC<{ settingsVersion: number; recommended: boolean; onSettled: () => void; unsaved: boolean; onAuthError: (error: unknown) => void }> = ({ settingsVersion, recommended, onSettled, unsaved, onAuthError }) => {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [preview, setPreview] = useState<RecalcResult | null>(null);
  const [busy, setBusy] = useState<null | 'preview' | 'apply'>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState('');

  // Settings changed after the preview: the number on screen is no longer true.
  useEffect(() => { setPreview(null); setError(''); }, [settingsVersion]);

  const runPreview = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy('preview'); setError('');
    try {
      const result = await apiService.recalculatePrices(true);
      setPreview(result);
      if (result.changed === 0) onSettled(); // nothing is out of date any more
      if (result.changed === null) setError('Le serveur n’a pas indiqué combien de plats changeraient : les prix ne peuvent donc pas être recalculés d’ici.');
    } catch (failure) {
      onAuthError(failure);
      setPreview(null);
      setError(plain(failure));
    } finally { busyRef.current = false; setBusy(null); }
  };

  const apply = async () => {
    if (busyRef.current || !preview || preview.changed === null || preview.changed <= 0) return;
    const count = preview.changed;
    const ok = await confirm({
      title: `Modifier le prix de ${count} ${count === 1 ? 'plat' : 'plats'} ?`,
      message: 'Les clients voient immédiatement les nouveaux prix. Les commandes déjà passées gardent leurs prix d’origine. Cette action ne s’annule pas en un clic.',
      confirmLabel: 'Recalculer les prix',
      danger: true,
    });
    if (!ok || busyRef.current) return;
    busyRef.current = true; setBusy('apply'); setError('');
    try {
      const result = await apiService.recalculatePrices(false);
      toast.success('Prix recalculés', result.changed !== null ? `${result.changed} ${result.changed === 1 ? 'plat mis à jour' : 'plats mis à jour'}.` : 'Le serveur n’a pas indiqué combien de plats ont changé.');
      setPreview(null);
      onSettled();
    } catch (failure) {
      onAuthError(failure);
      setError(plain(failure));
    } finally { busyRef.current = false; setBusy(null); }
  };

  const changed = preview?.changed ?? null;
  return (
    <div className="space-y-4">
      {recommended && !unsaved && <p role="status" className="rounded-k-sm border border-kraveo-status-placed/40 bg-kraveo-status-placed/10 px-3 py-2 text-sm text-kraveo-ink">Les plats existants gardent leur ancien prix tant que vous ne recalculez pas. Prévisualisez le changement ci-dessous.</p>}
      {unsaved && <p className="rounded-k-sm border border-kraveo-status-placed/40 bg-kraveo-status-placed/10 px-3 py-2 text-sm text-kraveo-ink">Enregistrez d’abord vos changements de commission ou d’arrondi. Le recalcul utilise les réglages enregistrés.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="k-btn-ghost" onClick={runPreview} disabled={busy !== null || unsaved} aria-busy={busy === 'preview'}>{busy === 'preview' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Prévisualiser les changements</button>
        <button type="button" className="k-btn-danger" onClick={apply} disabled={busy !== null || unsaved || changed === null || changed <= 0} aria-busy={busy === 'apply'}>{busy === 'apply' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Recalculer les prix{changed ? ` (${changed})` : ''}</button>
      </div>
      {error && <p role="alert" className="break-words rounded-k-sm border border-kraveo-danger/30 bg-kraveo-danger/10 px-3 py-2 text-sm text-kraveo-ink">{error}</p>}
      {preview && changed !== null && (
        <div className="k-inset space-y-2 p-4" aria-live="polite" data-testid="recalc-preview">
          <p className="text-sm text-kraveo-ink">
            {changed === 0 ? 'Aucun plat ne changerait. Les prix correspondent déjà aux réglages.' : <><b className="tabular-nums">{changed}</b>{preview.total !== null ? <> sur <b className="tabular-nums">{preview.total}</b></> : null} {changed === 1 && preview.total === null ? 'plat changerait' : 'plats changeraient'} de prix.</>}
          </p>
          {preview.truncated && <p className="text-xs font-semibold text-kraveo-status-placed">Seuls les premiers changements sont listés. Le total ci-dessus est complet.</p>}
          {preview.samples.length > 0 && (
            <ul className="space-y-1 text-xs text-kraveo-ink2">
              {preview.samples.map((sample, index) => <li key={index} className="flex justify-between gap-3"><span className="min-w-0 break-words">{sample.name}{sample.vendorName ? ` (${sample.vendorName})` : ''}</span><span className="shrink-0 tabular-nums">{rupees(sample.from)} → {rupees(sample.to)}</span></li>)}
            </ul>
          )}
        </div>
      )}
      <p className="text-xs text-kraveo-ink3">Prévisualisez d’abord : rien ne change avant votre confirmation. Les plats reçoivent aussi le bon prix quand ils sont validés ou modifiés.</p>
      {dialog}
    </div>
  );
};

// ───────────────────────────── Settlements ─────────────────────────────

type Providers = { status: 'loading' } | { status: 'error' } | { status: 'ready'; list: PayoutProvider[] };

const SettlementCard: React.FC<{ raw: Raw; onSaved: (raw: Raw) => void; onAuthError: (error: unknown) => void }> = ({ raw, onSaved, onAuthError }) => {
  const toast = useToast();
  const initial = parseSettlementSettings(raw);
  const toForm = (v: ReturnType<typeof parseSettlementSettings>) => ({ time: v.time ?? '', mode: v.mode ?? '', autoCreate: v.autoCreate ?? false, holdDays: v.holdDays === null ? '' : String(v.holdDays) });
  const [form, setForm] = useState(() => toForm(initial));
  const [baseline, setBaseline] = useState(() => JSON.stringify(toForm(initial)));
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const [providers, setProviders] = useState<Providers>({ status: 'loading' });
  const checked = validateSettlementSettings(form);
  const errors = !checked.ok ? checked.errors : {};
  const dirty = JSON.stringify(form) !== baseline;

  useEffect(() => {
    let cancelled = false;
    apiService.fetchPayoutProviders()
      .then((list) => { if (!cancelled) setProviders({ status: 'ready', list }); })
      .catch((failure) => { if (cancelled) return; onAuthError(failure); setProviders({ status: 'error' }); });
    return () => { cancelled = true; };
  }, [onAuthError]);

  const razorpayx = providers.status === 'ready' ? providers.list.find((p) => p.name === 'razorpayx') : undefined;
  // Automatic payout is only offered when the server says a provider that can send money is switched on.
  const autoBlocked = providers.status === 'ready' && !razorpayx?.enabled;

  const save = async () => {
    setTouched(true);
    if (!checked.ok || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError('');
    try {
      const saved = await apiService.saveSettings('settlement', { ...checked.value });
      const next = toForm(parseSettlementSettings(saved.value));
      setForm(next); setBaseline(JSON.stringify(next)); setTouched(false);
      onSaved(saved.value);
      toast.success('Réglages des règlements enregistrés', saved.message || 'La tâche quotidienne utilise désormais ces réglages.');
    } catch (failure) {
      onAuthError(failure);
      setError(plain(failure)); // the server's own words, e.g. "Automatic payout is not available yet"
    } finally { savingRef.current = false; setSaving(false); }
  };
  const undo = () => { setForm(JSON.parse(baseline)); setTouched(false); setError(''); };
  const shown = (key: 'time' | 'mode' | 'holdDays') => (touched ? (errors as Record<string, string>)[key] : undefined);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Heure du règlement quotidien (heure IST, HH:MM)" htmlFor="settle-time" required error={shown('time')} hint="Les commandes livrées jusqu’à cette heure sont regroupées dans les règlements du jour.">
          <input id="settle-time" className="k-input" inputMode="numeric" placeholder="22:00" value={form.time} onChange={(e) => { setForm((f) => ({ ...f, time: e.target.value })); setError(''); }} aria-invalid={Boolean(shown('time'))} aria-describedby="settle-time-msg" autoComplete="off" />
        </Field>
        <Field label={`Jours de rétention (0 à ${MAX_HOLD_DAYS})`} htmlFor="settle-hold" required error={shown('holdDays')} hint="Les commandes doivent avoir au moins ce nombre de jours avant d’être réglées.">
          <input id="settle-hold" className="k-input" inputMode="numeric" value={form.holdDays} onChange={(e) => { setForm((f) => ({ ...f, holdDays: e.target.value })); setError(''); }} aria-invalid={Boolean(shown('holdDays'))} aria-describedby="settle-hold-msg" autoComplete="off" />
        </Field>
      </div>

      <fieldset className="space-y-2">
        <legend className="k-label mb-1">Mode de paiement des règlements</legend>
        <div role="radiogroup" aria-label="Mode de versement" className="space-y-2">
          <label className={`k-inset flex cursor-pointer items-start gap-3 px-4 py-3 text-sm ${form.mode === 'MANUAL_PAYOUT' ? 'border-kraveo-g400/60' : ''}`}>
            <input type="radio" name="settle-mode" className="mt-0.5 h-4 w-4 accent-kraveo-g400" checked={form.mode === 'MANUAL_PAYOUT'} onChange={() => { setForm((f) => ({ ...f, mode: 'MANUAL_PAYOUT' })); setError(''); }} />
            <span><b className="text-kraveo-ink">Versement manuel</b><span className="block text-xs text-kraveo-ink3">Vous payez par virement ou UPI et enregistrez la référence sur chaque règlement.</span></span>
          </label>
          <label className={`k-inset flex items-start gap-3 px-4 py-3 text-sm ${autoBlocked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'} ${form.mode === 'AUTO_PAYOUT' ? 'border-kraveo-g400/60' : ''}`}>
            <input type="radio" name="settle-mode" className="mt-0.5 h-4 w-4 accent-kraveo-g400" checked={form.mode === 'AUTO_PAYOUT'} disabled={autoBlocked} aria-describedby="settle-auto-note" onChange={() => { setForm((f) => ({ ...f, mode: 'AUTO_PAYOUT' })); setError(''); }} />
            <span><b className="text-kraveo-ink">Versement automatique</b><span className="block text-xs text-kraveo-ink3">L’argent est envoyé via un prestataire de versement.</span></span>
          </label>
        </div>
        <p id="settle-auto-note" className={`text-xs ${autoBlocked ? 'font-semibold text-kraveo-status-placed' : 'text-kraveo-ink3'}`}>
          {providers.status === 'loading' && 'Vérification des prestataires de versement disponibles.'}
          {providers.status === 'error' && 'Impossible de vérifier les prestataires de versement. Si le versement automatique n’est pas disponible, le serveur refusera de l’enregistrer.'}
          {providers.status === 'ready' && (autoBlocked ? `Le versement automatique n’est pas disponible : ${razorpayx?.reason ?? 'aucun prestataire de versement n’est configuré.'} Utilisez le versement manuel tant que le prestataire n’est pas connecté.` : 'Un prestataire de versement est connecté.')}
        </p>
        {shown('mode') && <p role="alert" className="text-xs font-semibold text-kraveo-danger">{shown('mode')}</p>}
      </fieldset>

      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-kraveo-ink">Créer les règlements chaque jour</p>
          <p className="text-xs text-kraveo-ink3">Si désactivé, rien n’est créé tant que vous ne cliquez pas sur « Créer les règlements maintenant » dans Finances.</p>
        </div>
        <Switch checked={form.autoCreate} onChange={() => { setForm((f) => ({ ...f, autoCreate: !f.autoCreate })); setError(''); }} label="Créer les règlements chaque jour" />
      </div>
      <SaveBar dirty={dirty} saving={saving} error={error} onSave={save} onUndo={undo} />
    </div>
  );
};

// ───────────────────────────── Panel ─────────────────────────────

export const SettingsPanel: React.FC<Props> = ({ onAuthError }) => {
  const fees = useGroup('fees', onAuthError);
  const commission = useGroup('commission', onAuthError);
  const rounding = useGroup('rounding', onAuthError);
  const settlement = useGroup('settlement', onAuthError);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [pricingChanged, setPricingChanged] = useState(0);
  const [recommended, setRecommended] = useState(false);
  const markDirty = (group: string) => (value: boolean) => setDirty((current) => (current[group] === value ? current : { ...current, [group]: value }));
  const dirtyFees = useMemo(() => markDirty('fees'), []);
  const dirtyCommission = useMemo(() => markDirty('commission'), []);
  const dirtyRounding = useMemo(() => markDirty('rounding'), []);

  const onPricingSaved = (save: (raw: Raw) => void) => (raw: Raw, outcome: Outcome) => {
    save(raw);
    if (outcome.changed) setPricingChanged((n) => n + 1); // an older preview no longer describes the new settings
    if (outcome.recalculateRecommended) setRecommended(true);
  };
  const settled = useCallback(() => setRecommended(false), []);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Card title="Frais" description="Ce que le client paie en plus des repas. Tous les montants viennent d’ici, pas du code de l’application.">
        <Loading load={fees.load} onRetry={fees.retry}>{(raw) => <FeesCard raw={raw} onSaved={fees.saved} onDirty={dirtyFees} onAuthError={onAuthError} />}</Loading>
      </Card>
      <Card title="Commission par défaut" description="La part de AFFIA FOODSen plus du prix du restaurant, sauf si le restaurant ou le plat a la sienne.">
        <Loading load={commission.load} onRetry={commission.retry}>{(raw) => <CommissionCard raw={raw} onSaved={onPricingSaved(commission.saved)} onDirty={dirtyCommission} onAuthError={onAuthError} />}</Loading>
      </Card>
      <Card title="Arrondi des prix" description="Les prix clients sont arrondis vers le haut à un montant rond.">
        <Loading load={rounding.load} onRetry={rounding.retry}>{(raw) => <RoundingCard raw={raw} onSaved={onPricingSaved(rounding.saved)} onDirty={dirtyRounding} onAuthError={onAuthError} />}</Loading>
      </Card>
      <Card title="Recalculer les prix" description="Après avoir changé la commission par défaut, la commission d’un restaurant ou l’arrondi, appliquez les nouveaux prix aux plats déjà au menu.">
        <RecalcCard settingsVersion={pricingChanged} recommended={recommended} onSettled={settled} unsaved={Boolean(dirty.commission || dirty.rounding)} onAuthError={onAuthError} />
      </Card>
      <Card title="Règlements" description="Quand les règlements des restaurants sont créés et comment ils sont payés. Les changements s’appliquent dès la prochaine exécution quotidienne.">
        <Loading load={settlement.load} onRetry={settlement.retry}>{(raw) => <SettlementCard raw={raw} onSaved={settlement.saved} onAuthError={onAuthError} />}</Loading>
      </Card>
    </div>
  );
};

