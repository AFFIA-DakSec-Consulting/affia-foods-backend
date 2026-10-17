// What a team role may open in the dashboard. The server is the authority (it answers 403 PERMISSION_DENIED); this only hides what would be refused.
// The groups and their paths mirror backend/src/services/adminTeam.ts.
import type { TabType } from './navigation';

export type PermissionGroup = 'ops' | 'finance' | 'marketing' | 'support' | 'content' | 'prospecting' | 'stats' | 'team';

export const ADMIN_ROLES = ['SUPER_ADMIN', 'OPERATIONS', 'FINANCE', 'SUPPORT', 'MARKETING', 'VIEWER'] as const;
export type AdminRoleId = (typeof ADMIN_ROLES)[number];
export const ROLE_LABEL: Record<AdminRoleId, string> = { SUPER_ADMIN: 'Super admin', OPERATIONS: 'Opérations', FINANCE: 'Finance', SUPPORT: 'Support', MARKETING: 'Marketing', VIEWER: 'Lecture seule' };
export const ROLE_HINT: Record<AdminRoleId, string> = {
  SUPER_ADMIN: 'Tout, y compris l’équipe et les accès.',
  OPERATIONS: 'Commandes, partenaires, clients, support, contenus et prospection ; consulte la finance et le marketing.',
  FINANCE: 'Revenus, règlements, commissions et frais ; consulte les commandes et les clients.',
  SUPPORT: 'Réclamations, avis, commandes, clients et contenus.',
  MARKETING: 'Promotions, campagnes, modules, zones, contenus et prospection ; consulte les clients (segments).',
  VIEWER: 'Consulte tout sauf l’équipe, ne modifie rien. Pour un associé, un comptable ou un stagiaire.',
};

export type AccessLevel = 'read' | 'write';
/** What each role may do in each section (the same table as backend/src/services/adminTeam.ts, shown so nobody has to guess). */
export const ROLE_ACCESS: Record<AdminRoleId, Partial<Record<PermissionGroup, AccessLevel>>> = {
  SUPER_ADMIN: { ops: 'write', finance: 'write', marketing: 'write', support: 'write', content: 'write', prospecting: 'write', stats: 'write', team: 'write' },
  OPERATIONS: { ops: 'write', support: 'write', content: 'write', prospecting: 'write', stats: 'write', finance: 'read', marketing: 'read' },
  FINANCE: { finance: 'write', stats: 'write', ops: 'read' },
  SUPPORT: { support: 'write', ops: 'write', content: 'write', stats: 'write' },
  MARKETING: { marketing: 'write', content: 'write', prospecting: 'write', stats: 'write', ops: 'read' },
  VIEWER: { ops: 'read', finance: 'read', marketing: 'read', support: 'read', content: 'read', prospecting: 'read', stats: 'read' },
};
export const GROUP_LABEL: Record<PermissionGroup, string> = {
  ops: 'Opérations', finance: 'Finance', marketing: 'Marketing', support: 'Support', content: 'Contenus', prospecting: 'Prospection', stats: 'Statistiques', team: 'Équipe',
};

const TAB_GROUP: Partial<Record<TabType, PermissionGroup>> = {
  map: 'ops', orders: 'ops', attention: 'ops', refunds: 'ops', applications: 'ops', vendors: 'ops', drivers: 'ops', catalog: 'ops', customers: 'ops', segments: 'ops',
  analytics: 'stats',
  finance: 'finance', commissions: 'finance', 'settings-fees': 'finance', 'settings-payments': 'finance', 'settings-export': 'finance',
  'promo-codes': 'marketing', 'promo-offers': 'marketing', referral: 'marketing', notifications: 'marketing', campaigns: 'marketing', plans: 'marketing', loyalty: 'marketing',
  'courier-bonuses': 'marketing', modules: 'marketing', simulator: 'marketing', zones: 'marketing', 'service-areas': 'marketing', 'settings-orders': 'marketing',
  tickets: 'support', reviews: 'support',
  'help-center': 'content', contracts: 'content', legal: 'content',
  prospecting: 'prospecting',
  team: 'team', audit: 'team',
};

/** The group a screen needs. Screens that are not listed (settings hub, own account, restaurant preview) need nothing special, except the restaurant preview which reads operations data. */
export const groupOfTab = (tab: TabType): PermissionGroup | null => TAB_GROUP[tab] ?? (tab.startsWith('r-') ? 'ops' : null);

/** `permissions` missing = an older server or the owner: everything is open. */
export const canOpen = (permissions: readonly string[] | undefined, tab: TabType): boolean => {
  const group = groupOfTab(tab);
  return !permissions || group === null || permissions.includes(group);
};

export const canUse = (permissions: readonly string[] | undefined, group: PermissionGroup): boolean => !permissions || permissions.includes(group);

/** Where to land when the default screen is not allowed. */
export const firstAllowedTab = (permissions: readonly string[] | undefined, candidates: readonly TabType[]): TabType | null => candidates.find((tab) => canOpen(permissions, tab)) ?? null;

/** True when the role can open the screen but not change anything in it. `access` missing = write everywhere (owner, older server). */
export const isReadOnlyTab = (access: Record<string, AccessLevel> | undefined, tab: TabType): boolean => {
  const group = groupOfTab(tab);
  return Boolean(access && group && access[group] === 'read');
};
