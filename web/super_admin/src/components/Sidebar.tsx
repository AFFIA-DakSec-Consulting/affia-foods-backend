import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftRight, ChevronDown, ChevronsUpDown, Clock3, LifeBuoy, LogOut, PanelLeftClose, PanelLeftOpen, SlidersHorizontal, X } from 'lucide-react';
import { AdminProfile, TabType } from '../types';
import { LogoBadge, LogoMark } from './ui/Logo';
import { Avatar } from './ui/Avatar';
import { NAV_BY_WORKSPACE, NavItem, Workspace, firstChild } from '../lib/navigation';
import { canOpen } from '../lib/permissions';

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  onLogout?: () => void;
  adminProfile?: AdminProfile;
  /** Switch between the admin menu and the restaurant-space preview. */
  onSwitchWorkspace?: () => void;
  /** Optional live counters shown on nav items (only rendered when > 0). */
  badges?: Partial<Record<TabType, number>>;
  /** Tabs whose badge means "something is wrong" (rendered in the danger colour instead of blue). */
  alertBadges?: Partial<Record<TabType, boolean>>;
  /** Which menu to show: the operations team, or a partner restaurant. */
  workspace?: Workspace;
}

const COLLAPSE_KEY = 'kraveo_admin_sidebar_collapsed';

