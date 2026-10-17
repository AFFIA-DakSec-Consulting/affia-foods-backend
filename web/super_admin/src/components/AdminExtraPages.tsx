import React, { useState } from 'react';
import { BellRing, CreditCard, Download, Loader2, ShoppingBag } from 'lucide-react';
import { apiService } from '../services/api';
import { saveBlob } from '../lib/download';
import { TabType } from '../lib/navigation';
import { KpiTile } from './ui/KpiTile';
import { SkeletonCard } from './ui/Skeleton';
import { Field } from './ui/Field';
import { useToast } from './ui/Toast';
import { PageHeader } from './ui/PageToolbar';
import { ErrorBanner, Pill, TextInput, errorText, useLoad } from './platform/common';
import { SettingRow } from './ModulesPanel';
import type { ModuleSetting } from '../lib/platformParse';

// ───────────────────────── Module settings grouped on a page ─────────────────────────

export interface SettingsGroup { moduleCode: string; title: string; keys?: string[] }

/** Settings of one or several modules, on one page. Same editor as the Modules screen: the server checks every value. */
export const ModuleSettingsGroups: React.FC<{ groups: SettingsGroup[]; onAuthError: (e: unknown) => void }> = ({ groups, onAuthError }) => {
  const { data, setData, loading, error, reload } = useLoad(async () => {
    const all = await Promise.all(groups.map((g) => apiService.fetchModuleSettings(g.moduleCode)));
    return groups.map((g, i) => ({ ...g, settings: g.keys ? all[i].filter((s) => g.keys!.includes(s.key)) : all[i] }));
  }, onAuthError);
  const update = (code: string, next: ModuleSetting) => setData((cur) => cur && cur.map((g) => (g.moduleCode === code ? { ...g, settings: g.settings.map((s) => (s.key === next.key ? next : s)) } : g)));
  return (
    <div className="space-y-5">
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <SkeletonCard lines={4} />}
      {data?.map((g) => (
        <section key={`${g.moduleCode}`} className="k-card space-y-3 p-4 sm:p-5" aria-label={g.title}>
          <h2 className="font-display text-base font-bold text-kraveo-ink">{g.title}</h2>
          {g.settings.map((s) => <SettingRow key={s.key} moduleCode={g.moduleCode} setting={s} onAuthError={onAuthError} onSaved={(next) => update(g.moduleCode, next)} />)}
          {g.settings.length === 0 && <p className="text-sm text-kraveo-ink2">Aucun réglage disponible.</p>}
        </section>
      ))}
    </div>
  );
};

/** "Règles de commande": what the server really enforces today on an order. */
export const OrderRulesPage: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => (
  <div className="mx-auto max-w-3xl space-y-4">
    <p className="text-sm text-kraveo-ink2">Ces règles sont appliquées par le serveur à chaque commande. Le délai d’acceptation et les règles d’annulation ne sont pas encore réglables : elles sont fixées dans le code du serveur.</p>
    <ModuleSettingsGroups onAuthError={onAuthError} groups={[
      { moduleCode: 'delivery.base_pricing', title: 'Montant et distance', keys: ['small_order_below', 'small_order_fee', 'max_delivery_distance'] },
      { moduleCode: 'delivery.multi_restaurant', title: 'Commande dans plusieurs restaurants' },
    ]} />
  </div>
);

// ───────────────────────── Notifications ─────────────────────────

