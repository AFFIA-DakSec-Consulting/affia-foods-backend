import React, { useMemo, useState } from 'react';
import { Blocks, Loader2, Lock, SlidersHorizontal } from 'lucide-react';
import { apiService } from '../services/api';
import { ModuleSetting, PlatformModule } from '../lib/platformParse';
import { Drawer } from './ui/Drawer';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { SkeletonCard } from './ui/Skeleton';
import { Switch } from './ui/Switch';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmDialog';
import { PageHeader, UnderlineTabs } from './ui/PageToolbar';
import { ErrorBanner, Pill, TextInput, errorText, useLoad } from './platform/common';

const CATEGORY_LABEL: Record<string, string> = { delivery: 'Livraison', courier: 'Livreurs', marketing: 'Marketing', analytics: 'Analyses' };
const categoryLabel = (c: string) => CATEGORY_LABEL[c] ?? c;

/** Modules that lean on `code`: children, and modules that list it as a requirement. Used to warn before switching it off. */
export const dependentsOf = (code: string, modules: PlatformModule[]): PlatformModule[] =>
  modules.filter((m) => m.isEnabled && m.code !== code && (m.parentCode === code || m.requires.includes(code)));

// ───────────────────────── Settings of one module ─────────────────────────

const draftOf = (s: ModuleSetting): string => (s.valueType === 'json' ? JSON.stringify(s.value ?? null, null, 2) : s.valueType === 'boolean' ? String(Boolean(s.value)) : String(s.value ?? ''));

/** The value to send, or an error sentence the admin can read. */
export const settingValue = (s: ModuleSetting, draft: string): { ok: true; value: unknown } | { ok: false; message: string } => {
  if (s.valueType === 'boolean') return { ok: true, value: draft === 'true' };
  if (s.valueType === 'string') return { ok: true, value: draft };
  if (s.valueType === 'json') {
    try { return { ok: true, value: JSON.parse(draft) }; } catch { return { ok: false, message: 'Ce champ doit être un JSON valide, par exemple [{"from":"12:00","to":"14:00"}].' }; }
  }
  const text = draft.trim().replace(',', '.');
  const n = Number(text);
  if (text === '' || !Number.isFinite(n)) return { ok: false, message: 'Saisissez un nombre.' };
  if (s.valueType === 'money' && !Number.isInteger(n)) return { ok: false, message: 'Un montant est un nombre entier de FCFA.' };
  if (s.min !== null && n < s.min) return { ok: false, message: `Minimum : ${s.min}.` };
  if (s.max !== null && n > s.max) return { ok: false, message: `Maximum : ${s.max}.` };
  return { ok: true, value: n };
};

export const SettingRow: React.FC<{ moduleCode: string; setting: ModuleSetting; onSaved: (s: ModuleSetting) => void; onAuthError: (e: unknown) => void }> = ({ moduleCode, setting, onSaved, onAuthError }) => {
  const toast = useToast();
  const [draft, setDraft] = useState(draftOf(setting));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = draft !== draftOf(setting);
  const id = `setting-${setting.key}`;
  const hint = [setting.description, setting.unit ? `Unité : ${setting.unit}` : '', setting.min !== null || setting.max !== null ? `Entre ${setting.min ?? '…'} et ${setting.max ?? '…'}` : ''].filter(Boolean).join(' · ');

  const save = async () => {
    const parsed = settingValue(setting, draft);
    if (!parsed.ok) { setError(parsed.message); return; }
    setBusy(true); setError('');
    try {
      const out = await apiService.saveModuleSetting(moduleCode, setting.key, parsed.value);
      onSaved({ ...setting, value: out.value ?? parsed.value });
      setDraft(draftOf({ ...setting, value: out.value ?? parsed.value }));
      toast.success('Réglage enregistré', `${setting.label} : la nouvelle valeur s’applique tout de suite.`);
    } catch (e) {
      onAuthError(e);
      setError(errorText(e));
    } finally { setBusy(false); }
  };

  return (
    <div className="k-inset space-y-2 px-4 py-3">
      <Field label={setting.label} htmlFor={id} error={error} hint={hint}>
        {setting.valueType === 'boolean' ? (
          <div className="pt-1"><Switch checked={draft === 'true'} onChange={() => setDraft(draft === 'true' ? 'false' : 'true')} label={setting.label} /></div>
        ) : setting.valueType === 'json' ? (
          <textarea id={id} rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} aria-invalid={Boolean(error) || undefined} aria-describedby={`${id}-msg`} className="k-input font-mono text-xs" spellCheck={false} />
        ) : setting.valueType === 'string' && setting.options.length > 0 ? (
          <select id={id} value={draft} onChange={(e) => setDraft(e.target.value)} className="k-input">{setting.options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
        ) : (
          <TextInput id={id} type="text" inputMode={setting.valueType === 'string' ? 'text' : 'decimal'} value={draft} onChange={(e) => setDraft(e.target.value)} invalid={Boolean(error)} />
        )}
      </Field>
      <div className="flex justify-end">
        <button type="button" className="k-btn-accent !min-h-[36px] text-xs" disabled={!dirty || busy} onClick={save}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Enregistrer
        </button>
      </div>
    </div>
  );
};

