import React from 'react';
import { CheckCircle2, FileWarning, XCircle } from 'lucide-react';
import { Dossier } from '../../lib/dossier';

/** "Dossier complet" (green) or "2 manquants" (amber), with a small progress bar. */
export const DossierPill: React.FC<{ dossier: Dossier }> = ({ dossier }) => (
  <span className="inline-flex flex-col gap-1" title={dossier.complete ? 'Dossier complet' : `Manque : ${dossier.missing.map((m) => m.label).join(', ')}`}>
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold ${dossier.complete ? 'bg-kraveo-status-delivered/15 text-kraveo-status-delivered' : 'bg-kraveo-status-placed/15 text-kraveo-status-placed'}`}>
      {dossier.complete ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <FileWarning className="h-3.5 w-3.5" aria-hidden="true" />}
      {dossier.complete ? 'Dossier complet' : `${dossier.missing.length} manquant${dossier.missing.length > 1 ? 's' : ''}`}
    </span>
    <span className="h-1 w-full overflow-hidden rounded-full bg-kraveo-line" aria-hidden="true"><span className={`block h-full rounded-full ${dossier.complete ? 'bg-kraveo-status-delivered' : 'bg-kraveo-status-placed'}`} style={{ width: `${(dossier.done / dossier.total) * 100}%` }} /></span>
  </span>
);

/** The check list of a file: one line per required item, ticked or not. */
export const DossierChecklist: React.FC<{ dossier: Dossier }> = ({ dossier }) => (
  <ul className="space-y-2" aria-label="Contrôle du dossier">
    {dossier.items.map((item) => (
      <li key={item.key} className={`flex items-start gap-3 rounded-k-md border px-4 py-3 ${item.ok ? 'border-kraveo-line bg-kraveo-surface' : 'border-kraveo-status-placed/30 bg-kraveo-status-placed/10'}`}>
        {item.ok ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-kraveo-status-delivered" aria-hidden="true" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-kraveo-status-placed" aria-hidden="true" />}
        <div className="min-w-0"><p className="text-sm font-bold text-kraveo-ink">{item.label}</p><p className="text-xs text-kraveo-ink3">{item.ok ? 'Fourni' : item.hint}</p></div>
      </li>
    ))}
  </ul>
);
