import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { RefreshCw } from 'lucide-react';
import { ApiError, SOCKET_URL, apiService, clearAuthToken, getAuthToken } from '../services/api';
import { AdminProfile, Order, OrderStatus, Vendor } from '../types';
import { PartnerSession } from '../lib/partnerSignup';
import { DEFAULT_TAB, TabType, isSoon, pathForTab, tabForPath, workspaceOf } from '../lib/navigation';
import { isSessionRejected, sessionRetryDelayMs } from '../lib/adminMessages';
import { mergeOrderLists, upsertOrder } from '../lib/orders';
import { soonPageOf } from '../lib/settingsCatalog';
import { ORDER_STATUS_LABEL } from '../lib/tokens';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { LogoMark } from './ui/Logo';
import { useToast } from './ui/Toast';
import { useConfirm } from './ui/ConfirmDialog';
import { PartnerPendingScreen } from './PartnerPendingScreen';
import { RestaurantDashboard } from './RestaurantDashboard';
import { RestaurantOrderPanel } from './RestaurantOrderPanel';
import { RestaurantProfilePage } from './RestaurantProfilePage';
import { AccountPage, SettingsHub, SettingsPageHeader, SettingsSoonPage } from './SettingsHub';
import { normalizeOrderPartial } from '../types';
import type { VendorProfile } from '../lib/vendorProfile';
import type { SavedPin } from '../lib/vendorLocation';

const POLL_MS = 10_000;
const PAGE = 100;

interface Props { onLogout: () => void }

const restaurantTab = (pathname: string): TabType => {
  const tab = tabForPath(pathname);
  return workspaceOf(tab) === 'restaurant' ? tab : DEFAULT_TAB.restaurant;
};

/** The restaurant's own session: its application first, then (once approved) its dashboard, profile and orders. */
export const RestaurantApp: React.FC<Props> = ({ onLogout }) => {
  const [session, setSession] = useState<PartnerSession | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const wasApproved = useRef<boolean | null>(null);
  const toast = useToast();

  const logout = useCallback(() => { clearAuthToken(); onLogout(); }, [onLogout]);

  // First read of "where do I stand". A rejected token (password reset by the team, account closed) ends the session; a network blip only retries.
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const load = (attempt: number) => {
      apiService.fetchPartnerMe()
        .then((s) => { if (!cancelled) { setUnreachable(false); setSession(s); } })
        .catch((error) => {
          if (cancelled) return;
          if (isSessionRejected(error)) { logout(); return; }
          setUnreachable(true);
          timer = window.setTimeout(() => load(attempt + 1), sessionRetryDelayMs(attempt));
        });
    };
    load(0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [logout]);

  const approved = session?.approvalStatus === 'APPROVED';
  useEffect(() => {
    if (!session) return;
    if (wasApproved.current === false && approved) toast.success('Votre restaurant est approuvé', 'Complétez votre fiche, puis ouvrez le restaurant pour recevoir des commandes.');
    wasApproved.current = approved;
  }, [approved, session, toast]);

  if (!session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-kraveo-night" role="status" aria-live="polite">
        <div className="animate-scale-in"><LogoMark size={64} /></div>
        <p className="flex items-center gap-2 text-sm font-semibold text-kraveo-ink2"><RefreshCw className="h-4 w-4 animate-spin text-kraveo-g600" aria-hidden="true" />{unreachable ? 'Serveur injoignable, nouvelle tentative…' : 'Ouverture de votre espace…'}</p>
        {unreachable && <button type="button" className="k-btn-ghost !min-h-[36px] text-xs" onClick={logout}>Se reconnecter plutôt</button>}
      </div>
    );
  }

  if (!approved || !session.vendor) return <PartnerPendingScreen session={session} onSession={setSession} onLogout={logout} />;
  return <RestaurantShell session={session} onSession={setSession} onLogout={logout} />;
};

