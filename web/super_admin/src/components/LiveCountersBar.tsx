import React, { useEffect, useRef, useState } from 'react';
import { apiService } from '../services/api';
import { LiveCounts } from '../lib/platformParse';
import { TabType } from '../lib/navigation';

const ITEMS: Array<{ key: keyof LiveCounts; label: string; alert?: boolean; go?: TabType }> = [
  { key: 'inProgress', label: 'En cours', go: 'orders' }, { key: 'awaitingRestaurant', label: 'Attendent le restaurant', go: 'orders' }, { key: 'preparing', label: 'En préparation' },
  { key: 'readyForPickup', label: 'Prêtes' }, { key: 'onTheWay', label: 'En route' },
  { key: 'withoutRider', label: 'Sans livreur', alert: true, go: 'attention' }, { key: 'stuck', label: 'Bloquées', alert: true, go: 'attention' }, { key: 'awaitingPayment', label: 'Paiement en attente' },
];

/** Platform-wide counters from the server, refreshed every 30 s while the page is visible. Silent when the server cannot answer: the dashboard below keeps working. */
export const LiveCountersBar: React.FC<{ onNavigate: (tab: TabType) => void; onAuthError: (e: unknown) => void }> = ({ onNavigate, onAuthError }) => {
  const [counts, setCounts] = useState<LiveCounts | null>(null);
  const authRef = useRef(onAuthError);
  authRef.current = onAuthError;

  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.visibilityState === 'hidden') return;
      try { const c = await apiService.fetchLiveCounts(); if (alive) setCounts(c); } catch (e) { authRef.current(e); }
    };
    void load();
    const timer = window.setInterval(load, 30_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  if (!counts) return null;
  return (
    <ul aria-label="Commandes en direct sur toute la plateforme" className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
      {ITEMS.map(({ key, label, alert, go }) => {
        const n = counts[key];
        const hot = alert && n > 0;
        const body = (<><span className={`k-num text-lg ${hot ? 'text-kraveo-danger' : 'text-kraveo-ink'}`}>{n}</span><span className="whitespace-nowrap text-xs text-kraveo-ink3">{label}</span></>);
        return (
          <li key={key} className={`k-card flex shrink-0 items-center gap-2 !rounded-full px-4 py-2 ${hot ? 'border-kraveo-danger/50' : ''}`}>
            {go ? <button type="button" onClick={() => onNavigate(go)} className="flex items-center gap-2">{body}</button> : body}
          </li>
        );
      })}
    </ul>
  );
};
