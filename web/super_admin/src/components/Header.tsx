import React, { useEffect, useRef, useState } from 'react';
import { Clock, Menu, RefreshCw, Search, X } from 'lucide-react';
import { AdminProfile, TabType } from '../types';
import { timeAgo } from '../lib/tokens';
import { Workspace, isSoon, navItem } from '../lib/navigation';

interface HeaderProps {
  activeTab: TabType;
  isLiveConnected: boolean;
  isLoading: boolean;
  adminProfile?: AdminProfile;
  onRefresh: () => void;
  onLogout: () => void;
  onOpenMenu: () => void;
  query: string;
  onQueryChange: (value: string) => void;
  workspace?: Workspace;
  /** No global search (the restaurant's own space has none). */
  hideSearch?: boolean;
  /** Switch between the admin menu and the restaurant-space preview. */
  onSwitchWorkspace?: () => void;
}

const TITLES: Partial<Record<TabType, { title: string; subtitle: string; searchHint: string }>> = {
  map: { title: 'Tableau de bord', subtitle: 'L’activité du jour à Thiès : commandes, livreurs et carte en direct', searchHint: 'Rechercher commandes, restaurants, points de livraison, livreurs' },
  orders: { title: 'Commandes', subtitle: 'Les 100 dernières commandes, avec paiement et statut en direct', searchHint: 'Rechercher commande, client, téléphone, restaurant, livreur ou id de paiement' },
  attention: { title: 'Alertes', subtitle: 'Commandes et paiements qui demandent une intervention', searchHint: 'Rechercher par commande, restaurant, client ou problème' },
  applications: { title: 'Inscriptions', subtitle: 'Restaurants et livreurs en attente de votre validation', searchHint: 'Rechercher par nom, téléphone, lieu ou immatriculation' },
  vendors: { title: 'Restaurants', subtitle: 'Réseau de restaurants de Thiès et disponibilité', searchHint: 'Rechercher un restaurant par nom, catégorie ou adresse' },
  drivers: { title: 'Livreurs', subtitle: 'Livreurs partenaires à Thiès', searchHint: 'Rechercher un livreur par nom, matricule ou code' },
  customers: { title: 'Clients', subtitle: 'Toutes les personnes connectées, avec leur historique de commandes', searchHint: 'Rechercher nom, e-mail, téléphone ou point de livraison' },
  catalog: { title: 'Menus & plats', subtitle: 'Validez les plats et fixez le prix payé par les clients', searchHint: 'Rechercher un plat par nom, catégorie ou restaurant' },
  finance: { title: 'Revenus & versements', subtitle: 'Revenus, règlements des restaurants et versements aux livreurs', searchHint: '' },
  settings: { title: 'Paramètres', subtitle: 'Compte, frais, messages et réglages de la plateforme', searchHint: '' },
  'settings-fees': { title: 'Frais & commission', subtitle: 'Frais, commission, arrondi et règlements', searchHint: '' },
  'settings-account': { title: 'Mon compte', subtitle: 'Votre profil et votre session', searchHint: '' },
  analytics: { title: 'Statistiques', subtitle: 'Chiffres de livraison à Thiès, basés sur les vraies commandes', searchHint: '' },
};

const useNow = (intervalMs: number): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
};

