import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { RestaurantDashboard } from './components/RestaurantDashboard';
import { RestaurantProfilePage } from './components/RestaurantProfilePage';
import type { VendorProfile } from './lib/vendorProfile';
import { AccountPage, SettingsHub, SettingsPageHeader, SettingsSoonPage } from './components/SettingsHub';
import { ModulesPanel } from './components/ModulesPanel';
import { SimulatorPanel } from './components/SimulatorPanel';
import { ZonesPanel } from './components/ZonesPanel';
import { ServiceAreasPanel } from './components/ServiceAreasPanel';
import { PromotionsPanel } from './components/PromotionsPanel';
import { BonusesPanel, LoyaltyPanel, PlansPanel } from './components/RulesCrud';
import { CampaignsPanel } from './components/CampaignsPanel';
import { TicketsPanel } from './components/TicketsPanel';
import { ReviewsPanel } from './components/ReviewsPanel';
import { CommissionsPanel, RefundsPanel } from './components/FinanceExtraPanels';
import { SegmentsPanel } from './components/SegmentsPanel';
import { LegalDocumentsPanel } from './components/LegalDocumentsPanel';
import { HelpCenterPanel } from './components/HelpCenterPanel';
import { SecurityPanel } from './components/SecurityPanel';
import { TeamPanel } from './components/TeamPanel';
import { ProspectsPanel } from './components/ProspectsPanel';
import { ReferralPanel } from './components/ReferralPanel';
import { RestaurantMenuPage, RestaurantOrdersPage, RestaurantPayoutsPage, RestaurantPromotionsPage, RestaurantReviewsPage, RestaurantStatsPage } from './components/RestaurantPages';
import { ExportPage, NotificationsPanel, OrderRulesPage, PaymentsSettingsPage } from './components/AdminExtraPages';
import { AuditPanel } from './components/AuditPanel';
import { LiveCountersBar } from './components/LiveCountersBar';
import { ReconcilePanel } from './components/ReconcilePanel';
import { LiveCommandCenter } from './components/LiveCommandCenter';
import { PlatformOverview } from './components/PlatformOverview';
import { OrdersTable } from './components/OrdersTable';
import { VendorManager } from './components/VendorManager';
import { DriverManager } from './components/DriverManager';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { ApplicationsPanel } from './components/ApplicationsPanel';
import { CustomersPanel } from './components/CustomersPanel';
import { CatalogPanel } from './components/CatalogPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { FinancePanel } from './components/FinancePanel';
import type { PendingCounts, VendorCommission } from './lib/catalogParse';
import { AdminProfile, AttentionEntry, DriverPartner, DriverPin, Order, OrderStatus, TabType, Vendor, normalizeDriverPin, normalizeOrderPartial } from './types';
import { ApiError, apiService, clearAuthToken, getAuthToken, isAuthenticated as hasSession, SOCKET_URL } from './services/api';
import { LoginScreen } from './components/LoginScreen';
import { LogoMark } from './components/ui/Logo';
import { useToast } from './components/ui/Toast';
import { ORDER_STATUS_LABEL } from './lib/tokens';
import { RefreshCw, ShieldCheck, X } from 'lucide-react';
import { NeedsAttentionPanel } from './components/NeedsAttentionPanel';
import { EmptyState } from './components/ui/EmptyState';
import { soonPageOf } from './lib/settingsCatalog';
import { DEFAULT_TAB, Workspace, isSoon, navItem, pathForTab, tabForPath, workspaceOf } from './lib/navigation';
import { Construction } from 'lucide-react';
import { DrawerMode, OrderDrawer } from './components/OrderDrawer';
import { appendOlderPage, mergeInto, mergeOrderLists, oldestOrderId, patchOrder, restoreIfUntouched, upsertOrder } from './lib/orders';
import { sameData } from './lib/dashboardStats';
import { AdminRoleId, ROLE_LABEL, canOpen, isReadOnlyTab, canUse, firstAllowedTab, groupOfTab, GROUP_LABEL, PermissionGroup } from './lib/permissions';
import { isSessionRejected, reassignFailureMessage, sessionRetryDelayMs } from './lib/adminMessages';
import { useConfirm } from './components/ui/ConfirmDialog';
import { localAttention, pruneWithLiveOrders } from './lib/orderProblems';
import { CancelOutcome, cancelToastText, reassignWholeGroupText } from './lib/orderGroups';
import { SavedPin, vendorsNeedingLocation } from './lib/vendorLocation';
import { mergeRiderPins, newestPerRider, replaceRiderPins } from './lib/riderMarkers';

/** Contract 3: sockets are only a speed-up; the REST list is polled while the page is visible. */
const POLL_MS = 15_000;
const ATTENTION_DEBOUNCE_MS = 1_500;
/** Rider position events are applied to the map at most this often. */
const LOCATION_FLUSH_MS = 1_000;
/** One page of "Load older" orders. */
const OLDER_PAGE_SIZE = 100;

/** Thrown inside an order action when the admin answers "no" to a question: roll back quietly, no error toast. */
class ActionCancelled extends Error {}

/** Makes the server's rider errors readable (see lib/adminMessages). */
const plainReassignError = (error: unknown): unknown => (error instanceof ApiError
  ? new ApiError(error.status, reassignFailureMessage(error.code, error.message), error.code, error.field)
  : error);

