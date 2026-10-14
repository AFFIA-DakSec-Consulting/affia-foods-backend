import type React from 'react';
import { ADMIN_SETTINGS_PAGES, AdminSettingsTab, RESTAURANT_SETTINGS_PAGES, RestaurantSettingsTab } from './settingsCatalog';
import {
  BadgePercent, Bell, Bike, BookOpen, Building2, ClipboardCheck, ClipboardList, Clock3, Gauge, Gift, History, Landmark, LayoutDashboard, LifeBuoy,
  Map as MapIcon, MapPinned, Megaphone, MessageSquareText, Percent, PieChart, ReceiptText, RotateCcw, SearchCheck, ShieldCheck, ShoppingBag,
  SlidersHorizontal, Star, Store, TrendingUp, TriangleAlert, UserCog, UserPlus, Users, UtensilsCrossed, Wallet, FileSignature,
} from 'lucide-react';

// Navigation of the dashboard. The same app serves two workspaces:
// - "admin": the Affia Foods operations team (super admin);
// - "restaurant": a partner restaurant managing its own orders, menu and payouts (not wired to the backend yet).
// Entries with `soon: true` have no screen yet: the menu entry exists, the content shows "bientôt disponible".
// An item with `children` is a collapsible parent; only the children are screens.

export type Workspace = 'admin' | 'restaurant';

export type AdminTab =
  // Pilotage
  | 'map' | 'orders' | 'attention'
  // Partenaires
  | 'applications' | 'vendors' | 'drivers' | 'catalog' | 'contracts'
  // Clients
  | 'customers' | 'reviews'
  // Finances
  | 'finance' | 'analytics' | 'refunds' | 'commissions'
  // Marketing
  | 'promo-codes' | 'promo-offers' | 'referral' | 'notifications' | 'campaigns' | 'segments'
  // Croissance
  | 'zones' | 'prospecting'
  // Support
  | 'tickets' | 'help-center'
  // Administration
  | 'team' | 'audit' | 'settings' | 'settings-fees' | 'settings-account' | AdminSettingsTab | 'templates' | 'legal';

export type RestaurantTab =
  | 'r-dashboard' | 'r-orders' | 'r-history' | 'r-returns'
  | 'r-menu' | 'r-hours' | 'r-profile'
  | 'r-payouts' | 'r-stats' | 'r-promotions' | 'r-reviews'
  | 'r-team' | 'r-settings' | RestaurantSettingsTab | 'r-help';

export type TabType = AdminTab | RestaurantTab;

export interface NavChild {
  id: TabType;
  label: string;
  hint: string;
  soon?: boolean;
}