export const Header: React.FC<HeaderProps> = ({ activeTab, isLiveConnected, isLoading, adminProfile, onRefresh, onLogout, onOpenMenu, query, onQueryChange, workspace = 'admin', onSwitchWorkspace, hideSearch = false }) => {
  // Screens that exist have their own title; menu entries without a screen yet use their label and hint.
  const item = navItem(activeTab);
  const meta = TITLES[activeTab] ?? { title: item?.label ?? '', subtitle: item?.hint ?? '', searchHint: '' };
  const searchEnabled = !hideSearch && activeTab !== 'analytics' && !['orders', 'vendors', 'drivers', 'customers', 'applications', 'catalog'].includes(activeTab) && !['settings', 'settings-fees', 'settings-account'].includes(activeTab) && activeTab !== 'finance' && !isSoon(activeTab);
  const now = useNow(10_000);
  const [lastSynced, setLastSynced] = useState<number | null>(null);
  const wasLoading = useRef(false);
  const desktopSearch = useRef<HTMLInputElement>(null);
  const mobileSearch = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wasLoading.current && !isLoading) setLastSynced(Date.now());
    wasLoading.current = isLoading;
  }, [isLoading]);

  // "/" or Ctrl/Cmd+K focuses whichever search field is visible.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      const wantsSearch = (event.key === '/' && !typing) || (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey));
      if (!wantsSearch || !searchEnabled) return;
      event.preventDefault();
      const desktopVisible = desktopSearch.current && desktopSearch.current.offsetParent !== null;
      (desktopVisible ? desktopSearch.current : mobileSearch.current)?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [searchEnabled]);

  const clock = new Date(now).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const syncLabel = isLoading ? 'Synchronisation…' : lastSynced ? `Synchronisé ${timeAgo(lastSynced, now)}` : 'Pas encore synchronisé';

  const searchField = (ref: React.RefObject<HTMLInputElement>, id: string, className: string) => (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kraveo-ink3" aria-hidden="true" />
      <input
        ref={ref}
        id={id}
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={meta.searchHint}
        aria-label="Rechercher"
        autoComplete="off"
        className="k-input !min-h-[42px] truncate pl-10 pr-16 [&::-webkit-search-cancel-button]:hidden"
      />
      {query ? (
        <button aria-label="Effacer la recherche" onClick={() => onQueryChange('')} className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-kraveo-ink3 hover:bg-kraveo-line hover:text-kraveo-ink"><X className="h-3.5 w-3.5" aria-hidden="true" /></button>
      ) : (
        <kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-kraveo-line bg-kraveo-surface2 px-1.5 py-0.5 font-sans text-[10px] font-bold text-kraveo-ink3 md:block">/</kbd>
      )}
    </div>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-kraveo-line bg-white/90 backdrop-blur-xl">
      <div className="flex min-h-[76px] items-center gap-3 px-4 sm:px-8">
        <button aria-label="Ouvrir la navigation" onClick={onOpenMenu} className="k-icon-btn lg:hidden"><Menu className="h-5 w-5" aria-hidden="true" /></button>

        <div className="min-w-0 flex-1 lg:flex-none">
          <h1 className="truncate font-display text-lg font-bold leading-tight tracking-tight text-kraveo-ink sm:text-[22px]">{meta.title}</h1>
          <p className="hidden truncate text-[13px] text-kraveo-ink3 sm:block">{meta.subtitle}</p>
        </div>

        {searchEnabled ? searchField(desktopSearch, 'global-search', 'ml-4 hidden max-w-xl flex-1 md:block') : <div className="hidden flex-1 md:block" />}

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-3 rounded-k-sm border border-kraveo-line bg-kraveo-surface px-3 py-2 xl:flex" aria-live="off">
            <Clock className="h-4 w-4 text-kraveo-ink3" aria-hidden="true" />
            <div className="leading-tight">
              <p className="k-num text-sm text-kraveo-ink">{clock}</p>
              <p className="text-[11px] text-kraveo-ink3">{syncLabel}</p>
            </div>
          </div>
          <span
            className={`hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold sm:flex ${isLiveConnected ? 'border-kraveo-g400/30 bg-kraveo-g500/10 text-kraveo-g700' : 'border-kraveo-danger/30 bg-kraveo-danger/10 text-kraveo-danger'}`}
            role="status"
          >
            <span className={`k-dot ${isLiveConnected ? 'bg-kraveo-g400 k-dot-live' : 'bg-kraveo-danger'}`} aria-hidden="true" />
            {isLiveConnected ? 'En direct' : 'Hors ligne'}
          </span>
          <button aria-label="Actualiser les données" title="Actualiser les données" onClick={onRefresh} disabled={isLoading} className="k-icon-btn">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
          </button>

        </div>
      </div>
      {searchEnabled && <div className="px-4 pb-3 md:hidden">{searchField(mobileSearch, 'global-search-mobile', '')}</div>}
    </header>
  );
};