export const NotificationsPanel: React.FC<{ onNavigate: (tab: TabType) => void; onAuthError: (e: unknown) => void }> = ({ onNavigate, onAuthError }) => {
  const { data } = useLoad(() => apiService.fetchCampaigns(1, 200), onAuthError);
  const sent = (data?.data ?? []).filter((c) => c.status === 'SENT');
  const total = (key: 'sentCount' | 'openedCount' | 'convertedCount') => sent.reduce((s, c) => s + c[key], 0);
  const sentCount = total('sentCount');
  const pct = (n: number) => (sentCount ? `${((n / sentCount) * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} % des envois` : undefined);
  return (
    <div className="space-y-5">
      <PageHeader icon={BellRing} title="Notifications" subtitle="Les règles d’envoi des notifications marketing et leur résultat."
        actions={<button type="button" className="k-btn-accent" onClick={() => onNavigate('campaigns')}>Créer une campagne</button>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile index={0} label="Campagnes envoyées" icon={BellRing} value={sent.length} />
        <KpiTile index={1} label="Notifications envoyées" icon={BellRing} value={sentCount} />
        <KpiTile index={2} label="Ouvertes" icon={BellRing} value={total('openedCount')} note={pct(total('openedCount'))} />
        <KpiTile index={3} label="Commandes générées" icon={BellRing} value={total('convertedCount')} note={pct(total('convertedCount'))} />
      </div>
      <p className="text-sm text-kraveo-ink2">Les notifications de suivi de commande ne passent jamais par ces règles : elles ne sont jamais coupées.</p>
      <ModuleSettingsGroups onAuthError={onAuthError} groups={[{ moduleCode: 'marketing.campaigns', title: 'Garde-fous marketing' }]} />
    </div>
  );
};

// ───────────────────────── Payments (read-only) ─────────────────────────

export const PaymentsSettingsPage: React.FC<{ onAuthError: (e: unknown) => void; onNavigate: (tab: TabType) => void }> = ({ onAuthError, onNavigate }) => {
  const { data, loading, error, reload } = useLoad(() => apiService.fetchPayoutProviders(), onAuthError);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section className="k-card space-y-3 p-4 sm:p-5" aria-label="Prestataires de versement">
        <div className="flex items-center gap-2"><CreditCard className="h-4 w-4 text-kraveo-g600" aria-hidden="true" /><h2 className="font-display text-base font-bold text-kraveo-ink">Versements aux restaurants et livreurs</h2></div>
        {error && <ErrorBanner message={error} onRetry={reload} />}
        {loading && !data && <SkeletonCard lines={2} />}
        <ul className="space-y-2">
          {data?.map((p) => (
            <li key={p.name} className="k-inset flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <span className="min-w-0"><span className="block font-bold text-kraveo-ink">{p.name === 'manual' ? 'Versement manuel' : p.name}</span>{p.reason && <span className="block text-xs text-kraveo-ink3">{p.reason}</span>}</span>
              <Pill tone={p.enabled ? 'green' : 'grey'}>{p.enabled ? 'Actif' : 'Inactif'}</Pill>
            </li>
          ))}
        </ul>
        <p className="text-xs text-kraveo-ink3">Cet écran est en lecture seule : les prestataires de versement se configurent côté serveur. Le calendrier et le mode des règlements se règlent dans « Frais & commission ».</p>
        <button type="button" className="k-btn-ghost" onClick={() => onNavigate('settings-fees')}>Ouvrir « Frais & commission »</button>
      </section>
    </div>
  );
};

// ───────────────────────── Export ─────────────────────────

const isoDay = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

export const ExportPage: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const toast = useToast();
  const [from, setFrom] = useState(isoDay(30));
  const [to, setTo] = useState(isoDay(0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (all: boolean) => {
    if (!all && (!from || !to || from > to)) { setError('Choisissez une période valide : la date de début doit précéder la date de fin.'); return; }
    setBusy(true); setError('');
    try {
      const file = await apiService.downloadSettlementsCsv(all ? null : { from, to });
      saveBlob(file.blob, file.filename);
      toast.success('CSV téléchargé', file.filename);
    } catch (e) { onAuthError(e); setError(errorText(e)); } finally { setBusy(false); }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section className="k-card space-y-4 p-4 sm:p-5" aria-label="Export comptable">
        <div className="flex items-center gap-2"><ShoppingBag className="h-4 w-4 text-kraveo-g600" aria-hidden="true" /><h2 className="font-display text-base font-bold text-kraveo-ink">Règlements des restaurants (CSV)</h2></div>
        <p className="text-sm text-kraveo-ink2">Fichier prêt pour la comptabilité : une ligne par règlement, avec le montant des plats, la commission et le net à verser.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Du" htmlFor="export-from"><TextInput id="export-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setError(''); }} /></Field>
          <Field label="Au" htmlFor="export-to" error={error}><TextInput id="export-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setError(''); }} invalid={Boolean(error)} /></Field>
        </div>
        <div className="flex flex-wrap gap-3">
          <button type="button" className="k-btn-accent" disabled={busy} onClick={() => run(false)}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}Télécharger la période</button>
          <button type="button" className="k-btn-ghost" disabled={busy} onClick={() => run(true)}>Tout télécharger</button>
        </div>
        <p className="text-xs text-kraveo-ink3">Les exports des commandes, clients et livreurs ne sont pas encore disponibles côté serveur.</p>
      </section>
    </div>
  );
};