export interface NavItem {
  /** Screen id. Omitted on a parent whose children are the screens. */
  id?: TabType;
  label: string;
  /** Tooltip / sub-title in the header. */
  hint: string;
  icon: React.ElementType;
  /** Menu entry only: the screen does not exist yet. */
  soon?: boolean;
  /** Other screens that keep this entry highlighted (the sub-pages of a hub). */
  alsoActive?: TabType[];
  children?: NavChild[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const ADMIN_NAV: NavGroup[] = [
  {
    label: 'Activité',
    items: [
      { id: 'map', label: 'Tableau de bord', hint: 'L’activité du jour : commandes, livreurs et carte en direct', icon: LayoutDashboard },
      { id: 'orders', label: 'Commandes', hint: 'Toutes les commandes et leur statut', icon: ShoppingBag },
      { id: 'attention', label: 'Alertes', hint: 'Remboursements échoués, OTP bloqués, commandes bloquées', icon: TriangleAlert },
      { id: 'analytics', label: 'Statistiques', hint: 'Chiffres de livraison à Thiès, basés sur les vraies commandes', icon: TrendingUp },
    ],
  },
  {
    label: 'Partenaires',
    items: [
      { id: 'applications', label: 'Inscriptions', hint: 'Validez les nouveaux restaurants et livreurs, et vérifiez leur dossier', icon: ClipboardCheck },
      { id: 'vendors', label: 'Restaurants', hint: 'Restaurants et disponibilité', icon: Store },
      { id: 'drivers', label: 'Livreurs', hint: 'Livreurs partenaires et service', icon: Bike },
      { id: 'catalog', label: 'Menus & plats', hint: 'Validez plats, prix et commission', icon: UtensilsCrossed },
      { id: 'contracts', label: 'Contrats', hint: 'Contrats signés avec les restaurants et livreurs', icon: FileSignature, soon: true },
    ],
  },
  {
    label: 'Clients',
    items: [
      { id: 'customers', label: 'Clients', hint: 'Toutes les personnes qui ont commandé', icon: Users },
      { id: 'reviews', label: 'Avis clients', hint: 'Notes des restaurants et livreurs, signalements', icon: Star, soon: true },
    ],
  },
  {
    label: 'Finances',
    items: [
      { id: 'finance', label: 'Revenus & versements', hint: 'Revenus, règlements des restaurants et versements aux livreurs', icon: Landmark },
      { id: 'refunds', label: 'Remboursements', hint: 'Remboursements clients, en cours et terminés', icon: ReceiptText, soon: true },
      { id: 'commissions', label: 'Commissions', hint: 'Commissions par restaurant, plat et période', icon: Percent, soon: true },
    ],
  },
  {
    label: 'Marketing',
    items: [
      {
        label: 'Promotions', hint: 'Codes promo et offres', icon: BadgePercent,
        children: [
          { id: 'promo-codes', label: 'Codes promo', hint: 'Codes de réduction pour les clients', soon: true },
          { id: 'promo-offers', label: 'Offres restaurants', hint: 'Réductions proposées par les restaurants', soon: true },
        ],
      },
      { id: 'referral', label: 'Parrainage', hint: 'Parrainage des clients et des livreurs', icon: Gift, soon: true },
      {
        label: 'Communication', hint: 'Messages aux clients', icon: Megaphone,
        children: [
          { id: 'notifications', label: 'Notifications', hint: 'Messages push et annonces aux clients', soon: true },
          { id: 'campaigns', label: 'Campagnes', hint: 'Campagnes SMS, e-mail et WhatsApp', soon: true },
          { id: 'segments', label: 'Segments clients', hint: 'Groupes de clients selon leurs habitudes', soon: true },
        ],
      },
    ],
  },
  {
    label: 'Expansion',
    items: [
      { id: 'zones', label: 'Zones de livraison', hint: 'Villes ouvertes, zones et frais de livraison', icon: MapIcon, soon: true },
      { id: 'prospecting', label: 'Restaurants à recruter', hint: 'Restaurants à convaincre et suivi des contacts', icon: SearchCheck, soon: true },
    ],
  },
  {
    label: 'Support',
    items: [
      { id: 'tickets', label: 'Réclamations', hint: 'Litiges et demandes des clients, restaurants et livreurs', icon: LifeBuoy, soon: true },
      { id: 'help-center', label: 'Centre d’aide', hint: 'Articles d’aide pour les clients, restaurants et livreurs', icon: BookOpen, soon: true },
    ],
  },
  {
    label: 'Administration',
    items: [
      { id: 'team', label: 'Équipe & accès', hint: 'Comptes administrateurs, rôles et permissions', icon: ShieldCheck, soon: true },
      { id: 'audit', label: 'Journal d’activité', hint: 'Qui a fait quoi, et quand', icon: History, soon: true },
      { id: 'settings', label: 'Paramètres', hint: 'Compte, frais, messages et réglages de la plateforme', icon: SlidersHorizontal, alsoActive: ['settings-fees', 'settings-account', ...ADMIN_SETTINGS_PAGES.map((p) => p.id)] },
    ],
  },
];

export const RESTAURANT_NAV: NavGroup[] = [
  {
    label: 'Mon activité',
    items: [
      { id: 'r-dashboard', label: 'Tableau de bord', hint: 'Commandes en direct, ventes du jour et fiche du restaurant', icon: Gauge },
      {
        label: 'Commandes', hint: 'Suivi de vos commandes', icon: ClipboardList,
        children: [
          { id: 'r-orders', label: 'En cours', hint: 'Acceptez, préparez et remettez les commandes', soon: true },
          { id: 'r-history', label: 'Historique', hint: 'Toutes vos commandes passées', soon: true },
          { id: 'r-returns', label: 'Retours & annulations', hint: 'Commandes annulées et demandes de remboursement', soon: true },
        ],
      },
    ],
  },
  {
    label: 'Mon restaurant',
    items: [
      { id: 'r-menu', label: 'Menu & plats', hint: 'Plats, prix, photos et disponibilité', icon: UtensilsCrossed, soon: true },
      { id: 'r-hours', label: 'Horaires & ouverture', hint: 'Horaires d’ouverture et fermeture temporaire', icon: Clock3 },
      { id: 'r-profile', label: 'Profil du restaurant', hint: 'Logo, photo, description, contact et position', icon: Building2 },
    ],
  },
  {
    label: 'Ventes',
    items: [
      { id: 'r-payouts', label: 'Paiements', hint: 'Règlements reçus et à venir', icon: Wallet, soon: true },
      { id: 'r-stats', label: 'Statistiques', hint: 'Ventes, plats populaires et heures de pointe', icon: PieChart, soon: true },
      { id: 'r-promotions', label: 'Promotions', hint: 'Offres et réductions sur vos plats', icon: BadgePercent, soon: true },
      { id: 'r-reviews', label: 'Avis clients', hint: 'Notes et commentaires de vos clients', icon: MessageSquareText, soon: true },
    ],
  },
  {
    label: 'Compte & aide',
    items: [
      { id: 'r-team', label: 'Équipe', hint: 'Accès pour vos employés (caisse, cuisine)', icon: UserCog, soon: true },
      { id: 'r-settings', label: 'Paramètres', hint: 'Compte, notifications, sécurité et préférences', icon: SlidersHorizontal, alsoActive: RESTAURANT_SETTINGS_PAGES.map((p) => p.id) },
      { id: 'r-help', label: 'Aide & support', hint: 'Contacter l’équipe Affia Foods', icon: LifeBuoy, soon: true },
    ],
  },
];

export const NAV_BY_WORKSPACE: Record<Workspace, NavGroup[]> = { admin: ADMIN_NAV, restaurant: RESTAURANT_NAV };
export const DEFAULT_TAB: Record<Workspace, TabType> = { admin: 'map', restaurant: 'r-dashboard' };

export interface FlatNav { id: TabType; label: string; hint: string; soon?: boolean; parent?: string }

/** Screens that are not menu entries: sub-pages of the settings hub. */
const SUB_PAGES: FlatNav[] = [
  { id: 'settings-fees', label: 'Frais & commission', hint: 'Frais, commission, arrondi et règlements', parent: 'Paramètres' },
  { id: 'settings-account', label: 'Mon compte', hint: 'Votre profil et votre session', parent: 'Paramètres' },
  { id: 'templates', label: 'Modèles de messages', hint: 'SMS, e-mails et notifications envoyés automatiquement', soon: true, parent: 'Paramètres' },
  { id: 'legal', label: 'Documents légaux', hint: 'Conditions d’utilisation et confidentialité', soon: true, parent: 'Paramètres' },
  ...ADMIN_SETTINGS_PAGES.map((p): FlatNav => ({ id: p.id, label: p.title, hint: p.description, soon: true, parent: 'Paramètres' })),
  ...RESTAURANT_SETTINGS_PAGES.map((p): FlatNav => ({ id: p.id, label: p.title, hint: p.description, soon: true, parent: 'Paramètres' })),
];

const FLAT: FlatNav[] = [...SUB_PAGES, ...[...ADMIN_NAV, ...RESTAURANT_NAV].flatMap((group) => group.items.flatMap((item): FlatNav[] => (
  item.children
    ? item.children.map((child) => ({ id: child.id, label: child.label, hint: child.hint, soon: child.soon, parent: item.label }))
    : item.id ? [{ id: item.id, label: item.label, hint: item.hint, soon: item.soon }] : []
)))];

export const navItem = (id: TabType): FlatNav | undefined => FLAT.find((item) => item.id === id);
export const isSoon = (id: TabType): boolean => Boolean(navItem(id)?.soon);
/** The first screen of a parent (used when a collapsed rail parent is clicked). */
export const firstChild = (item: NavItem): TabType | undefined => item.children?.[0]?.id ?? item.id;

// ───────────────────────── URLs ─────────────────────────
// Each screen has its own address so a reload (or a shared link) lands on the same screen.
// Admin: /commandes, /restaurants… ; restaurant preview: /restaurant/<screen>.

const PATH_BY_TAB: Partial<Record<TabType, string>> = {
  map: 'tableau-de-bord', orders: 'commandes', attention: 'alertes', analytics: 'statistiques',
  applications: 'inscriptions', vendors: 'restaurants', drivers: 'livreurs', catalog: 'menus', contracts: 'contrats',
  customers: 'clients', reviews: 'avis', finance: 'finances', refunds: 'remboursements', commissions: 'commissions',
  'promo-codes': 'codes-promo', 'promo-offers': 'offres', referral: 'parrainage', notifications: 'notifications', campaigns: 'campagnes', segments: 'segments',
  zones: 'zones', prospecting: 'prospection', tickets: 'reclamations', 'help-center': 'aide',
  team: 'equipe', audit: 'journal', settings: 'parametres', 'settings-fees': 'parametres/frais', 'settings-account': 'parametres/compte', templates: 'modeles', legal: 'documents-legaux',
};

export const pathForTab = (tab: TabType): string => (tab.startsWith('r-') ? `/restaurant/${tab.slice(2)}` : `/${PATH_BY_TAB[tab] ?? (tab.startsWith('settings-') ? `parametres/${tab.slice('settings-'.length)}` : tab)}`);

export const tabForPath = (pathname: string): TabType => {
  const clean = pathname.replace(/\/+$/, '').replace(/^\//, '');
  if (clean === 'restaurant') return DEFAULT_TAB.restaurant;
  if (clean.startsWith('restaurant/')) {
    const tab = `r-${clean.slice('restaurant/'.length)}` as TabType;
    return navItem(tab) ? tab : DEFAULT_TAB.restaurant;
  }
  if (clean.startsWith('parametres/')) {
    const tab = `settings-${clean.slice('parametres/'.length)}` as TabType;
    if (navItem(tab)) return tab;
  }
  const found = (Object.entries(PATH_BY_TAB) as Array<[TabType, string]>).find(([, path]) => path === clean);
  return found ? found[0] : DEFAULT_TAB.admin;
};

export const workspaceOf = (tab: TabType): Workspace => (tab.startsWith('r-') ? 'restaurant' : 'admin');