export const App: React.FC = () => {
  const [isAuth, setIsAuth] = useState(false);
  const [authChecking, setAuthChecking] = useState(true);
  const [adminProfile, setAdminProfile] = useState<AdminProfile | undefined>();
  // The address is the source of truth at load: a reload lands on the same screen.
  const [activeTab, setActiveTab] = useState<TabType>(() => tabForPath(window.location.pathname));
  // Admin menu, or a preview of the partner-restaurant menu (its screens are not built yet).
  const workspace: Workspace = workspaceOf(activeTab);
  useEffect(() => {
    const path = pathForTab(activeTab);
    if (window.location.pathname !== path) window.history.pushState(null, '', path);
    const onPop = () => setActiveTab(tabForPath(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [activeTab]);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // The restaurant the admin is previewing in the restaurant space (restaurants have no web login yet).
  const [previewVendorId, setPreviewVendorId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const toast = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [orders, setOrders] = useState<Order[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [driverPartners, setDriverPartners] = useState<DriverPartner[]>([]);
  const [drivers, setDrivers] = useState<DriverPin[]>([]);
  const [pendingApplications, setPendingApplications] = useState(0);
  const [pendingDishes, setPendingDishes] = useState<PendingCounts>({ pending: 0, changePending: 0, total: 0 });
  const [pendingSettlements, setPendingSettlements] = useState(0);
  const [applicationsKey, setApplicationsKey] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  // The stored session could not be checked because the server was unreachable (the token is kept and the check retried).
  const [sessionUnreachable, setSessionUnreachable] = useState(false);
  // "Load older": whether the server has more orders than the ones loaded, and whether a page is being fetched.
  const [hasMoreOrders, setHasMoreOrders] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const olderLoadedRef = useRef(false);
  // Restaurants whose open/close request is in flight (the switch is disabled meanwhile).
  const [busyVendorIds, setBusyVendorIds] = useState<ReadonlySet<string>>(() => new Set());
  const busyVendorRef = useRef<Set<string>>(new Set());
  const { confirm, dialog: confirmDialog } = useConfirm();
  // Needs-attention list (server). `available: false` = old server without the endpoint -> local fallback.
  const [attention, setAttention] = useState<{ available: boolean | null; entries: AttentionEntry[]; loading: boolean; error: string; checkedAt: number | null }>(
    { available: null, entries: [], loading: false, error: '', checkedAt: null },
  );
  // Order drawer: the id to show; `drawerFallback` holds a copy for orders outside the loaded page.
  const [drawer, setDrawer] = useState<{ id: string; mode: DrawerMode } | null>(null);
  const [drawerFallback, setDrawerFallback] = useState<Order | null>(null);
  const [drawerLoad, setDrawerLoad] = useState<{ loading: boolean; error: string }>({ loading: false, error: '' });
  const ordersRef = useRef<Order[]>([]);
  ordersRef.current = orders;
  const vendorsRef = useRef<Vendor[]>([]);
  vendorsRef.current = vendors;
  const attentionTimer = useRef<number | undefined>(undefined);
  // What this team role may call. Missing = everything (owner, older server). Calls the role cannot make are skipped, not sent to be refused.
  const permsRef = useRef<readonly string[] | undefined>(undefined);
  permsRef.current = adminProfile?.permissions;
  const allows = (group: PermissionGroup): boolean => canUse(permsRef.current, group);

  const handleAuthFailure = useCallback((error: unknown) => {
    if (isSessionRejected(error)) {
      clearAuthToken();
      setIsAuth(false);
      setAdminProfile(undefined);
    }
    setErrorMessage(error instanceof Error ? error.message : 'La requête a échoué.');
  }, []);

  // Panels keep their own inline error message; this only logs the admin out when the session is no longer valid.
  const handleSessionError = useCallback((error: unknown) => {
    if (isSessionRejected(error)) {
      clearAuthToken();
      setIsAuth(false);
      setAdminProfile(undefined);
    }
  }, []);

  const refreshPendingCount = useCallback(async () => {
    if (!getAuthToken() || !canUse(permsRef.current, 'ops')) return;
    try {
      const result = await apiService.fetchApplications('PENDING');
      setPendingApplications(result.counts.PENDING);
    } catch { /* the badge is a nicety; the Applications tab shows real errors */ }
  }, []);

  // Dishes waiting for approval (sidebar badge). Quiet on failure: the Catalog tab shows real errors.
  const refreshPendingDishes = useCallback(async () => {
    if (!getAuthToken() || !canUse(permsRef.current, 'ops')) return;
    try {
      const counts = await apiService.fetchCatalogPendingCounts();
      // Same numbers = same object, so the Catalog tab does not re-render on every poll.
      setPendingDishes((current) => (current.pending === counts.pending && current.changePending === counts.changePending && current.total === counts.total ? current : counts));
    } catch { /* the badge is a nicety */ }
  }, []);

  // Settlements waiting to be paid (sidebar badge). Quiet on failure: the Finance tab shows real errors.
  const refreshPendingSettlements = useCallback(async () => {
    if (!getAuthToken() || !canUse(permsRef.current, 'finance')) return;
    try {
      const count = await apiService.fetchPendingSettlementCount();
      setPendingSettlements((current) => (current === count ? current : count));
    } catch { /* the badge is a nicety */ }
  }, []);

  const loadAttention = useCallback(async () => {
    if (!getAuthToken() || !canUse(permsRef.current, 'ops')) return;
    setAttention((current) => ({ ...current, loading: true }));
    try {
      const result = await apiService.fetchNeedsAttention();
      setAttention({ available: result.available, entries: result.entries, loading: false, error: '', checkedAt: Date.now() });
    } catch (error) {
      handleSessionError(error);
      setAttention((current) => ({ ...current, loading: false, error: error instanceof Error ? error.message : 'La liste « Alertes » n’a pas pu être chargée.' }));
    }
  }, [handleSessionError]);

  /** Many socket events in a burst trigger one reload. */
  const scheduleAttention = useCallback(() => {
    window.clearTimeout(attentionTimer.current);
    attentionTimer.current = window.setTimeout(loadAttention, ATTENTION_DEBOUNCE_MS);
  }, [loadAttention]);

  /** Background poll: no spinner, no error banner (the live socket or the next poll catches up). */
  const silentRefresh = useCallback(async () => {
    if (!getAuthToken()) return;
    if (!canUse(permsRef.current, 'ops')) { refreshPendingSettlements(); return; }
    try {
      const page = await apiService.fetchOrderPage();
      setOrders((current) => mergeOrderLists(current, page.orders, { keepOlder: olderLoadedRef.current }));
      if (!olderLoadedRef.current) setHasMoreOrders(page.nextCursor !== null);
    } catch (error) {
      handleSessionError(error);
    }
    // Restaurants (open/closed, map pin) and the rider roster (duty) have no live event for every change: refetch them too,
    // and only replace the state when something really changed, so an idle poll re-renders nothing.
    apiService.fetchVendors()
      .then((fresh) => { if (busyVendorRef.current.size === 0) setVendors((current) => (sameData(current, fresh) ? current : fresh)); })
      .catch(() => { /* the next poll catches up */ });
    apiService.fetchDrivers()
      .then((fresh) => setDriverPartners((current) => (sameData(current, fresh) ? current : fresh)))
      .catch(() => { /* the next poll catches up */ });
    // Rider positions too: after a missed socket event the next poll puts every marker right again (no change = no re-render).
    apiService.fetchDriverLocations().then((fresh) => setDrivers((current) => replaceRiderPins(current, fresh))).catch(() => { /* the live socket or the next poll catches up */ });
    refreshPendingDishes();
    refreshPendingSettlements();
    loadAttention();
  }, [handleSessionError, loadAttention, refreshPendingDishes, refreshPendingSettlements]);

  const fetchBackendData = useCallback(async () => {
    if (!getAuthToken()) return;
    if (!canUse(permsRef.current, 'ops')) { refreshPendingSettlements(); return; } // no operations data for this role
    setIsLoading(true);
    setErrorMessage('');
    const results = await Promise.allSettled([
      apiService.fetchOrderPage(),
      apiService.fetchVendors(),
      apiService.fetchDrivers(),
      apiService.fetchDriverLocations(),
    ]);
    const [ordersResult, vendorsResult, driversResult, locationsResult] = results;
    if (ordersResult.status === 'fulfilled') {
      setOrders((current) => mergeOrderLists(current, ordersResult.value.orders, { keepOlder: olderLoadedRef.current }));
      if (!olderLoadedRef.current) setHasMoreOrders(ordersResult.value.nextCursor !== null);
    }
    if (vendorsResult.status === 'fulfilled') setVendors(vendorsResult.value);
    if (driversResult.status === 'fulfilled') setDriverPartners(driversResult.value);
    if (locationsResult.status === 'fulfilled') setDrivers((current) => replaceRiderPins(current, locationsResult.value));
    const firstError = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (firstError) handleAuthFailure(firstError.reason);
    setIsLoading(false);
    refreshPendingCount();
    refreshPendingDishes();
    refreshPendingSettlements();
    loadAttention();
  }, [handleAuthFailure, refreshPendingCount, refreshPendingDishes, refreshPendingSettlements, loadAttention]);

  // Check the stored session. Only a rejected token (401/403) ends it; if the server or network is down the token is
  // kept and the check retries with a growing delay, so a blip never throws away a valid 30-day session.
  useEffect(() => {
    if (!hasSession()) {
      setAuthChecking(false);
      return undefined;
    }
    let cancelled = false;
    let timer: number | undefined;
    const check = (attempt: number) => {
      apiService.validateSession()
        .then((profile) => {
          if (cancelled || !getAuthToken()) return;
          setSessionUnreachable(false);
          setAdminProfile(profile);
          setIsAuth(true);
          setAuthChecking(false);
        })
        .catch((error) => {
          if (cancelled) return;
          if (isSessionRejected(error)) {
            clearAuthToken();
            handleAuthFailure(error);
            setSessionUnreachable(false);
            setAuthChecking(false);
            return;
          }
          setSessionUnreachable(true);
          timer = window.setTimeout(() => check(attempt + 1), sessionRetryDelayMs(attempt));
        });
    };
    check(0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [handleAuthFailure]);

  useEffect(() => {
    if (!isAuth) return undefined;
    fetchBackendData();

    const token = getAuthToken();
    const socket = io(SOCKET_URL, {
      auth: { token },
      transports: ['websocket', 'polling'],
      // Never give up: a server restart or a Wi-Fi outage of any length must heal by itself.
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 10_000,
    });
    let connectedBefore = false;
    socket.on('connect', () => {
      setIsLiveConnected(true);
      // The server answers join_room with { ok }; without the admins room no admin events arrive.
      socket.emit('join_room', 'admins', (reply: { ok?: boolean } | undefined) => {
        if (reply && reply.ok === false) {
          setIsLiveConnected(false);
          toast.error('Mises à jour en direct refusées', 'Le serveur n’a pas autorisé cette session à rejoindre l’espace admin. Reconnectez-vous.');
        }
      });
      // After a reconnect, events sent while we were offline are lost: catch up from REST.
      if (connectedBefore) silentRefresh();
      connectedBefore = true;
    });
    socket.on('disconnect', (reason: string) => {
      setIsLiveConnected(false);
      // socket.io does not retry after the server itself closed the connection: do it ourselves.
      if (reason === 'io server disconnect') socket.connect();
    });
    socket.on('connect_error', () => setIsLiveConnected(false));
    // Same OrderView as REST (contract 2.1/3). Merge by updatedAt so an older event never rolls an order back.
    const applyLiveOrder = (rawOrder: unknown) => {
      const incoming = normalizeOrderPartial(rawOrder);
      if (!incoming.id) return;
      setOrders((previous) => upsertOrder(previous, incoming));
      setDrawerFallback((current) => mergeInto(current, incoming));
      scheduleAttention();
    };
    socket.on('order_updated', applyLiveOrder);
    socket.on('new_order_alert', (rawOrder: unknown) => {
      const incoming = normalizeOrderPartial(rawOrder);
      const isNew = Boolean(incoming.id) && !ordersRef.current.some((order) => order.id === incoming.id);
      applyLiveOrder(rawOrder);
      if (isNew) toast.info('Nouvelle commande', `${incoming.vendorName ?? 'Un restaurant'} a une nouvelle commande payée.`);
    });
    socket.on('partner_application', (info: { kind?: string; name?: string; resubmitted?: boolean }) => {
      const who = info?.kind === 'VENDOR' ? 'Un restaurant' : 'Un livreur';
      toast.info(info?.resubmitted ? 'Candidature mise à jour' : 'Nouvelle candidature', `${who}${info?.name ? ` (${info.name})` : ''} attend votre validation.`);
      setApplicationsKey((key) => key + 1);
      refreshPendingCount();
    });
    socket.on('driver_duty_update', (update: { id?: string; dutyStatus?: DriverPartner['dutyStatus'] }) => {
      if (!update?.id || !update.dutyStatus) return;
      setDriverPartners((previous) => previous.map((driver) => driver.id === update.id ? { ...driver, dutyStatus: update.dutyStatus! } : driver));
    });
    socket.on('partner_application_updated', () => {
      setApplicationsKey((key) => key + 1);
      refreshPendingCount();
    });
    // Rider positions arrive every few seconds per rider. They are buffered and applied at most once a second
    // (newest fix per rider), so a busy hour never causes a render storm; unchanged riders keep their identity.
    let pendingLocations: DriverPin[] = [];
    let locationTimer: number | undefined;
    const flushLocations = () => {
      locationTimer = undefined;
      const batch = newestPerRider(pendingLocations);
      pendingLocations = [];
      setDrivers((previous) => mergeRiderPins(previous, batch));
    };
    socket.on('driver_location_update', (raw: unknown) => {
      const pin = normalizeDriverPin(raw);
      if (!pin) return;
      pendingLocations.push(pin);
      if (locationTimer === undefined) locationTimer = window.setTimeout(flushLocations, LOCATION_FLUSH_MS);
    });
    return () => {
      socket.disconnect();
      window.clearTimeout(attentionTimer.current);
      window.clearTimeout(locationTimer);
    };
  }, [fetchBackendData, isAuth, refreshPendingCount, toast, scheduleAttention, silentRefresh]);

  // Polling fallback while the page is visible, plus an immediate catch-up when the admin comes back to the tab.
  useEffect(() => {
    if (!isAuth) return undefined;
    const tick = () => { if (document.visibilityState === 'visible') silentRefresh(); };
    const poll = window.setInterval(tick, POLL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') { setNow(Date.now()); silentRefresh(); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(poll); window.clearInterval(clock); document.removeEventListener('visibilitychange', onVisible); };
  }, [isAuth, silentRefresh]);

  /**
   * One optimistic order action: patch the order at once, call the server, then take the server's copy.
   * On failure only this order is rolled back (and only if no newer live update arrived meanwhile), and the
   * server's own message is shown.
   */
  const runOrderAction = async (
    orderId: string,
    optimistic: Partial<Order> | null,
    call: () => Promise<Order | null>,
    messages: { ok: (order: Order | null) => [string, string?, 'error'?]; fail: string },
    onError?: (message: string) => void,
  ): Promise<boolean> => {
    const snapshot = ordersRef.current.find((order) => order.id === orderId) ?? (drawerFallback?.id === orderId ? drawerFallback : null);
    if (optimistic) {
      setOrders((current) => patchOrder(current, orderId, optimistic));
      setDrawerFallback((current) => (current?.id === orderId ? { ...current, ...optimistic } : current));
    }
    try {
      let updated = await call();
      if (!updated) updated = await apiService.fetchOrder(orderId).catch(() => null);
      if (updated) {
        const fresh = updated;
        // Orders outside the loaded page live only in the drawer copy; do not push old orders into the live list.
        setOrders((current) => (current.some((order) => order.id === orderId) ? upsertOrder(current, fresh) : current));
        setDrawerFallback((current) => mergeInto(current, fresh));
      }
      setErrorMessage('');
      const [title, description, kind] = messages.ok(updated);
      if (kind === 'error') toast.error(title, description); else toast.success(title, description);
      return true;
    } catch (error) {
      if (snapshot) {
        setOrders((current) => restoreIfUntouched(current, snapshot));
        setDrawerFallback((current) => (current?.id === orderId ? restoreIfUntouched([current], snapshot)[0] : current));
      }
      if (error instanceof ActionCancelled) return false; // the admin said no: nothing failed
      handleSessionError(error);
      const message = error instanceof Error ? error.message : 'Veuillez réessayer.';
      toast.error(messages.fail, message);
      onError?.(message);
      return false;
    } finally {
      scheduleAttention();
    }
  };

  const handleStatusChange = (orderId: string, status: OrderStatus, otpCode?: string) => runOrderAction(
    orderId,
    { status },
    () => apiService.updateOrderStatus(orderId, status, otpCode),
    { ok: (updated) => ['Commande mise à jour', `Statut : ${ORDER_STATUS_LABEL[updated?.status ?? status] ?? status}.`], fail: 'Statut non modifié' },
  );

  const askAssignOffline = (name?: string, order?: Order | null) => confirm({
    title: name ? `Assigner ${name} ?` : 'Assigner ce livreur ?',
    message: `Ce livreur est hors ligne. L’assigner quand même ?${order?.group ? ` ${reassignWholeGroupText(order.group)}` : ''}`,
    confirmLabel: 'Assigner quand même',
  });

  const handleReassignDriver = async (orderId: string, driverId: string | null) => {
    const rider = driverId ? driverPartners.find((driver) => driver.id === driverId) : undefined;
    const target = ordersRef.current.find((order) => order.id === orderId) ?? (drawerFallback?.id === orderId ? drawerFallback : null);
    // The roster already says offline: ask before anything changes on screen.
    let force = false;
    if (driverId && rider?.dutyStatus === 'OFFLINE') {
      if (!(await askAssignOffline(rider.name, target))) return false;
      force = true;
    }
    return runOrderAction(
      orderId,
      { driverId: driverId ? rider?.userId ?? driverId : undefined, driverName: driverId ? rider?.name ?? 'Mise à jour de l’assignation…' : undefined, driverPhone: driverId ? rider?.phone : undefined },
      async () => {
        try {
          return await apiService.reassignOrderDriver(orderId, driverId, force);
        } catch (error) {
          // The roster was out of date and the server knows the rider is offline: same question, then resend with force.
          if (driverId && !force && error instanceof ApiError && error.code === 'RIDER_OFFLINE') {
            if (!(await askAssignOffline(rider?.name, target))) throw new ActionCancelled();
            try { return await apiService.reassignOrderDriver(orderId, driverId, true); } catch (second) { throw plainReassignError(second); }
          }
          throw plainReassignError(error);
        }
      },
      {
        ok: (updated) => {
          const group = updated?.group ?? target?.group;
          const who = updated?.driverName ? `${updated.driverName} prend en charge ` : '';
          return [driverId ? 'Livreur assigné' : 'Livreur retiré', group
            ? `${who ? `${who}les ${group.size} commandes de la commande groupée.` : `Les ${group.size} commandes de la commande groupée ont été mises à jour ensemble.`}`
            : who ? `${who}cette commande.` : undefined];
        },
        fail: 'Livreur non modifié',
      },
    ).then((ok) => { if (ok && target?.group) silentRefresh(); return ok; });
  };

  const handleCancelOrder = async (orderId: string, reason: string): Promise<string | null> => {
    const before = ordersRef.current.find((order) => order.id === orderId) ?? drawerFallback;
    const paid = before?.paymentStatus === 'PAID';
    let failure: string | null = null;
    let outcome: CancelOutcome = { groupId: null, cancelledOrders: null };
    const ok = await runOrderAction(
      orderId,
      { status: 'CANCELLED', cancelledBy: 'ADMIN', cancelReason: reason, cancelledAt: new Date().toISOString() },
      async () => {
        const result = await apiService.cancelOrderWithResult(orderId, reason);
        outcome = result.outcome;
        return result.order;
      },
      {
        ok: (updated) => {
          const text = cancelToastText(outcome, { size: before?.group?.size, paid, refundFailed: updated?.refundStatus === 'FAILED' });
          return [text.title, text.description];
        },
        fail: 'Commande non annulée',
      },
      (message) => { failure = message; },
    );
    // The server cancelled every restaurant of a combined order: reload the list so the other parts show as cancelled too.
    if (ok && (outcome.groupId || before?.group)) silentRefresh();
    return failure;
  };

  const handleResetOtpLock = (orderId: string) => runOrderAction(
    orderId,
    { otpLocked: false, otpAttempts: 0 },
    () => apiService.resetOtpLock(orderId),
    { ok: () => ['Blocage OTP réinitialisé', 'Le client a reçu un nouveau code de livraison ; le livreur peut réessayer.'], fail: 'Blocage OTP non réinitialisé' },
  );

  // No optimistic patch: whether the refund now succeeds is only known from the server's answer.
  const handleRetryRefund = (orderId: string) => runOrderAction(
    orderId,
    null,
    () => apiService.retryRefund(orderId),
    {
      ok: (updated) => (updated?.refundStatus === 'DONE' || updated?.paymentStatus === 'REFUNDED'
        ? ['Remboursement effectué', 'Le client a été remboursé.']
        : updated?.refundStatus === 'FAILED'
          ? ['Nouvel échec du remboursement', updated.refundError ?? 'Razorpay l’a de nouveau refusé. Vérifiez le paiement dans Razorpay.', 'error']
          : ['Remboursement relancé', 'Le remboursement est en cours.']),
      fail: 'Remboursement non relancé',
    },
  );

  const openOrder = useCallback((orderId: string, mode: DrawerMode = 'view', fallback?: Order | null) => {
    setDrawer({ id: orderId, mode });
    if (ordersRef.current.some((order) => order.id === orderId)) {
      setDrawerFallback(null);
      setDrawerLoad({ loading: false, error: '' });
      return;
    }
    // Not in the loaded page (e.g. an old order from the needs-attention list): show what we have, then load it.
    setDrawerFallback(fallback ?? null);
    setDrawerLoad({ loading: true, error: '' });
    apiService.fetchOrder(orderId)
      .then((order) => { setDrawerFallback((current) => (current && current.id === orderId ? mergeInto(current, order) : order)); setDrawerLoad({ loading: false, error: '' }); })
      .catch((error) => { handleSessionError(error); setDrawerLoad({ loading: false, error: error instanceof Error ? error.message : 'Cette commande n’a pas pu être chargée.' }); });
  }, [handleSessionError]);

  const closeDrawer = useCallback(() => { setDrawer(null); setDrawerFallback(null); setDrawerLoad({ loading: false, error: '' }); }, []);
  const setDrawerMode = useCallback((mode: DrawerMode) => setDrawer((current) => (current ? { ...current, mode } : current)), []);

  const setVendorBusy = (vendorId: string, busy: boolean) => {
    if (busy) busyVendorRef.current.add(vendorId); else busyVendorRef.current.delete(vendorId);
    setBusyVendorIds(new Set(busyVendorRef.current));
  };

  const handleToggleVendor = async (vendorId: string) => {
    if (busyVendorRef.current.has(vendorId)) return; // one request at a time per restaurant
    const first = vendorsRef.current.find((vendor) => vendor.id === vendorId);
    if (!first) return;
    if (first.isAcceptingOrders) {
      const ok = await confirm({
        title: `Fermer ${first.name} ?`,
        message: 'Les clients ne peuvent plus commander dans ce restaurant tant qu’il n’est pas rouvert.',
        confirmLabel: 'Fermer le restaurant',
        danger: true,
      });
      if (!ok) return;
    }
    if (busyVendorRef.current.has(vendorId)) return;
    const target = vendorsRef.current.find((vendor) => vendor.id === vendorId);
    if (!target) return;
    setVendorBusy(vendorId, true);
    const wasAccepting = target.isAcceptingOrders;
    const nextStatus = !wasAccepting;
    setVendors((current) => current.map((vendor) => vendor.id === vendorId ? { ...vendor, isAcceptingOrders: nextStatus } : vendor));
    try {
      const updated = await apiService.toggleVendorStatus(vendorId, nextStatus);
      setVendors((current) => current.map((vendor) => vendor.id === vendorId ? updated : vendor));
      toast.success(updated.isAcceptingOrders ? 'Restaurant ouvert' : 'Restaurant fermé', `${updated.name} ${updated.isAcceptingOrders ? 'accepte désormais' : 'n’accepte plus'} les commandes.`);
    } catch (error) {
      // Put back only this restaurant's switch: a pin saved meanwhile must not be undone.
      setVendors((current) => current.map((vendor) => vendor.id === vendorId ? { ...vendor, isAcceptingOrders: wasAccepting } : vendor));
      handleAuthFailure(error);
    } finally {
      setVendorBusy(vendorId, false);
    }
  };

  const handleLoadOlder = async () => {
    const cursor = oldestOrderId(ordersRef.current);
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await apiService.fetchOrderPage(cursor, OLDER_PAGE_SIZE);
      olderLoadedRef.current = true;
      setOrders((current) => appendOlderPage(current, page.orders));
      setHasMoreOrders(page.nextCursor !== null);
      if (page.orders.length === 0) toast.info('Aucune commande plus ancienne', 'Toutes les commandes sont déjà chargées.');
    } catch (error) {
      handleSessionError(error);
      toast.error('Anciennes commandes non chargées', error instanceof Error ? error.message : 'Veuillez réessayer.');
    } finally {
      setLoadingOlder(false);
    }
  };

  const handleVendorLocationSaved = useCallback((vendorId: string, saved: SavedPin) => {
    setVendors((current) => current.map((vendor) => vendor.id === vendorId ? { ...vendor, lat: saved.lat, lng: saved.lng, hasLocation: saved.hasLocation, locationSource: saved.locationSource, locationSetAt: saved.locationSetAt, locationAccuracyM: saved.locationAccuracyM } : vendor));
  }, []);

  const handleVendorProfileSaved = useCallback((vendorId: string, profile: VendorProfile) => {
    setVendors((current) => current.map((vendor) => vendor.id === vendorId ? { ...vendor, ...Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== undefined)) } : vendor));
  }, []);

  const handleVendorCommissionSaved = useCallback((vendorId: string, commission: VendorCommission) => {
    setVendors((current) => current.map((vendor) => vendor.id === vendorId ? { ...vendor, commissionType: commission.type, commissionValue: commission.value } : vendor));
  }, []);

  const handleLogout = () => {
    clearAuthToken();
    setIsAuth(false);
    setAdminProfile(undefined);
    setOrders([]);
    setVendors([]);
    setDriverPartners([]);
    setDrivers([]);
    setPendingApplications(0);
    setPendingDishes({ pending: 0, changePending: 0, total: 0 });
    olderLoadedRef.current = false;
    setHasMoreOrders(false);
    setAttention({ available: null, entries: [], loading: false, error: '', checkedAt: null });
    closeDrawer();
    setSearchQuery('');
    setMobileNavOpen(false);
  };

  // A team member whose role cannot open the screen in the address bar lands on the first screen it may open.
  useEffect(() => {
    if (!isAuth || !adminProfile?.permissions) return;
    if (workspaceOf(activeTab) === 'admin' && !canOpen(adminProfile.permissions, activeTab)) {
      const target = firstAllowedTab(adminProfile.permissions, ['map', 'tickets', 'finance', 'campaigns', 'prospecting', 'analytics', 'settings']);
      if (target) setActiveTab(target);
    }
    // Only when the profile changes: afterwards a screen the role cannot open shows the "Accès non autorisé" page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuth, adminProfile]);

  const handleSelectTab = useCallback((tab: TabType) => {
    setActiveTab(tab);
    setSearchQuery('');
  }, []);
  const switchWorkspace = useCallback(() => {
    setActiveTab((current) => DEFAULT_TAB[workspaceOf(current) === 'admin' ? 'restaurant' : 'admin']);
    setSearchQuery('');
  }, []);
  const clearQuery = useCallback(() => setSearchQuery(''), []);
  const closeMobileNav = useCallback(() => setMobileNavOpen(false), []);

  // Server list when available; otherwise what the dashboard can detect itself (clearly labelled in the panel).
  // Embedded order copies are replaced by the live ones so the list never shows a stale status.
  const attentionEntries = useMemo<AttentionEntry[]>(() => {
    const byId = new Map(orders.map((order) => [order.id, order]));
    const base = attention.available === false ? localAttention(orders, now) : attention.entries;
    return pruneWithLiveOrders(base.map((entry) => (entry.orderId && byId.has(entry.orderId) ? { ...entry, order: byId.get(entry.orderId)! } : entry)));
  }, [attention.available, attention.entries, orders, now]);
  const locationGaps = useMemo(() => vendorsNeedingLocation(vendors), [vendors]);
  const attentionIds = useMemo(() => new Set(attentionEntries.map((entry) => entry.orderId).filter((id): id is string => Boolean(id))), [attentionEntries]);
  const drawerOrder = drawer ? orders.find((order) => order.id === drawer.id) ?? (drawerFallback?.id === drawer.id ? drawerFallback : null) : null;
  const drawerEntry = drawer ? attentionEntries.find((entry) => entry.orderId === drawer.id) : undefined;

  if (authChecking) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-kraveo-night" role="status" aria-live="polite">
        <div className="animate-scale-in"><LogoMark size={64} /></div>
        <p className="flex items-center gap-2 text-sm font-semibold text-kraveo-ink2"><RefreshCw className="h-4 w-4 animate-spin text-kraveo-g600" aria-hidden="true" />{sessionUnreachable ? 'Serveur injoignable, nouvelle tentative…' : 'Vérification de la session admin…'}</p>
        {sessionUnreachable && (
          <button type="button" className="k-btn-ghost !min-h-[36px] text-xs" onClick={() => { clearAuthToken(); setSessionUnreachable(false); setAuthChecking(false); }}>Se reconnecter plutôt</button>
        )}
      </div>
    );
  }

  if (!isAuth) {
    return <LoginScreen onLoginSuccess={(profile) => { setAdminProfile(profile); setIsAuth(true); }} />;
  }

  const accessDenied = !canOpen(adminProfile?.permissions, activeTab);
  const readOnly = !accessDenied && isReadOnlyTab(adminProfile?.access, activeTab);
  const deniedGroup = groupOfTab(activeTab);
  const roleLabel = ROLE_LABEL[(adminProfile?.adminRole ?? 'SUPER_ADMIN') as AdminRoleId] ?? 'équipe';

  const activeOrderCount = orders.filter((order) => order.status !== 'DELIVERED' && order.status !== 'CANCELLED').length;

  return (
    <div className="min-h-screen bg-kraveo-night text-kraveo-ink lg:flex">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[90] focus:rounded-k-sm focus:bg-kraveo-g400 focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-kraveo-g950">Aller au contenu</a>
      <Sidebar
        activeTab={activeTab}
        setActiveTab={handleSelectTab}
        mobileOpen={mobileNavOpen}
        onCloseMobile={closeMobileNav}
        badges={{ orders: activeOrderCount, attention: attentionEntries.length + locationGaps.length, applications: pendingApplications, catalog: pendingDishes.total, finance: pendingSettlements }}
        alertBadges={{ attention: true }}
        workspace={workspace}
        onLogout={handleLogout}
        adminProfile={adminProfile}
        onSwitchWorkspace={switchWorkspace}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header
          activeTab={activeTab}
          isLiveConnected={isLiveConnected}
          isLoading={isLoading}
          adminProfile={adminProfile}
          onRefresh={fetchBackendData}
          onLogout={handleLogout}
          onOpenMenu={() => setMobileNavOpen(true)}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          workspace={workspace}
        />
        {errorMessage && (
          <div role="alert" className="mx-4 mt-4 flex animate-fade-in items-center justify-between gap-3 rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 px-4 py-3 text-sm text-kraveo-ink sm:mx-6">
            <span className="min-w-0">{errorMessage}</span>
            <span className="flex shrink-0 items-center gap-1">
              <button className="k-btn-ghost !min-h-[36px] !px-3 text-xs" onClick={fetchBackendData}>Réessayer</button>
              <button aria-label="Fermer l’erreur" className="k-icon-btn !h-9 !w-9" onClick={() => setErrorMessage('')}><X className="h-4 w-4" aria-hidden="true" /></button>
            </span>
          </div>
        )}
        <main id="main" tabIndex={-1} className="min-w-0 flex-1 p-4 pb-12 outline-none sm:p-8 sm:pb-14">
          <div key={activeTab} className="mx-auto w-full max-w-[1480px] animate-fade-up">
            {accessDenied ? (
              <div className="k-card p-6">
                <EmptyState icon={ShieldCheck} title="Accès non autorisé" description={`Votre rôle (${roleLabel}) ne donne pas accès à cette section${deniedGroup ? ` (${GROUP_LABEL[deniedGroup]})` : ''}. Demandez à un super admin de modifier votre rôle.`} />
              </div>
            ) : (
              <>
                {readOnly && (
                  <p role="status" className="mb-4 flex items-center gap-2 rounded-k-md border border-kraveo-line bg-kraveo-surface2 px-4 py-3 text-sm font-semibold text-kraveo-ink2">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-kraveo-g600" aria-hidden="true" />Lecture seule : votre rôle ({roleLabel}) peut consulter cette section mais pas la modifier.
                  </p>
                )}
            {isSoon(activeTab) && soonPageOf(activeTab) && <SettingsSoonPage id={activeTab} onBack={() => handleSelectTab(workspace === 'restaurant' ? 'r-settings' : 'settings')} />}
            {isSoon(activeTab) && !soonPageOf(activeTab) && (
              <div className="k-card p-6">
                <EmptyState icon={Construction} title={`${navItem(activeTab)?.label ?? 'Cette section'} : bientôt disponible`} description={`${navItem(activeTab)?.hint ?? ''}. Cette section fait partie du menu prévu ; son écran sera construit dans une prochaine étape.`} />
              </div>
            )}
            {activeTab === 'map' && <div className="mb-4"><LiveCountersBar onNavigate={handleSelectTab} onAuthError={handleSessionError} /></div>}
            {activeTab === 'map' && <LiveCommandCenter drivers={drivers} orders={orders} driverPartners={driverPartners} vendors={vendors} onReassignDriver={handleReassignDriver} onOpenOrder={openOrder} loading={isLoading} query={searchQuery} adminName={adminProfile?.name} onNavigate={handleSelectTab} refreshKey={applicationsKey}
              overview={<PlatformOverview vendors={vendors} driverPartners={driverPartners} dishesToApprove={pendingDishes.total} settlementsToPay={pendingSettlements} alerts={attentionEntries.length} refreshKey={applicationsKey} onNavigate={handleSelectTab} />} />}
            {activeTab === 'orders' && <OrdersTable orders={orders} attentionIds={attentionIds} onAdvance={handleStatusChange} onOpenOrder={openOrder} loading={isLoading} query={searchQuery} onClearQuery={clearQuery} now={now} hasMore={hasMoreOrders} loadingOlder={loadingOlder} onLoadOlder={handleLoadOlder} onRefresh={fetchBackendData} refreshing={isLoading} />}
            {activeTab === 'attention' && (
              <NeedsAttentionPanel
                entries={attentionEntries}
                locationGaps={locationGaps}
                onOpenVendors={() => handleSelectTab('vendors')}
                serverAvailable={attention.available}
                loading={attention.loading}
                error={attention.error}
                checkedAt={attention.checkedAt}
                onRefresh={loadAttention}
                onOpenOrder={openOrder}
                onResetOtpLock={handleResetOtpLock}
                onRetryRefund={handleRetryRefund}
                query={searchQuery}
                onClearQuery={clearQuery}
              />
            )}
            {activeTab === 'attention' && <div className="mt-5"><ReconcilePanel onAuthError={handleSessionError} /></div>}
            {activeTab === 'applications' && <ApplicationsPanel refreshKey={applicationsKey} query={searchQuery} onQueryChange={setSearchQuery} onChanged={fetchBackendData} onAuthError={handleSessionError} onLocationSaved={handleVendorLocationSaved} />}
            {activeTab === 'vendors' && <VendorManager vendors={vendors} orders={orders} busyVendorIds={busyVendorIds} onToggleVendor={handleToggleVendor} onLocationSaved={handleVendorLocationSaved} onCommissionSaved={handleVendorCommissionSaved} onProfileSaved={handleVendorProfileSaved} onAuthError={handleSessionError} onCreated={fetchBackendData} loading={isLoading} query={searchQuery} onClearQuery={clearQuery} onQueryChange={setSearchQuery} onRefresh={fetchBackendData} refreshing={isLoading} />}
            {activeTab === 'drivers' && <DriverManager drivers={driverPartners} orders={orders} now={now} onCreated={fetchBackendData} loading={isLoading} query={searchQuery} onClearQuery={clearQuery} onQueryChange={setSearchQuery} onRefresh={fetchBackendData} refreshing={isLoading} />}
            {activeTab === 'customers' && <CustomersPanel query={searchQuery} onClearQuery={clearQuery} onQueryChange={setSearchQuery} onAuthError={handleSessionError} />}
            {activeTab === 'catalog' && <CatalogPanel vendors={vendors} query={searchQuery} onQueryChange={setSearchQuery} onClearQuery={clearQuery} onAuthError={handleSessionError} pendingCounts={pendingDishes} onPendingChanged={refreshPendingDishes} />}
            {activeTab === 'finance' && <FinancePanel vendors={vendors} driverPartners={driverPartners} pendingSettlements={pendingSettlements} onSettlementsChanged={refreshPendingSettlements} onAuthError={handleSessionError} />}
            {activeTab === 'r-dashboard' && <RestaurantDashboard vendors={vendors.filter((v) => v.approvalStatus !== 'REJECTED')} orders={orders} vendorId={previewVendorId} onVendorChange={setPreviewVendorId} now={now} onAdvance={handleStatusChange} onToggleOpen={handleToggleVendor} openBusy={busyVendorIds.has(previewVendorId)} onOpenOrder={openOrder} onNavigate={handleSelectTab} loading={isLoading} />}
            {activeTab === 'r-orders' && <RestaurantOrdersPage mode="current" vendors={vendors.filter((v) => v.approvalStatus !== 'REJECTED')} vendorId={previewVendorId} onVendorChange={setPreviewVendorId} orders={orders} now={now} onOpenOrder={openOrder} loading={isLoading} />}
            {activeTab === 'r-history' && <RestaurantOrdersPage mode="history" vendors={vendors.filter((v) => v.approvalStatus !== 'REJECTED')} vendorId={previewVendorId} onVendorChange={setPreviewVendorId} orders={orders} now={now} onOpenOrder={openOrder} loading={isLoading} />}
            {activeTab === 'r-returns' && <RestaurantOrdersPage mode="returns" vendors={vendors.filter((v) => v.approvalStatus !== 'REJECTED')} vendorId={previewVendorId} onVendorChange={setPreviewVendorId} orders={orders} now={now} onOpenOrder={openOrder} loading={isLoading} />}
            {activeTab === 'r-stats' && <RestaurantStatsPage vendors={vendors.filter((v) => v.approvalStatus !== 'REJECTED')} vendorId={previewVendorId} onVendorChange={setPreviewVendorId} orders={orders} now={now} />}
            {activeTab === 'r-reviews' && <RestaurantReviewsPage vendors={vendors.filter((v) => v.approvalStatus !== 'REJECTED')} vendorId={previewVendorId} onVendorChange={setPreviewVendorId} onAuthError={handleSessionError} />}
            {activeTab === 'r-payouts' && <RestaurantPayoutsPage vendors={vendors.filter((v) => v.approvalStatus !== 'REJECTED')} vendorId={previewVendorId} onVendorChange={setPreviewVendorId} onAuthError={handleSessionError} />}
            {activeTab === 'r-menu' && <RestaurantMenuPage vendors={vendors.filter((v) => v.approvalStatus !== 'REJECTED')} vendorId={previewVendorId} onVendorChange={setPreviewVendorId} onAuthError={handleSessionError} />}
            {activeTab === 'r-promotions' && <RestaurantPromotionsPage vendors={vendors.filter((v) => v.approvalStatus !== 'REJECTED')} vendorId={previewVendorId} onVendorChange={setPreviewVendorId} onAuthError={handleSessionError} />}
            {activeTab === 'r-profile' && <RestaurantProfilePage vendorId={previewVendorId} onVendorChange={setPreviewVendorId} title="Profil du restaurant" subtitle="Votre vitrine : logo, photo, description, adresse et contact, tels que les voient les clients." sections={['identity', 'address', 'contact', 'prep']} vendors={vendors} onSaved={handleVendorProfileSaved} onLocationSaved={handleVendorLocationSaved} onAuthError={handleSessionError} />}
            {activeTab === 'r-hours' && <RestaurantProfilePage vendorId={previewVendorId} onVendorChange={setPreviewVendorId} title="Horaires & ouverture" subtitle="Les jours et les heures où le restaurant prend des commandes." sections={['hours']} vendors={vendors} onSaved={handleVendorProfileSaved} onAuthError={handleSessionError} />}
            {activeTab === 'settings' && <SettingsHub onNavigate={handleSelectTab} adminProfile={adminProfile} onLogout={handleLogout} />}
            {activeTab === 'r-settings' && <SettingsHub workspace="restaurant" onNavigate={handleSelectTab} onLogout={handleLogout} />}
            {activeTab === 'settings-fees' && (<><SettingsPageHeader title="Frais & commission" subtitle="Ce que paie le client, la part d’Affia Foods, l’arrondi et les règlements." onBack={() => handleSelectTab('settings')} /><SettingsPanel onAuthError={handleSessionError} /></>)}
            {activeTab === 'settings-account' && (<><SettingsPageHeader title="Mon compte" subtitle="Votre profil et votre session." onBack={() => handleSelectTab('settings')} /><AccountPage adminProfile={adminProfile} onLogout={handleLogout} /></>)}
            {activeTab === 'analytics' && <AnalyticsPanel onAuthError={handleSessionError} />}
            {activeTab === 'modules' && <ModulesPanel onAuthError={handleSessionError} />}
            {activeTab === 'simulator' && <SimulatorPanel onAuthError={handleSessionError} />}
            {activeTab === 'zones' && <ZonesPanel onAuthError={handleSessionError} />}
            {activeTab === 'service-areas' && <ServiceAreasPanel onAuthError={handleSessionError} />}
            {activeTab === 'promo-codes' && <PromotionsPanel onAuthError={handleSessionError} />}
            {activeTab === 'plans' && <PlansPanel onAuthError={handleSessionError} />}
            {activeTab === 'promo-offers' && <PromotionsPanel merchantOnly onAuthError={handleSessionError} />}
            {activeTab === 'notifications' && <NotificationsPanel onNavigate={handleSelectTab} onAuthError={handleSessionError} />}
            {activeTab === 'settings-security' && (<><SettingsPageHeader title="Sécurité" subtitle="Double authentification et sessions ouvertes." onBack={() => handleSelectTab('settings')} /><SecurityPanel onAuthError={handleSessionError} /></>)}
            {activeTab === 'settings-orders' && (<><SettingsPageHeader title="Règles de commande" subtitle="Montant minimum, distance et commandes multi-restaurants." onBack={() => handleSelectTab('settings')} /><OrderRulesPage onAuthError={handleSessionError} /></>)}
            {activeTab === 'settings-payments' && (<><SettingsPageHeader title="Moyens de paiement" subtitle="Prestataires de versement et règlements." onBack={() => handleSelectTab('settings')} /><PaymentsSettingsPage onAuthError={handleSessionError} onNavigate={handleSelectTab} /></>)}
            {activeTab === 'settings-export' && (<><SettingsPageHeader title="Export de données" subtitle="Télécharger les règlements pour la comptabilité." onBack={() => handleSelectTab('settings')} /><ExportPage onAuthError={handleSessionError} /></>)}
            {activeTab === 'refunds' && <RefundsPanel orders={orders} loading={isLoading} onOpenOrder={openOrder} onRetryRefund={handleRetryRefund} onRefresh={fetchBackendData} />}
            {activeTab === 'commissions' && <CommissionsPanel onAuthError={handleSessionError} onOpenSettings={() => handleSelectTab('settings-fees')} />}
            {activeTab === 'segments' && <SegmentsPanel onNavigate={handleSelectTab} onAuthError={handleSessionError} />}
            {activeTab === 'contracts' && <LegalDocumentsPanel scope="contracts" onAuthError={handleSessionError} />}
            {activeTab === 'legal' && (<><SettingsPageHeader title="Documents légaux" subtitle="Conditions, confidentialité et remboursements, avec leurs versions." onBack={() => handleSelectTab('settings')} /><LegalDocumentsPanel scope="legal" onAuthError={handleSessionError} /></>)}
            {activeTab === 'help-center' && <HelpCenterPanel onAuthError={handleSessionError} />}
            {activeTab === 'team' && <TeamPanel adminProfile={adminProfile ?? null} onAuthError={handleSessionError} />}
            {activeTab === 'prospecting' && <ProspectsPanel onAuthError={handleSessionError} />}
            {activeTab === 'referral' && <ReferralPanel onNavigate={handleSelectTab} onAuthError={handleSessionError} />}
            {activeTab === 'loyalty' && <LoyaltyPanel onAuthError={handleSessionError} />}
            {activeTab === 'courier-bonuses' && <BonusesPanel onAuthError={handleSessionError} />}
            {activeTab === 'campaigns' && <CampaignsPanel onAuthError={handleSessionError} />}
            {activeTab === 'tickets' && <TicketsPanel adminProfile={adminProfile ?? null} onAuthError={handleSessionError} />}
            {activeTab === 'reviews' && <ReviewsPanel onAuthError={handleSessionError} />}
            {activeTab === 'audit' && <AuditPanel onAuthError={handleSessionError} />}
              </>
            )}
          </div>
        </main>
      </div>
      <OrderDrawer
        order={drawerOrder}
        loading={Boolean(drawer) && !drawerOrder && drawerLoad.loading}
        loadError={drawer && !drawerOrder ? drawerLoad.error : ''}
        mode={drawer?.mode ?? 'view'}
        onModeChange={setDrawerMode}
        onClose={closeDrawer}
        riders={driverPartners}
        problems={drawerEntry?.problems ?? []}
        hint={drawerEntry?.hint}
        onAdvance={handleStatusChange}
        onReassign={handleReassignDriver}
        onCancel={handleCancelOrder}
        onResetOtpLock={handleResetOtpLock}
        onRetryRefund={handleRetryRefund}
        onOpenOrder={(id) => openOrder(id)}
      />
      {confirmDialog}
    </div>
  );
};