const readCollapsed = (): boolean => {
  try { return window.localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
};

interface BodyProps extends Pick<SidebarProps, 'activeTab' | 'setActiveTab' | 'badges' | 'alertBadges' | 'workspace' | 'onLogout' | 'adminProfile' | 'onSwitchWorkspace'> {
  expanded: boolean;
  onNavigate?: () => void;
}

// "Bientôt disponible": a small clock instead of a text tag, so long labels are never cut.
const SoonTag: React.FC = () => (
  <span className="shrink-0 text-kraveo-ink3/60" title="Bientôt disponible"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" /><span className="sr-only">Bientôt disponible</span></span>
);

const Count: React.FC<{ count: number; alert: boolean }> = ({ count, alert }) => (
  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${alert ? 'bg-kraveo-danger/10 text-kraveo-danger' : 'bg-kraveo-g500/10 text-kraveo-g700'}`} aria-hidden="true">{count}</span>
);

/** Bottom card: who is signed in, with the role, and a menu that opens upwards (same pattern as the Eylos dashboard). */
const UserCard: React.FC<Pick<BodyProps, 'adminProfile' | 'workspace' | 'onLogout' | 'onSwitchWorkspace' | 'setActiveTab' | 'onNavigate' | 'expanded'>> = ({ adminProfile, workspace = 'admin', onLogout, onSwitchWorkspace, setActiveTab, onNavigate, expanded }) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const name = adminProfile?.name || 'Administrateur';
  const role = workspace === 'restaurant' ? 'Aperçu · Espace restaurant' : 'Super administrateur';

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const run = (action: () => void) => () => { setOpen(false); action(); };
  const item = 'flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm font-medium text-kraveo-ink2 transition-colors hover:bg-kraveo-night hover:text-kraveo-ink';

  return (
    <div ref={rootRef} className="relative border-t border-kraveo-line p-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Menu du compte"
        className={`flex w-full items-center gap-3 rounded-k-sm p-2 text-left transition-colors hover:bg-kraveo-night ${open ? 'bg-kraveo-night' : ''} ${expanded ? '' : 'justify-center'}`}
      >
        <span className="relative shrink-0">
          <Avatar name={name} />
          <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-kraveo-success" aria-hidden="true" />
        </span>
        {expanded && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-kraveo-ink">{name}</span>
              <span className="block truncate text-xs text-kraveo-ink3">{role}</span>
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-kraveo-ink3" aria-hidden="true" />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Compte"
          className={`absolute z-50 animate-scale-in overflow-hidden rounded-k-md border border-kraveo-line bg-white shadow-k-lift ${expanded ? 'bottom-full left-3 right-3 mb-2' : 'bottom-3 left-full ml-3 w-60'}`}
        >
          <div className="border-b border-kraveo-line px-3.5 py-3">
            <p className="truncate text-sm font-semibold text-kraveo-ink">{name}</p>
            <p className="truncate text-xs text-kraveo-ink3">{adminProfile?.phone || role}</p>
          </div>
          <div className="py-1">
            {workspace === 'admin' && (
              <button role="menuitem" className={item} onClick={run(() => { setActiveTab('settings'); onNavigate?.(); })}>
                <SlidersHorizontal className="h-4 w-4 text-kraveo-ink3" aria-hidden="true" /> Paramètres
              </button>
            )}
            <button role="menuitem" className={item} onClick={run(() => { setActiveTab(workspace === 'admin' ? 'help-center' : 'r-help'); onNavigate?.(); })}>
              <LifeBuoy className="h-4 w-4 text-kraveo-ink3" aria-hidden="true" /> Aide
            </button>
            {onSwitchWorkspace && (
              <button role="menuitem" className={item} onClick={run(() => { onSwitchWorkspace(); onNavigate?.(); })}>
                <ArrowLeftRight className="h-4 w-4 text-kraveo-ink3" aria-hidden="true" /> {workspace === 'restaurant' ? 'Retour à l’administration' : 'Aperçu de l’espace restaurant'}
              </button>
            )}
          </div>
          {onLogout && (
            <div className="border-t border-kraveo-line py-1">
              <button role="menuitem" className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left text-sm font-medium text-kraveo-danger transition-colors hover:bg-kraveo-danger/5" onClick={run(onLogout)}>
                <LogOut className="h-4 w-4" aria-hidden="true" /> Se déconnecter
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const SidebarBody: React.FC<BodyProps> = ({ activeTab, setActiveTab, badges, alertBadges, expanded, onNavigate, workspace = 'admin', onLogout, adminProfile, onSwitchWorkspace }) => {
  // Only the entries this team role may open; a group left empty disappears.
  const permissions = adminProfile?.permissions;
  const groups = useMemo(() => NAV_BY_WORKSPACE[workspace]
    .map((group) => ({
      ...group,
      items: group.items
        .map((item) => (item.children ? { ...item, children: item.children.filter((child) => canOpen(permissions, child.id)) } : item))
        .filter((item) => (item.children ? item.children.length > 0 : !item.id || canOpen(permissions, item.id))),
    }))
    .filter((group) => group.items.length > 0), [workspace, permissions]);
  // A parent whose child is the current screen is open; the admin can also open/close the others.
  const activeParent = useMemo(
    () => groups.flatMap((g) => g.items).find((item) => item.children?.some((child) => child.id === activeTab))?.label,
    [groups, activeTab],
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set(activeParent ? [activeParent] : []));
  useEffect(() => {
    if (activeParent) setOpen((current) => (current.has(activeParent) ? current : new Set(current).add(activeParent)));
  }, [activeParent]);

  const go = (tab: TabType) => { setActiveTab(tab); onNavigate?.(); };
  const toggle = (label: string) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(label)) next.delete(label); else next.add(label);
    return next;
  });
  const countOf = (ids: TabType[]) => ids.reduce((sum, id) => sum + (badges?.[id] ?? 0), 0);

  const rowClass = (active: boolean) => `group relative flex w-full items-center gap-3 rounded-k-sm px-3 py-2.5 text-left text-sm font-medium transition-colors duration-fast ${expanded ? '' : 'justify-center'} ${active ? 'bg-kraveo-surface2 text-kraveo-ink' : 'text-kraveo-ink2 hover:bg-kraveo-night hover:text-kraveo-ink'}`;
  const bar = <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-kraveo-g500" aria-hidden="true" />;
  const iconClass = (active: boolean) => `h-[18px] w-[18px] shrink-0 transition-colors ${active ? 'text-kraveo-g600' : 'text-kraveo-ink3 group-hover:text-kraveo-ink2'}`;
  const tooltip = (text: string) => (
    <span role="tooltip" className="pointer-events-none absolute left-full z-50 ml-3 hidden whitespace-nowrap rounded-k-sm bg-kraveo-ink px-3 py-1.5 text-xs font-semibold text-white shadow-k-lift group-hover:block group-focus-visible:block">{text}</span>
  );

  const renderLeaf = (item: NavItem) => {
    const Icon = item.icon;
    const id = item.id as TabType;
    const isActive = activeTab === id || Boolean(item.alsoActive?.includes(activeTab));
    const count = badges?.[id] ?? 0;
    const alert = Boolean(alertBadges?.[id]) && count > 0;
    return (
      <button
        key={id}
        onClick={() => go(id)}
        aria-label={count > 0 ? `${item.label} (${count})` : item.label}
        aria-current={isActive ? 'page' : undefined}
        title={expanded ? undefined : item.label}
        className={rowClass(isActive)}
      >
        {isActive && bar}
        <Icon className={iconClass(isActive)} aria-hidden="true" />
        {expanded && <span className={`min-w-0 flex-1 truncate ${item.soon && !isActive ? 'text-kraveo-ink3' : ''} ${isActive ? 'font-semibold' : ''}`}>{item.label}</span>}
        {expanded && item.soon && <SoonTag />}
        {count > 0 && (expanded
          ? <Count count={count} alert={alert} />
          : <span className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ${alert ? 'bg-kraveo-danger' : 'bg-kraveo-g500'}`} aria-hidden="true" />)}
        {!expanded && tooltip(`${item.label}${count > 0 ? ` (${count})` : ''}`)}
      </button>
    );
  };

  const renderParent = (item: NavItem) => {
    const Icon = item.icon;
    const children = item.children ?? [];
    const childIds = children.map((child) => child.id);
    const hasActive = childIds.includes(activeTab);
    const isOpen = expanded && open.has(item.label);
    const total = countOf(childIds);
    return (
      <div key={item.label}>
        <button
          onClick={() => (expanded ? toggle(item.label) : go(firstChild(item) as TabType))}
          aria-expanded={expanded ? isOpen : undefined}
          aria-label={total > 0 ? `${item.label} (${total})` : item.label}
          title={expanded ? undefined : item.label}
          className={rowClass(hasActive && !isOpen)}
        >
          {hasActive && !isOpen && bar}
          <Icon className={iconClass(hasActive)} aria-hidden="true" />
          {expanded && <span className={`min-w-0 flex-1 truncate ${hasActive ? 'font-semibold text-kraveo-ink' : ''}`}>{item.label}</span>}
          {expanded && total > 0 && <Count count={total} alert={false} />}
          {expanded && <ChevronDown className={`h-4 w-4 shrink-0 text-kraveo-ink3 transition-transform duration-base ease-emphasized ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />}
          {!expanded && tooltip(item.label)}
        </button>
        {isOpen && (
          <ul className="ml-[21px] mt-1 space-y-0.5 border-l border-kraveo-line pl-3">
            {children.map((child) => {
              const active = activeTab === child.id;
              const count = badges?.[child.id] ?? 0;
              return (
                <li key={child.id}>
                  <button
                    onClick={() => go(child.id)}
                    aria-current={active ? 'page' : undefined}
                    aria-label={count > 0 ? `${child.label} (${count})` : child.label}
                    className={`flex w-full items-center gap-2 rounded-k-sm px-3 py-2 text-left text-[13px] font-medium transition-colors duration-fast ${active ? 'bg-kraveo-surface2 font-semibold text-kraveo-ink' : 'text-kraveo-ink2 hover:bg-kraveo-night hover:text-kraveo-ink'}`}
                  >
                    <span className={`min-w-0 flex-1 truncate ${child.soon && !active ? 'text-kraveo-ink3' : ''}`}>{child.label}</span>
                    {child.soon && <SoonTag />}
                    {count > 0 && <Count count={count} alert={Boolean(alertBadges?.[child.id])} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  return (
    <>
      <nav aria-label="Principale" className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2 scrollbar-none">
        {groups.map((group, index) => (
          <div key={group.label} className={index === 0 ? '' : 'mt-6'}>
            {expanded
              ? <h3 className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-kraveo-ink3/80">{group.label}</h3>
              : index > 0 && <div className="mx-3 mb-3 h-px bg-kraveo-line" aria-hidden="true" />}
            <div className="space-y-1">
              {group.items.map((item) => (item.children ? renderParent(item) : renderLeaf(item)))}
            </div>
          </div>
        ))}
      </nav>
      <UserCard adminProfile={adminProfile} workspace={workspace} onLogout={onLogout} onSwitchWorkspace={onSwitchWorkspace} setActiveTab={setActiveTab} onNavigate={onNavigate} expanded={expanded} />
    </>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, mobileOpen, onCloseMobile, onLogout, adminProfile, onSwitchWorkspace, badges, alertBadges, workspace = 'admin' }) => {
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const closeRef = useRef<HTMLButtonElement>(null);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try { window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0'); } catch { /* preference is optional */ }
      return next;
    });
  };

  // Mobile drawer: Esc to close, lock page scroll, move focus in.
  useEffect(() => {
    if (!mobileOpen) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCloseMobile(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [mobileOpen, onCloseMobile]);

  const body = { activeTab, setActiveTab, badges, alertBadges, workspace, onLogout, adminProfile, onSwitchWorkspace };

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        aria-label="Barre latérale"
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-kraveo-line bg-white transition-[width] duration-base ease-emphasized lg:flex ${collapsed ? 'w-[76px]' : 'w-[264px]'}`}
      >
        <div className={`flex shrink-0 items-center ${collapsed ? 'flex-col justify-center gap-2 px-2 py-4' : 'h-[76px] justify-between px-5'}`}>
          {collapsed && <LogoMark size={32} />}
          {!collapsed && (
            <div className="flex min-w-0 items-center gap-3">
              <LogoMark size={40} />
              <div className="min-w-0">
                <p className="truncate font-display text-base font-extrabold leading-tight tracking-tight text-kraveo-ink">Affia Foods</p>
                <p className="truncate text-[11px] font-medium text-kraveo-ink3">{workspace === 'restaurant' ? 'Espace restaurant' : 'Administration · Thiès'}</p>
              </div>
            </div>
          )}
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Déplier la barre latérale' : 'Replier la barre latérale'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Déplier la barre latérale' : 'Replier la barre latérale'}
            className="rounded-k-sm p-2 text-kraveo-ink3 transition-colors hover:bg-kraveo-night hover:text-kraveo-ink"
          >
            {collapsed ? <PanelLeftOpen className="h-5 w-5" aria-hidden="true" /> : <PanelLeftClose className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
        <SidebarBody {...body} expanded={!collapsed} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-kraveo-g950/40 backdrop-blur-sm" onClick={onCloseMobile} aria-hidden="true" />
          <aside role="dialog" aria-modal="true" aria-label="Navigation" className="absolute inset-y-0 left-0 flex w-[290px] max-w-[88vw] animate-slide-in-left flex-col bg-white shadow-k-lift">
            <div className="flex h-[76px] shrink-0 items-center justify-between gap-3 px-5">
              <LogoBadge imgClassName="h-9" />
              <button ref={closeRef} aria-label="Fermer la navigation" onClick={onCloseMobile} className="k-icon-btn"><X className="h-4 w-4" aria-hidden="true" /></button>
            </div>
            <SidebarBody {...body} expanded onNavigate={onCloseMobile} />
          </aside>
        </div>
      )}
    </>
  );
};
