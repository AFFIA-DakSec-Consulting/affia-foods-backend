import React, { useEffect, useState } from 'react';
import { Check, Globe2, Loader2, MapPin, MapPinned, Pencil, Plus, ShieldAlert, Trash2, X } from 'lucide-react';
import { apiService, ApiError } from '../services/api';
import { AreaForm, PointCheck, ServiceArea, areaBody } from '../lib/platformParse';
import { SENEGAL_CITIES, cityByName } from '../lib/senegalCities';
import { Drawer } from './ui/Drawer';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { SkeletonCard } from './ui/Skeleton';
import { Switch } from './ui/Switch';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmDialog';
import { PageHeader } from './ui/PageToolbar';
import { ErrorBanner, Pill, TextInput, errorText, useLoad } from './platform/common';
import { ModuleSettingsGroups } from './AdminExtraPages';

const MODULE = 'delivery.service_areas';
type Mode = 'COUNTRY' | 'AREAS';

const emptyForm = (): AreaForm => ({ name: '', lat: '', lng: '', radiusKm: '10', isActive: true });
const formOf = (a: ServiceArea): AreaForm => ({ name: a.name, lat: String(a.lat), lng: String(a.lng), radiusKm: String(a.radiusKm), isActive: a.isActive });
const km = (n: number) => `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;

const CityPicker: React.FC<{ id: string; label?: string; onPick: (name: string) => void }> = ({ id, label = 'Ville', onPick }) => (
  <Field label={label} htmlFor={id} hint="Remplit le centre et un rayon conseillé. Vous pouvez les modifier.">
    <select id={id} className="k-input" defaultValue="" onChange={(e) => { if (e.target.value) onPick(e.target.value); }}>
      <option value="">Choisir une ville…</option>
      {SENEGAL_CITIES.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
    </select>
  </Field>
);

const AreaDrawer: React.FC<{ open: boolean; editing: ServiceArea | null; onClose: () => void; onSaved: () => void; onAuthError: (e: unknown) => void }> = ({ open, editing, onClose, onSaved, onAuthError }) => {
  const toast = useToast();
  const [form, setForm] = useState<AreaForm>(emptyForm());
  const [errors, setErrors] = useState<Partial<Record<keyof AreaForm, string>>>({});
  const [general, setGeneral] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setForm(editing ? formOf(editing) : emptyForm()); setErrors({}); setGeneral(''); } }, [open, editing]);

  const set = <K extends keyof AreaForm>(key: K, value: AreaForm[K]) => { setForm((f) => ({ ...f, [key]: value })); setErrors((e) => ({ ...e, [key]: undefined })); };
  const pick = (name: string) => { const c = cityByName(name); if (c) setForm((f) => ({ ...f, name: f.name.trim() ? f.name : c.name, lat: String(c.lat), lng: String(c.lng), radiusKm: String(c.radiusKm) })); setErrors({}); };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = areaBody(form);
    if (!parsed.ok) { setErrors({ [parsed.field]: parsed.message }); return; }
    setBusy(true); setGeneral('');
    try { await apiService.saveServiceArea(editing?.id ?? null, parsed.body); toast.success(editing ? 'Zone mise à jour' : 'Zone ajoutée', form.name.trim()); onSaved(); onClose(); } catch (e) {
      onAuthError(e);
      if (e instanceof ApiError && (e.field === 'name' || e.field === 'lat' || e.field === 'lng' || e.field === 'radiusKm')) setErrors({ [e.field]: errorText(e) }); else setGeneral(errorText(e));
    } finally { setBusy(false); }
  };

  return (
    <Drawer open={open} onClose={onClose} icon={MapPinned} title={editing ? editing.name : 'Nouvelle zone'} subtitle="Un cercle : un centre et un rayon"
      footer={<div className="flex gap-3 pb-4"><button type="button" className="k-btn-ghost flex-1" onClick={onClose}>Annuler</button><button type="submit" form="area-form" className="k-btn-accent flex-1" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Enregistrer</button></div>}>
      <form id="area-form" onSubmit={submit} className="space-y-4" noValidate>
        {general && <ErrorBanner message={general} />}
        <CityPicker id="area-city" onPick={pick} />
        <Field label="Nom de la zone" htmlFor="area-name" required error={errors.name}><TextInput id="area-name" value={form.name} onChange={(e) => set('name', e.target.value)} invalid={Boolean(errors.name)} maxLength={60} /></Field>
        <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
          <div className="min-w-0"><Field label="Latitude du centre" htmlFor="area-lat" required error={errors.lat}><TextInput id="area-lat" inputMode="decimal" value={form.lat} onChange={(e) => set('lat', e.target.value)} invalid={Boolean(errors.lat)} placeholder="14.7886" /></Field></div>
          <div className="min-w-0"><Field label="Longitude du centre" htmlFor="area-lng" required error={errors.lng}><TextInput id="area-lng" inputMode="decimal" value={form.lng} onChange={(e) => set('lng', e.target.value)} invalid={Boolean(errors.lng)} placeholder="-16.926" /></Field></div>
        </div>
        <Field label="Rayon (km)" htmlFor="area-radius" required error={errors.radiusKm} hint="Toute adresse à moins de ce rayon du centre est dans la zone."><TextInput id="area-radius" inputMode="decimal" value={form.radiusKm} onChange={(e) => set('radiusKm', e.target.value)} invalid={Boolean(errors.radiusKm)} /></Field>
        <label htmlFor="area-active" className="k-inset flex cursor-pointer items-center justify-between gap-3 px-4 py-3">
          <span className="min-w-0"><span className="block text-sm font-bold text-kraveo-ink">Zone active</span><span className="block text-xs text-kraveo-ink3">Une zone désactivée est gardée mais ne compte plus.</span></span>
          <input id="area-active" type="checkbox" className="h-4 w-4" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
        </label>
      </form>
    </Drawer>
  );
};

const VerdictLine: React.FC<{ who: string; v: PointCheck['vendor'] }> = ({ who, v }) => (
  <div className="flex items-start justify-between gap-3 py-2 text-sm">
    <span className="font-semibold text-kraveo-ink">{who}</span>
    <span className="flex min-w-0 flex-col items-end gap-1 text-right">
      <Pill tone={v.served ? 'green' : 'red'}>{v.served ? 'Servi' : 'Refusé'}</Pill>
      <span className="text-xs text-kraveo-ink3">{v.served ? (v.area ? `dans la zone « ${v.area} »` : 'partout au Sénégal') : v.message}</span>
    </span>
  </div>
);

const PointTester: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [result, setResult] = useState<PointCheck | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pick = (name: string) => { const c = cityByName(name); if (c) { setLat(String(c.lat)); setLng(String(c.lng)); setResult(null); setError(''); } };
  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    const a = Number(lat.replace(',', '.')); const b = Number(lng.replace(',', '.'));
    if (lat.trim() === '' || lng.trim() === '' || !Number.isFinite(a) || !Number.isFinite(b) || Math.abs(a) > 90 || Math.abs(b) > 180) { setError('Saisissez une latitude et une longitude, ou choisissez une ville.'); return; }
    setBusy(true); setError('');
    try { setResult(await apiService.checkServicePoint(a, b)); } catch (e) { onAuthError(e); setError(errorText(e)); setResult(null); } finally { setBusy(false); }
  };
  return (
    <section className="k-card space-y-4 p-4 sm:p-5" aria-label="Tester un point">
      <div><h2 className="flex items-center gap-2 font-display text-base font-bold text-kraveo-ink"><MapPin className="h-4 w-4 text-kraveo-g600" aria-hidden="true" />Tester une adresse</h2><p className="text-sm text-kraveo-ink2">Vérifiez si un restaurant ou un client situé à cet endroit serait accepté, avec la règle actuelle.</p></div>
      <form onSubmit={run} className="space-y-3" noValidate>
        <CityPicker id="test-city" label="Ville" onPick={pick} />
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <div className="min-w-0"><Field label="Latitude" htmlFor="test-lat"><TextInput id="test-lat" inputMode="decimal" value={lat} onChange={(e) => { setLat(e.target.value); setError(''); }} /></Field></div>
          <div className="min-w-0"><Field label="Longitude" htmlFor="test-lng"><TextInput id="test-lng" inputMode="decimal" value={lng} onChange={(e) => { setLng(e.target.value); setError(''); }} /></Field></div>
        </div>
        {error && <p role="alert" className="text-sm font-semibold text-kraveo-danger">{error}</p>}
        <button type="submit" className="k-btn-accent w-full" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Vérifier</button>
      </form>
      {result && (
        <div aria-live="polite" className="divide-y divide-kraveo-line/60 rounded-k-md border border-kraveo-line px-4">
          {!result.inCountry && <p className="py-2 text-sm font-semibold text-kraveo-danger">Ce point n’est pas au Sénégal.</p>}
          <VerdictLine who="Restaurant" v={result.vendor} />
          <VerdictLine who="Client (adresse de livraison)" v={result.customer} />
        </div>
      )}
    </section>
  );
};

export const ServiceAreasPanel: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const areas = useLoad(() => apiService.fetchServiceAreas(), onAuthError);
  const config = useLoad(async () => {
    const [mods, settings] = await Promise.all([apiService.fetchModules(), apiService.fetchModuleSettings(MODULE)]);
    return { module: mods.find((m) => m.code === MODULE) ?? null, mode: (settings.find((s) => s.key === 'mode')?.value === 'AREAS' ? 'AREAS' : 'COUNTRY') as Mode };
  }, onAuthError);
  const [drawer, setDrawer] = useState<{ open: boolean; editing: ServiceArea | null }>({ open: false, editing: null });
  const [busy, setBusy] = useState<string | null>(null);
  const list = areas.data?.areas ?? [];
  const moduleOn = config.data?.module?.isEnabled !== false;
  const mode = config.data?.mode ?? 'COUNTRY';
  const limited = moduleOn && mode === 'AREAS';
  const activeCount = list.filter((a) => a.isActive).length;
  const reload = () => { areas.reload(); config.reload(); };

  const changeMode = async (next: Mode) => {
    if (next === mode) return;
    const ok = await confirm(next === 'AREAS'
      ? { title: 'Limiter l’application aux zones ?', message: `Dès maintenant, les restaurants et les adresses de livraison hors des ${activeCount} zone${activeCount > 1 ? 's' : ''} active${activeCount > 1 ? 's' : ''} seront refusés. Les commandes déjà passées ne changent pas.`, confirmLabel: 'Limiter', danger: true }
      : { title: 'Ouvrir à tout le Sénégal ?', message: 'Les restaurants et les adresses de livraison seront acceptés partout au Sénégal. Les zones sont conservées.', confirmLabel: 'Ouvrir à tout le pays' });
    if (!ok) return;
    setBusy('mode');
    try { await apiService.saveModuleSetting(MODULE, 'mode', next); toast.success(next === 'AREAS' ? 'Application limitée aux zones' : 'Application ouverte à tout le Sénégal'); reload(); } catch (e) { onAuthError(e); toast.error('Changement refusé', errorText(e)); } finally { setBusy(null); }
  };

  const reactivate = async () => {
    setBusy('module');
    try { await apiService.toggleModule(MODULE, true); toast.success('Module réactivé'); reload(); } catch (e) { onAuthError(e); toast.error('Changement refusé', errorText(e)); } finally { setBusy(null); }
  };

  const toggle = async (a: ServiceArea) => {
    setBusy(a.id);
    try { await apiService.saveServiceArea(a.id, { isActive: !a.isActive }); toast.success(a.isActive ? 'Zone désactivée' : 'Zone activée', a.name); areas.reload(); } catch (e) { onAuthError(e); toast.error('Changement refusé', errorText(e)); } finally { setBusy(null); }
  };

  const remove = async (a: ServiceArea) => {
    if (!(await confirm({ title: `Supprimer « ${a.name} » ?`, message: 'La zone est effacée. Vous pourrez la recréer depuis la liste des villes.', confirmLabel: 'Supprimer', danger: true }))) return;
    setBusy(a.id);
    try { await apiService.deleteServiceArea(a.id); toast.success('Zone supprimée', a.name); areas.reload(); } catch (e) { onAuthError(e); toast.error('Suppression refusée', errorText(e)); } finally { setBusy(null); }
  };

  const Choice: React.FC<{ value: Mode; title: string; text: string }> = ({ value, title, text }) => {
    const active = moduleOn && mode === value;
    return (
      <button type="button" role="radio" aria-checked={active} disabled={busy === 'mode' || !moduleOn} onClick={() => changeMode(value)}
        className={`flex min-w-0 items-start gap-3 rounded-k-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${active ? 'border-kraveo-g500 bg-kraveo-g500/10' : 'border-kraveo-line bg-kraveo-surface hover:bg-kraveo-surface2'}`}>
        <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border ${active ? 'border-kraveo-g500 bg-kraveo-g500 text-white' : 'border-kraveo-line'}`}>{active && <Check className="h-3 w-3" aria-hidden="true" />}</span>
        <span className="min-w-0"><span className="block font-bold text-kraveo-ink">{title}</span><span className="mt-0.5 block text-sm text-kraveo-ink2">{text}</span></span>
      </button>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader icon={Globe2} title="Zones de service" subtitle="Où l’application est disponible : tout le Sénégal, ou seulement les zones que vous choisissez." onRefresh={reload} refreshing={areas.loading || config.loading}
        actions={<button type="button" className="k-btn-accent" onClick={() => setDrawer({ open: true, editing: null })}><Plus className="h-4 w-4" aria-hidden="true" />Ajouter une zone</button>} />
      {(areas.error || config.error) && <ErrorBanner message={areas.error || config.error} onRetry={reload} />}

      {config.data && !moduleOn && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-k-md border border-kraveo-status-placed/40 bg-kraveo-status-placed/10 px-4 py-3 text-sm text-kraveo-ink">
          <span className="flex min-w-0 items-center gap-2"><ShieldAlert className="h-4 w-4 shrink-0 text-kraveo-status-placed" aria-hidden="true" />Le module « Zones de service » est désactivé : l’application est ouverte à tout le Sénégal, quelles que soient les zones.</span>
          <button type="button" className="k-btn-ghost !min-h-[34px] text-xs" disabled={busy === 'module'} onClick={reactivate}>Réactiver le module</button>
        </div>
      )}

      <section className="space-y-3" aria-label="Disponibilité">
        <h2 className="k-label">Disponibilité de l’application</h2>
        {config.loading && !config.data ? <SkeletonCard lines={2} /> : (
          <div role="radiogroup" aria-label="Disponibilité" className="grid gap-3 md:grid-cols-2">
            <Choice value="COUNTRY" title="Tout le Sénégal" text="Aucune limite de ville : un restaurant ou un client situé n’importe où au Sénégal est accepté." />
            <Choice value="AREAS" title="Seulement certaines zones" text={`Seuls les restaurants et les adresses dans une zone active sont acceptés. ${activeCount} zone${activeCount > 1 ? 's' : ''} active${activeCount > 1 ? 's' : ''} aujourd’hui.`} />
          </div>
        )}
        {limited && <p className="text-xs text-kraveo-ink3">L’application est limitée : le reste du pays voit le message « hors zone » défini plus bas.</p>}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:items-start">
        <section className="space-y-3" aria-label="Zones">
          <h2 className="k-label">Zones ({list.length}){!limited && list.length > 0 && <span className="ml-2 font-normal normal-case text-kraveo-ink3">· sans effet tant que l’application est ouverte à tout le pays</span>}</h2>
          {areas.loading && !areas.data && <SkeletonCard lines={3} />}
          {areas.data && list.length === 0 && <div className="k-card p-6"><EmptyState icon={MapPinned} title="Aucune zone" description="Ajoutez une ville ou un rayon pour pouvoir limiter l’application." /></div>}
          {list.length > 0 && (
            <ul className="k-card divide-y divide-kraveo-line/60 overflow-hidden">
              {list.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2"><span className="truncate font-bold text-kraveo-ink">{a.name}</span>{!a.isActive && <Pill>Désactivée</Pill>}</span>
                    <span className="block text-xs text-kraveo-ink3">Rayon {km(a.radiusKm)} · centre {a.lat.toFixed(4)}, {a.lng.toFixed(4)}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Switch checked={a.isActive} onChange={() => toggle(a)} label={`${a.isActive ? 'Désactiver' : 'Activer'} la zone ${a.name}`} disabled={busy === a.id} />
                    <button type="button" className="k-icon-btn" onClick={() => setDrawer({ open: true, editing: a })} aria-label={`Modifier la zone ${a.name}`}><Pencil className="h-4 w-4" aria-hidden="true" /></button>
                    <button type="button" className="k-icon-btn" onClick={() => remove(a)} disabled={busy === a.id} aria-label={`Supprimer la zone ${a.name}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h2 className="k-label pt-2">Quand l’application est limitée</h2>
          <ModuleSettingsGroups onAuthError={onAuthError} groups={[{ moduleCode: MODULE, title: 'À qui s’applique la limite', keys: ['apply_to_customers', 'apply_to_vendors', 'require_pin', 'outside_message'] }]} />
        </section>

        <div className="min-w-0 lg:sticky lg:top-4"><PointTester onAuthError={onAuthError} /></div>
      </div>

      <AreaDrawer open={drawer.open} editing={drawer.editing} onClose={() => setDrawer({ open: false, editing: null })} onSaved={reload} onAuthError={onAuthError} />
      {dialog}
    </div>
  );
};