const SettingsDrawer: React.FC<{ module: PlatformModule | null; onClose: () => void; onAuthError: (e: unknown) => void }> = ({ module, onClose, onAuthError }) => {
  const { data, setData, loading, error, reload } = useLoad(() => (module ? apiService.fetchModuleSettings(module.code) : Promise.resolve([])), onAuthError, [module?.code]);
  return (
    <Drawer open={Boolean(module)} onClose={onClose} title={module?.name ?? ''} subtitle={module?.code} icon={SlidersHorizontal} wide>
      {module && <p className="mb-4 text-sm text-kraveo-ink2">{module.description}</p>}
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <SkeletonCard lines={4} />}
      {data && data.length === 0 && <EmptyState icon={SlidersHorizontal} title="Aucun réglage" description="Ce module n’a pas de réglage à modifier." />}
      <div className="space-y-3">
        {module && data?.map((s) => <SettingRow key={s.key} moduleCode={module.code} setting={s} onAuthError={onAuthError} onSaved={(next) => setData((cur) => cur && cur.map((x) => (x.key === next.key ? next : x)))} />)}
      </div>
    </Drawer>
  );
};

// ───────────────────────── Page ─────────────────────────

export const ModulesPanel: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const { data, setData, loading, error, reload } = useLoad(() => apiService.fetchModules(), onAuthError);
  const [category, setCategory] = useState('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<PlatformModule | null>(null);
  const modules = data ?? [];

  const categories = useMemo(() => Array.from(new Set(modules.map((m) => m.category))), [modules]);
  const shown = modules.filter((m) => category === 'all' || m.category === category);
  const name = (code: string) => modules.find((m) => m.code === code)?.name ?? code;

  const toggle = async (m: PlatformModule) => {
    const enabling = !m.isEnabled;
    let cascade = false;
    if (!enabling) {
      const deps = dependentsOf(m.code, modules);
      if (deps.length > 0) {
        const ok = await confirm({ title: `Désactiver « ${m.name} » ?`, message: `Ces modules en dépendent et seront désactivés aussi : ${deps.map((d) => d.name).join(', ')}.`, confirmLabel: 'Tout désactiver', danger: true });
        if (!ok) return;
        cascade = true;
      } else {
        const ok = await confirm({ title: `Désactiver « ${m.name} » ?`, message: 'Le changement s’applique immédiatement à toute la plateforme.', confirmLabel: 'Désactiver', danger: true });
        if (!ok) return;
      }
    }
    setBusy(m.code);
    try {
      const out = await apiService.toggleModule(m.code, enabling, cascade);
      if (out.modules.length > 0) setData(out.modules);
      else await reload();
      toast.success(enabling ? 'Module activé' : 'Module désactivé', out.changed.length > 1 ? `${out.changed.length} modules modifiés.` : m.name);
    } catch (e) {
      onAuthError(e);
      toast.error('Changement refusé', errorText(e));
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={Blocks} title="Modules" subtitle="Activez ou coupez chaque fonctionnalité de la plateforme, sans déploiement." onRefresh={reload} refreshing={loading} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      <UnderlineTabs label="Catégories de modules" value={category} onChange={setCategory}
        tabs={[{ id: 'all', label: 'Tous', count: modules.length }, ...categories.map((c) => ({ id: c, label: categoryLabel(c), count: modules.filter((m) => m.category === c).length }))]} />
      {loading && !data && <div className="grid gap-4 md:grid-cols-2"><SkeletonCard /><SkeletonCard /></div>}
      {data && shown.length === 0 && <div className="k-card p-6"><EmptyState icon={Blocks} title="Aucun module" description="Le serveur n’a renvoyé aucun module." /></div>}
      <ul className="grid gap-4 md:grid-cols-2">
        {shown.map((m) => (
          <li key={m.code} className={`k-card flex flex-col gap-3 p-5 ${m.parentCode ? 'md:ml-6' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="flex flex-wrap items-center gap-2 text-base font-bold text-kraveo-ink">{m.name}{m.isCore && <Pill tone="blue"><Lock className="mr-1 h-3 w-3" aria-hidden="true" />Obligatoire</Pill>}</h3>
                <p className="mt-0.5 font-mono text-[11px] text-kraveo-ink3">{m.code}</p>
              </div>
              <Switch checked={m.isEnabled} onChange={() => toggle(m)} label={`${m.isEnabled ? 'Désactiver' : 'Activer'} ${m.name}`} disabled={m.isCore || busy === m.code} />
            </div>
            <p className="text-sm text-kraveo-ink2">{m.description}</p>
            {m.isEnabled && !m.effective && m.blockedBy.length > 0 && (
              <p className="rounded-k-sm bg-kraveo-status-placed/15 px-3 py-2 text-xs font-semibold text-kraveo-status-placed">Activé mais sans effet : en attente de {m.blockedBy.map(name).join(', ')}.</p>
            )}
            <div className="mt-auto flex items-center justify-between gap-2">
              <Pill tone={m.effective ? 'green' : m.isEnabled ? 'amber' : 'grey'}>{m.effective ? 'Actif' : m.isEnabled ? 'En attente' : 'Désactivé'}</Pill>
              {m.settingsCount > 0 && <button type="button" className="k-btn-ghost !min-h-[36px] text-xs" onClick={() => setOpen(m)}><SlidersHorizontal className="h-4 w-4" aria-hidden="true" />Réglages ({m.settingsCount})</button>}
            </div>
          </li>
        ))}
      </ul>
      <SettingsDrawer module={open} onClose={() => setOpen(null)} onAuthError={onAuthError} />
      {dialog}
    </div>
  );
};

