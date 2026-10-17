import React, { useEffect, useState } from 'react';
import { Loader2, MapPinned, Plus, Trash2 } from 'lucide-react';
import { apiService } from '../services/api';
import { Zone } from '../lib/platformParse';
import { useToast } from './ui/Toast';
import { PageHeader } from './ui/PageToolbar';
import { SkeletonCard } from './ui/Skeleton';
import { ErrorBanner, errorText, useLoad } from './platform/common';

/** One editable line: the start of a zone is always the end of the previous one, so it is never typed. */
export interface ZoneDraft { label: string; maxKm: string; fee: string; courierPayout: string }

export const draftsFromZones = (zones: Zone[]): ZoneDraft[] =>
  zones.map((z) => ({ label: z.label, maxKm: z.maxKm === null ? '' : String(z.maxKm), fee: z.fee === null ? '' : String(z.fee), courierPayout: z.courierPayout === null ? '' : String(z.courierPayout) }));

const toNumber = (s: string): number | null => { const t = s.trim().replace(',', '.'); return t === '' || !Number.isFinite(Number(t)) ? null : Number(t); };

/** Turns the lines into the grid the server expects, or says which line is wrong. */
export const zonesFromDrafts = (drafts: ZoneDraft[]): { ok: true; zones: Zone[] } | { ok: false; message: string } => {
  if (drafts.length === 0) return { ok: false, message: 'Ajoutez au moins une zone.' };
  if (drafts.length > 12) return { ok: false, message: '12 zones au maximum.' };
  const zones: Zone[] = [];
  let start = 0;
  for (let i = 0; i < drafts.length; i += 1) {
    const d = drafts[i];
    const last = i === drafts.length - 1;
    const maxKm = last ? null : toNumber(d.maxKm);
    if (!d.label.trim()) return { ok: false, message: `Zone ${i + 1} : donnez-lui un nom.` };
    if (!last && (maxKm === null || maxKm <= start)) return { ok: false, message: `Zone ${i + 1} : la limite doit dépasser ${start} km.` };
    const fee = toNumber(d.fee); const payout = toNumber(d.courierPayout);
    if ((d.fee.trim() !== '' && (fee === null || !Number.isInteger(fee) || fee < 0)) || (d.courierPayout.trim() !== '' && (payout === null || !Number.isInteger(payout) || payout < 0))) {
      return { ok: false, message: `Zone ${i + 1} : les montants sont des nombres entiers de FCFA.` };
    }
    zones.push({ label: d.label.trim(), minKm: start, maxKm, fee, courierPayout: payout });
    if (maxKm !== null) start = maxKm;
  }
  return { ok: true, zones };
};

export const ZonesPanel: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const toast = useToast();
  const { data, loading, error, reload } = useLoad(() => apiService.fetchZones('default'), onAuthError);
  const [drafts, setDrafts] = useState<ZoneDraft[]>([]);
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { if (data) { setDrafts(draftsFromZones(data)); setDirty(false); } }, [data]);

  const change = (index: number, patch: Partial<ZoneDraft>) => { setDrafts((cur) => cur.map((d, i) => (i === index ? { ...d, ...patch } : d))); setDirty(true); setProblem(''); };
  const add = () => { setDrafts((cur) => [...cur, { label: '', maxKm: '', fee: '', courierPayout: '' }]); setDirty(true); };
  const remove = (index: number) => { setDrafts((cur) => cur.filter((_, i) => i !== index)); setDirty(true); setProblem(''); };

  const save = async () => {
    const parsed = zonesFromDrafts(drafts);
    if (!parsed.ok) { setProblem(parsed.message); return; }
    setSaving(true); setProblem('');
    try {
      await apiService.saveZones('default', parsed.zones);
      toast.success('Zones enregistrées', 'La nouvelle grille s’applique aux prochaines commandes.');
      await reload();
    } catch (e) {
      onAuthError(e);
      setProblem(errorText(e));
    } finally { setSaving(false); }
  };

  let start = 0;
  return (
    <div className="space-y-5">
      <PageHeader icon={MapPinned} title="Zones de livraison" subtitle="Ce que paie le client et ce que gagne le livreur, selon la distance."
        onRefresh={reload} refreshing={loading}
        actions={<button type="button" className="k-btn-accent" onClick={save} disabled={!dirty || saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Enregistrer la grille</button>} />
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !data && <SkeletonCard lines={5} />}
      {data && (
        <div className="k-card space-y-4 p-4 sm:p-5">
          <p className="text-sm text-kraveo-ink2">La grille remplace l’ancienne en une fois. Les zones se suivent : le début de chaque zone est la fin de la précédente. Laissez un montant vide pour utiliser la formule de base. La dernière zone n’a pas de limite.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="text-left"><th className="k-label pb-2 pr-3">Nom</th><th className="k-label pb-2 pr-3">De (km)</th><th className="k-label pb-2 pr-3">À (km)</th><th className="k-label pb-2 pr-3">Client paie (FCFA)</th><th className="k-label pb-2 pr-3">Livreur gagne (FCFA)</th><th className="pb-2"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {drafts.map((d, i) => {
                  const last = i === drafts.length - 1;
                  const from = start;
                  const next = toNumber(d.maxKm);
                  if (next !== null) start = next;
                  return (
                    <tr key={i} className="align-top">
                      <td className="py-1.5 pr-3"><input aria-label={`Nom de la zone ${i + 1}`} className="k-input" value={d.label} onChange={(e) => change(i, { label: e.target.value })} placeholder="0–2 km" /></td>
                      <td className="py-1.5 pr-3"><input aria-label={`Début de la zone ${i + 1}`} className="k-input opacity-70" value={from} readOnly tabIndex={-1} /></td>
                      <td className="py-1.5 pr-3">{last ? <input aria-label={`Fin de la zone ${i + 1}`} className="k-input opacity-70" value="et plus" readOnly tabIndex={-1} /> : <input aria-label={`Fin de la zone ${i + 1}`} className="k-input" inputMode="decimal" value={d.maxKm} onChange={(e) => change(i, { maxKm: e.target.value })} />}</td>
                      <td className="py-1.5 pr-3"><input aria-label={`Frais client de la zone ${i + 1}`} className="k-input" inputMode="numeric" value={d.fee} onChange={(e) => change(i, { fee: e.target.value })} placeholder="formule de base" /></td>
                      <td className="py-1.5 pr-3"><input aria-label={`Gain livreur de la zone ${i + 1}`} className="k-input" inputMode="numeric" value={d.courierPayout} onChange={(e) => change(i, { courierPayout: e.target.value })} placeholder="formule de base" /></td>
                      <td className="py-1.5"><button type="button" className="k-icon-btn" onClick={() => remove(i)} aria-label={`Supprimer la zone ${i + 1}`} disabled={drafts.length <= 1}><Trash2 className="h-4 w-4" aria-hidden="true" /></button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {problem && <p role="alert" className="text-sm font-semibold text-kraveo-danger">{problem}</p>}
          <button type="button" className="k-btn-ghost" onClick={add} disabled={drafts.length >= 12}><Plus className="h-4 w-4" aria-hidden="true" />Ajouter une zone</button>
        </div>
      )}
    </div>
  );
};
