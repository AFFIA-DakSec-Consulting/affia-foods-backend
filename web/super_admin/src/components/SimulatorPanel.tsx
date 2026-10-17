import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, FlaskConical, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { apiService } from '../services/api';
import { inr } from '../lib/tokens';
import { PlatformModule, SimulationResult } from '../lib/platformParse';
import { Field } from './ui/Field';
import { PageHeader } from './ui/PageToolbar';
import { ErrorBanner, Pill, TextInput, errorText, useLoad } from './platform/common';

export type Override = 'default' | 'on' | 'off';

export interface SimInputs { distance: string; cart: string; restaurants: string; promo: string; commission: string; at: string }

/** The request body, or the sentence that explains what to fix. Empty optional fields are left out. */
export const simulationRequest = (f: SimInputs, overrides: Record<string, Override>): { ok: true; body: Record<string, unknown> } | { ok: false; field: keyof SimInputs; message: string } => {
  const distance = Number(f.distance.replace(',', '.'));
  if (f.distance.trim() === '' || !Number.isFinite(distance) || distance < 0) return { ok: false, field: 'distance', message: 'Saisissez une distance en km (0 ou plus).' };
  const cart = Number(f.cart);
  if (f.cart.trim() === '' || !Number.isInteger(cart) || cart < 0) return { ok: false, field: 'cart', message: 'Le panier est un nombre entier de FCFA.' };
  const restaurants = Number(f.restaurants || '1');
  if (!Number.isInteger(restaurants) || restaurants < 1 || restaurants > 10) return { ok: false, field: 'restaurants', message: 'Entre 1 et 10 restaurants.' };
  const body: Record<string, unknown> = { distance_km: distance, cart_amount: cart, restaurants_count: restaurants };
  if (f.promo.trim()) body.promo_code = f.promo.trim().toUpperCase();
  if (f.commission.trim()) {
    const c = Number(f.commission);
    if (!Number.isInteger(c) || c < 0) return { ok: false, field: 'commission', message: 'La commission est un nombre entier de FCFA.' };
    body.commission_amount = c;
  }
  if (f.at) { const d = new Date(f.at); if (Number.isFinite(d.getTime())) body.at = d.toISOString(); }
  const forced = Object.entries(overrides).filter(([, v]) => v !== 'default');
  if (forced.length > 0) body.overrides = Object.fromEntries(forced.map(([k, v]) => [k, v === 'on']));
  return { ok: true, body };
};

const PRESETS: Array<{ label: string; values: Partial<SimInputs> }> = [
  { label: 'Petite commande', values: { distance: '1.5', cart: '3000', restaurants: '1' } },
  { label: 'Commande moyenne', values: { distance: '4', cart: '10000', restaurants: '1' } },
  { label: 'Grosse commande', values: { distance: '7', cart: '25000', restaurants: '1' } },
  { label: 'Deux restaurants', values: { distance: '4', cart: '12000', restaurants: '2' } },
];
const DEFAULTS: SimInputs = { distance: '4', cart: '10000', restaurants: '1', promo: '', commission: '', at: '' };

/** What the server's margin is made of (its own wording is English). */
export const MARGIN_FORMULA = 'Commission + livraison payée par le client + contribution des restaurants − gain du livreur − remises sur les repas.';

const CATEGORY_LABEL: Record<string, string> = { delivery: 'Livraison', courier: 'Livreur', marketing: 'Marketing' };
const CATEGORY_ORDER = ['delivery', 'courier', 'marketing'];

/** Modules that never change a price (they message customers or reward them): forcing them would show nothing. */
const NEVER_PRICES = new Set(['marketing.campaigns', 'marketing.referral', 'marketing.loyalty_coins']);

/** Modules grouped by category, in a fixed order. Analytics is left out too: it never changes a price. */
export const groupForced = (modules: PlatformModule[]): Array<{ category: string; label: string; modules: PlatformModule[] }> => {
  const usable = modules.filter((m) => !NEVER_PRICES.has(m.code));
  return CATEGORY_ORDER.map((category) => ({ category, label: CATEGORY_LABEL[category], modules: usable.filter((m) => m.category === category) })).filter((g) => g.modules.length > 0);
};

const CHOICES: Array<{ value: Override; label: string }> = [{ value: 'default', label: 'Tel quel' }, { value: 'on', label: 'Actif' }, { value: 'off', label: 'Coupé' }];

/** Three choices side by side: always fits its row, one tap, no drop-down to overflow. */
const Choice: React.FC<{ name: string; value: Override; onChange: (v: Override) => void }> = ({ name, value, onChange }) => (
  <div role="radiogroup" aria-label={`Essai : ${name}`} className="grid grid-cols-3 overflow-hidden rounded-k-sm border border-kraveo-line bg-kraveo-surface text-xs font-bold">
    {CHOICES.map((c) => (
      <button key={c.value} type="button" role="radio" aria-checked={value === c.value} onClick={() => onChange(c.value)}
        className={`min-h-[34px] truncate px-2 transition-colors ${value === c.value ? (c.value === 'on' ? 'bg-kraveo-g500 text-white' : c.value === 'off' ? 'bg-kraveo-danger text-white' : 'bg-kraveo-ink text-kraveo-surface') : 'text-kraveo-ink2 hover:bg-kraveo-surface2'}`}>{c.label}</button>
    ))}
  </div>
);

