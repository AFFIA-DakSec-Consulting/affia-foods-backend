import React, { useState } from 'react';
import { Loader2, SearchCheck } from 'lucide-react';
import { apiService } from '../services/api';
import { OrphanReport } from '../lib/platformParse';
import { inr } from '../lib/tokens';
import { ErrorBanner, dateTime, errorText } from './platform/common';

/** Looks for payments captured at the provider that no order accounts for (money received, order missing). Read-only. */
export const ReconcilePanel: React.FC<{ onAuthError: (e: unknown) => void }> = ({ onAuthError }) => {
  const [hours, setHours] = useState(24);
  const [report, setReport] = useState<OrphanReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setBusy(true); setError('');
    try { setReport(await apiService.fetchOrphanPayments(hours)); } catch (e) { onAuthError(e); setError(errorText(e)); setReport(null); } finally { setBusy(false); }
  };

  return (
    <section className="k-card space-y-3 p-4 sm:p-5" aria-label="Vérification des paiements">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-base font-bold text-kraveo-ink"><SearchCheck className="h-4 w-4 text-kraveo-g600" aria-hidden="true" />Paiements sans commande</h2>
          <p className="text-xs text-kraveo-ink3">Compare les paiements reçus chez le prestataire avec les commandes enregistrées. Lecture seule.</p>
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Période à vérifier" className="k-input !w-auto" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
            <option value={24}>Dernières 24 h</option><option value={72}>3 derniers jours</option><option value={168}>7 derniers jours</option>
          </select>
          <button type="button" className="k-btn-accent" onClick={run} disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Vérifier</button>
        </div>
      </div>
      {error && <ErrorBanner message={error} />}
      {report && (
        <div aria-live="polite" className="space-y-2">
          <p className="text-sm text-kraveo-ink2">{report.scanned} paiement{report.scanned > 1 ? 's' : ''} contrôlé{report.scanned > 1 ? 's' : ''}. {report.orphans.length === 0 ? 'Aucun écart : tout est rattaché à une commande.' : `${report.orphans.length} sans commande payée.`}{report.truncated ? ' La liste est tronquée : réduisez la période.' : ''}</p>
          {report.orphans.length > 0 && (
            <ul className="divide-y divide-kraveo-line/60 rounded-k-md border border-kraveo-line">
              {report.orphans.map((o) => (
                <li key={o.paymentId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="min-w-0"><span className="block font-mono text-xs text-kraveo-ink">{o.paymentId}</span><span className="text-xs text-kraveo-ink3">{dateTime(o.createdAt)}{o.kraveoOrderId ? ` · commande ${o.kraveoOrderId.slice(0, 8)} (${o.kraveoPaymentStatus ?? 'statut inconnu'})` : ' · aucune commande liée'}</span></span>
                  <span className="k-num text-kraveo-ink">{inr(o.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
};