// ─────────────────────────── Approved restaurant ───────────────────────────
const RestaurantShell: React.FC<{ session: PartnerSession; onSession: (s: PartnerSession) => void; onLogout: () => void }> = ({ session, onSession, onLogout }) => {
  const toast = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [activeTab, setActiveTab] = useState<TabType>(() => restaurantTab(window.location.pathname));
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [vendor, setVendor] = useState<Vendor>(session.vendor!);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [openBusy, setOpenBusy] = useState(false);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const ordersRef = useRef<Order[]>([]);
  ordersRef.current = orders;

  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(t); }, []);

  useEffect(() => {
    const path = pathForTab(activeTab);
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
    const onPop = () => setActiveTab(restaurantTab(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [activeTab]);

  const sessionEnded = useCallback((e: unknown) => { if (isSessionRejected(e)) { onLogout(); return true; } return false; }, [onLogout]);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [{ orders: fetched }, me] = await Promise.all([apiService.fetchOrderPage(null, PAGE), apiService.fetchPartnerMe()]);
      setOrders((local) => mergeOrderLists(local, fetched));
      setError('');
      if (me.approvalStatus !== 'APPROVED') onSession(me); // suspended meanwhile: back to the status screen
      else if (me.vendor) setVendor((v) => ({ ...v, ...me.vendor }));
    } catch (e) {
      if (sessionEnded(e)) return;
      if (!quiet) setError(e instanceof Error ? e.message : 'Impossible de charger vos commandes.');
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [onSession, sessionEnded]);

  // The server is the source of truth: poll while the page is visible. Sockets only make new orders appear sooner.
  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(true); }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const socket = io(SOCKET_URL, { auth: { token: getAuthToken() }, transports: ['websocket', 'polling'], reconnection: true, reconnectionAttempts: Infinity, reconnectionDelay: 1_000, reconnectionDelayMax: 10_000 });
    socket.on('connect', () => setLive(true));
    socket.on('disconnect', (reason: string) => { setLive(false); if (reason === 'io server disconnect') socket.connect(); });
    socket.on('connect_error', () => setLive(false));
    const apply = (raw: unknown) => {
      const incoming = normalizeOrderPartial(raw);
      if (incoming?.id) setOrders((list) => upsertOrder(list, incoming as Partial<Order> & { id: string }));
    };
    socket.on('order_updated', apply);
    socket.on('new_order_alert', (raw: unknown) => { apply(raw); toast.info('Nouvelle commande', 'Une commande vient d’arriver.'); });
    return () => { socket.removeAllListeners(); socket.disconnect(); };
  }, [toast]);

  const advance = async (orderId: string, status: OrderStatus): Promise<boolean> => {
    try {
      const updated = await apiService.updateOrderStatus(orderId, status);
      setOrders((list) => upsertOrder(list, updated));
      toast.success('Commande mise à jour', `Statut : ${ORDER_STATUS_LABEL[updated.status] ?? status}.`);
      return true;
    } catch (e) {
      if (sessionEnded(e)) return false;
      toast.error('Statut non modifié', e instanceof ApiError ? e.message : 'Réessayez dans un instant.');
      refresh(true);
      return false;
    }
  };

  const reject = async (orderId: string, reason: string): Promise<string | null> => {
    try {
      const updated = await apiService.rejectOrder(orderId, reason);
      if (updated) setOrders((list) => upsertOrder(list, updated));
      toast.success('Commande refusée', 'Le client a été prévenu et sera remboursé.');
      return null;
    } catch (e) {
      if (sessionEnded(e)) return null;
      return e instanceof Error ? e.message : 'Refus impossible.';
    }
  };

  const toggleOpen = async () => {
    if (openBusy) return;
    const next = !vendor.isAcceptingOrders;
    if (!next && !(await confirm({ title: `Fermer ${vendor.name} ?`, message: 'Les clients ne peuvent plus commander tant que vous ne rouvrez pas.', confirmLabel: 'Fermer le restaurant', danger: true }))) return;
    setOpenBusy(true);
    setVendor((v) => ({ ...v, isAcceptingOrders: next }));
    try {
      const updated = await apiService.toggleVendorStatus(vendor.id, next);
      setVendor((v) => ({ ...v, isAcceptingOrders: updated.isAcceptingOrders }));
      toast.success(updated.isAcceptingOrders ? 'Restaurant ouvert' : 'Restaurant fermé', updated.isAcceptingOrders ? 'Les clients peuvent commander.' : 'Plus de nouvelles commandes.');
    } catch (e) {
      setVendor((v) => ({ ...v, isAcceptingOrders: !next }));
      if (!sessionEnded(e)) toast.error('Changement refusé', e instanceof Error ? e.message : 'Réessayez.');
    } finally {
      setOpenBusy(false);
    }
  };

  const profileSaved = useCallback((_id: string, profile: VendorProfile) => setVendor((v) => ({ ...v, ...profile, bannerImage: profile.bannerImage || v.bannerImage })), []);
  const locationSaved = useCallback((_id: string, saved: SavedPin) => setVendor((v) => ({ ...v, ...saved })), []);
  const select = useCallback((tab: TabType) => { setActiveTab(tab); setMobileNavOpen(false); }, []);

  const profile = useMemo<AdminProfile>(() => ({ id: session.user.id, name: vendor.name, phone: session.user.phone, role: 'ADMIN' }), [session.user, vendor.name]);
  const vendors = useMemo(() => [vendor], [vendor]);
  const opened = openedId ? orders.find((o) => o.id === openedId) ?? null : null;
  const active = orders.filter((o) => o.status !== 'DELIVERED' && o.status !== 'CANCELLED').length;

  return (
    <div className="min-h-screen bg-kraveo-night text-kraveo-ink lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[90] focus:rounded-k-sm focus:bg-kraveo-g400 focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-kraveo-g950">Aller au contenu</a>
      <Sidebar activeTab={activeTab} setActiveTab={select} mobileOpen={mobileNavOpen} onCloseMobile={() => setMobileNavOpen(false)} badges={{ 'r-dashboard': active }} workspace="restaurant" onLogout={onLogout} adminProfile={profile} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header activeTab={activeTab} isLiveConnected={live} isLoading={loading} adminProfile={profile} onRefresh={() => refresh()} onLogout={onLogout} onOpenMenu={() => setMobileNavOpen(true)} query="" onQueryChange={() => {}} workspace="restaurant" hideSearch />
        {error && (
          <div role="alert" className="mx-4 mt-4 flex items-center justify-between gap-3 rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 px-4 py-3 text-sm text-kraveo-ink sm:mx-6">
            <span className="min-w-0">{error}</span>
            <button className="k-btn-ghost !min-h-[36px] !px-3 text-xs" onClick={() => refresh()}>Réessayer</button>
          </div>
        )}
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 pb-12 outline-none sm:p-8 sm:pb-14">
          <div key={activeTab} className="mx-auto w-full max-w-[1480px] animate-fade-up">
            {isSoon(activeTab) && soonPageOf(activeTab) && <SettingsSoonPage id={activeTab} onBack={() => select('r-settings')} />}
            {activeTab === 'r-dashboard' && <RestaurantDashboard vendors={vendors} orders={orders} vendorId={vendor.id} onVendorChange={() => {}} now={now} onAdvance={advance} onToggleOpen={toggleOpen} openBusy={openBusy} onOpenOrder={setOpenedId} onNavigate={select} loading={loading} />}
            {activeTab === 'r-profile' && <RestaurantProfilePage vendorId={vendor.id} title="Profil du restaurant" subtitle="Votre vitrine : logo, photo, description, adresse et contact, tels que les voient les clients." sections={['identity', 'address', 'contact', 'prep']} vendors={vendors} onSaved={profileSaved} onLocationSaved={locationSaved} onAuthError={sessionEnded} own />}
            {activeTab === 'r-hours' && <RestaurantProfilePage vendorId={vendor.id} title="Horaires & ouverture" subtitle="Les jours et les heures où le restaurant prend des commandes." sections={['hours']} vendors={vendors} onSaved={profileSaved} onAuthError={sessionEnded} own />}
            {activeTab === 'r-settings' && <SettingsHub workspace="restaurant" onNavigate={select} onLogout={onLogout} />}
            {activeTab === 'settings-account' && (<><SettingsPageHeader title="Mon compte" subtitle="Votre profil et votre session." onBack={() => select('r-settings')} /><AccountPage adminProfile={profile} onLogout={onLogout} /></>)}
          </div>
        </main>
      </div>
      <RestaurantOrderPanel order={opened} onClose={() => setOpenedId(null)} onReject={reject} />
      {confirmDialog}
    </div>
  );
};