const Line: React.FC<{ label: string; value: string; strong?: boolean; tone?: string }> = ({ label, value, strong, tone }) => (
  <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm"><span className="min-w-0 text-kraveo-ink2">{label}</span><span className={`shrink-0 tabular-nums ${strong ? 'font-bold' : ''} ${tone ?? 'text-kraveo-ink'}`}>{value}</span></div>
);

export const SimulatorPanel: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const { data: modules } = useLoad(() => apiService.fetchModules(), onAuthError);
  const [f, setF] = useState<SimInputs>(DEFAULTS);
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [errors, setErrors] = useState<Partial<Record<keyof SimInputs, string>>>({});
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  const forced = Object.values(overrides).filter((v) => v !== 'default').length;
  const groups = useMemo(() => groupForced(modules ?? []), [modules]);

  const set = (key: keyof SimInputs, value: string) => { setF((cur) => ({ ...cur, [key]: value })); setErrors((cur) => ({ ...cur, [key]: undefined })); };

  const simulate = async (inputs: SimInputs, forcedModules: Record<string, Override>) => {
    const req = simulationRequest(inputs, forcedModules);
    if (!req.ok) { setErrors({ [req.field]: req.message }); return; }
    const mine = ++seq.current;
    setBusy(true); setProblem('');
    try { const out = await apiService.simulatePricing(req.body); if (mine === seq.current) setResult(out); } catch (e) { if (mine !== seq.current) return; onAuthError(e); setProblem(errorText(e)); setResult(null); } finally { if (mine === seq.current) setBusy(false); }
  };

  // The default order is simulated once on arrival, so the right-hand side shows a real answer straight away.
  useEffect(() => { void simulate(DEFAULTS, {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const run = (event: React.FormEvent) => { event.preventDefault(); void simulate(f, overrides); };
  const usePreset = (values: Partial<SimInputs>) => { const next = { ...f, ...values }; setF(next); setErrors({}); void simulate(next, overrides); };
  const reset = () => { setF(DEFAULTS); setOverrides({}); setErrors({}); void simulate(DEFAULTS, {}); };

  return (
    <div className="space-y-5">
      <PageHeader icon={FlaskConical} title="Simulateur de prix" subtitle="Testez une commande fictive. Rien n’est enregistré : essayez même un module avant de l’activer." />

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Commandes types">
        <span className="k-label mr-1 flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5" aria-hidden="true" />Commandes types</span>
        {PRESETS.map((p) => <button key={p.label} type="button" className="k-chip" onClick={() => usePreset(p.values)}>{p.label}</button>)}
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
        <form onSubmit={run} className="k-card min-w-0 space-y-5 p-4 sm:p-5" noValidate>
          <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
            <div className="min-w-0"><Field label="Distance (km)" htmlFor="sim-distance" error={errors.distance}><TextInput id="sim-distance" inputMode="decimal" value={f.distance} onChange={(e) => set('distance', e.target.value)} invalid={Boolean(errors.distance)} /></Field></div>
            <div className="min-w-0"><Field label="Panier (FCFA)" htmlFor="sim-cart" error={errors.cart}><TextInput id="sim-cart" inputMode="numeric" value={f.cart} onChange={(e) => set('cart', e.target.value)} invalid={Boolean(errors.cart)} /></Field></div>
            <div className="min-w-0"><Field label="Restaurants" htmlFor="sim-rest" error={errors.restaurants}><TextInput id="sim-rest" inputMode="numeric" value={f.restaurants} onChange={(e) => set('restaurants', e.target.value)} invalid={Boolean(errors.restaurants)} /></Field></div>
            <div className="min-w-0"><Field label="Code promo" htmlFor="sim-promo"><TextInput id="sim-promo" value={f.promo} onChange={(e) => set('promo', e.target.value.toUpperCase())} placeholder="BIENVENUE" /></Field></div>
            <div className="min-w-0"><Field label="Commission (FCFA)" htmlFor="sim-comm" error={errors.commission} hint="Vide = calcul automatique."><TextInput id="sim-comm" inputMode="numeric" value={f.commission} onChange={(e) => set('commission', e.target.value)} invalid={Boolean(errors.commission)} /></Field></div>
            <div className="min-w-0"><Field label="Date et heure" htmlFor="sim-at" hint="Vide = maintenant."><TextInput id="sim-at" type="datetime-local" value={f.at} onChange={(e) => set('at', e.target.value)} className="min-w-0" /></Field></div>
          </div>

          {groups.length > 0 && (
            <section className="rounded-k-md border border-kraveo-line" aria-label="Forcer un module">
              <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                <span className="min-w-0"><span className="block text-sm font-bold text-kraveo-ink">Essayer un module</span><span className="block text-xs text-kraveo-ink3">{forced > 0 ? `${forced} module${forced > 1 ? 's' : ''} forcé${forced > 1 ? 's' : ''} pour cet essai` : 'Forcez-en un pour voir son effet avant de l’activer'}</span></span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-kraveo-ink3 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {open && (
                <div className="space-y-4 border-t border-kraveo-line px-4 py-4">
                  {groups.map((g) => (
                    <div key={g.category} className="space-y-3">
                      <p className="k-label">{g.label}</p>
                      {g.modules.map((m) => (
                        <div key={m.code} className="min-w-0 space-y-1.5">
                          <p className="flex min-w-0 items-baseline justify-between gap-2 text-sm"><span className="min-w-0 truncate font-semibold text-kraveo-ink" title={m.name}>{m.name}</span><span className={`shrink-0 text-[11px] font-bold ${m.effective ? 'text-kraveo-g600' : 'text-kraveo-ink3'}`}>{m.effective ? 'actif aujourd’hui' : 'coupé aujourd’hui'}</span></p>
                          <Choice name={m.name} value={overrides[m.code] ?? 'default'} onChange={(v) => setOverrides((cur) => ({ ...cur, [m.code]: v }))} />
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <div className="flex gap-3">
            <button type="button" className="k-btn-ghost !px-3" onClick={reset} aria-label="Remettre les valeurs de départ" title="Remettre les valeurs de départ"><RotateCcw className="h-4 w-4" aria-hidden="true" /></button>
            <button type="submit" className="k-btn-accent flex-1" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Simuler</button>
          </div>
        </form>

        <div className="min-w-0 space-y-4 lg:sticky lg:top-4" aria-live="polite">
          {problem && <ErrorBanner message={problem} />}
          {!result && !problem && <div className="k-card p-6 text-sm text-kraveo-ink2">{busy ? 'Calcul en cours…' : 'Choisissez une commande type ou renseignez les champs, puis lancez la simulation.'}</div>}
          {result && (
            <>
              <section className="k-card p-5">
                <p className="k-label">Le client paie</p>
                <p className="k-num mt-1 text-4xl text-kraveo-ink">{inr(result.customerPays.total)}</p>
                <div className="mt-3 border-t border-kraveo-line pt-2">
                  <Line label="Repas" value={inr(result.customerPays.food)} />
                  <Line label="Livraison" value={inr(result.customerPays.delivery)} />
                </div>
              </section>
              <div className="grid gap-4 md:grid-cols-2">
                <section className="k-card p-5">
                  <p className="k-label mb-1">Livreur et partenaires</p>
                  <Line label="Gain du livreur" value={inr(result.courierPayout)} strong />
                  <Line label="Livraison financée par Affia Foods" value={inr(result.deliverySubsidy)} />
                  <Line label="Contribution des restaurants" value={inr(result.merchantContribution)} />
                </section>
                <section className={`k-card p-5 ${result.margin.deficit ? 'border-kraveo-danger/50' : ''}`}>
                  <div className="flex items-center justify-between gap-3"><p className="k-label">Marge d’Affia Foods</p><Pill tone={result.margin.deficit ? 'red' : 'green'}>{result.margin.deficit ? 'Déficit' : 'Positive'}</Pill></div>
                  <p className={`k-num mt-1 text-3xl ${result.margin.deficit ? 'text-kraveo-danger' : 'text-kraveo-ink'}`}>{inr(result.margin.value)}</p>
                  <p className="mt-1 text-xs text-kraveo-ink3">Commission retenue : {inr(result.margin.commission)}</p>
                  <p className="mt-1 text-xs text-kraveo-ink3">{MARGIN_FORMULA}</p>
                </section>
              </div>
              <section className="k-card p-5">
                <p className="k-label mb-1">Promotions retenues</p>
                {!result.marketingApplied ? <p className="text-sm text-kraveo-ink2">Le marketing est coupé : aucune promotion n’est calculée.</p>
                  : result.promotions.length === 0 ? <p className="text-sm text-kraveo-ink2">Aucune promotion ne s’applique à cette commande.</p>
                  : result.promotions.map((p, i) => <Line key={i} label={p.name} value={`-${inr(p.discount)}`} tone="text-kraveo-g600" />)}
                {result.codeProblem && <p className="mt-2 text-sm font-semibold text-kraveo-status-placed">Code refusé : {result.codeProblem}</p>}
              </section>
              {result.warnings.length > 0 && <ErrorBanner message={`Avertissements : ${result.warnings.join(', ')}. (DISTANCE_UNKNOWN = pas de position pour calculer la distance.)`} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
