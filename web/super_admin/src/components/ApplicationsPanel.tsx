import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link2, Bike, Check, Ban, ChevronDown, ClipboardCheck, Copy, Download, Eye, KeyRound, Loader2, MapPin, Phone, Plus, RefreshCw, SearchX, Store, X } from 'lucide-react';
import { Application, ApplicationCounts, ApprovalStatus, PartnerKind } from '../types';
import type { SavedPin } from '../lib/vendorLocation';
import { VendorLocationEditor } from './VendorLocationEditor';
import { ApiError, apiService } from '../services/api';
import { copyText, generatePassword } from '../lib/credentials';
import { decisionToast } from '../lib/adminMessages';
import { timeAgo, vehicleLabel } from '../lib/tokens';
import { vendorHasRealPin } from '../lib/campus';
import { ApprovalPill } from './ui/ApprovalPill';
import { Avatar } from './ui/Avatar';
import { Drawer } from './ui/Drawer';
import { AddPartnerDrawer } from './AddPartnerDrawer';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { Skeleton, SkeletonCard } from './ui/Skeleton';
import { DossierChecklist, DossierPill } from './ui/DossierPill';
import { dossierOf } from '../lib/dossier';
import { PaginationBar, usePagination } from './ui/Pagination';
import { ColumnsMenu, PageHeader, SearchField, SelectionBar, SortHeader, UnderlineTabs, ViewToggle, downloadCsv, nextSort, useTablePrefs } from './ui/PageToolbar';
import { useToast } from './ui/Toast';
import { RESTAURANT_SIGNUP_PATH } from '../lib/route';

interface Props {
  /** Bumped by the app when a new application arrives over the socket, so the list reloads. */
  refreshKey: number;
  query?: string;
  onQueryChange?: (value: string) => void;
  /** Called after any decision so counts and the vendor/driver lists can refresh. */
  onChanged: () => void;
  onAuthError: (error: unknown) => void;
  /** Called after an admin typed a pin for a restaurant here, so the Vendors tab and the live map use it too. */
  onLocationSaved?: (vendorId: string, saved: SavedPin) => void;
}

type AppColumn = 'type' | 'phone' | 'detail' | 'dossier' | 'status' | 'date';
type DossierFilter = 'ALL' | 'COMPLETE' | 'MISSING';
const APP_COLUMNS: Array<{ key: AppColumn; label: string }> = [
  { key: 'type', label: 'Type' }, { key: 'phone', label: 'Téléphone' }, { key: 'detail', label: 'Détail' }, { key: 'dossier', label: 'Dossier' }, { key: 'status', label: 'Décision' }, { key: 'date', label: 'Date de réception' },
];
type AppSort = 'name' | 'date';
type StatusFilter = ApprovalStatus | 'ALL';
type KindFilter = PartnerKind | 'ALL';

const STATUS_TABS: Array<{ id: StatusFilter; label: string }> = [
  { id: 'ALL', label: 'Toutes' },
  { id: 'PENDING', label: 'En attente' },
  { id: 'APPROVED', label: 'Approuvées' },
  { id: 'REJECTED', label: 'Refusées' },
  { id: 'SUSPENDED', label: 'Suspendues' },
];

const REJECT_REASONS = ['Téléphone injoignable', 'Informations incomplètes', 'Hors de notre zone de livraison à Thiès', 'Licence impossible à vérifier', 'Pas de besoin pour le moment'];
const SUSPEND_REASONS = ['Plaintes de clients', 'Absences sur des commandes', 'Documents expirés', 'Fermeture temporaire'];

const dash = (v?: string | null) => (v && v.trim() ? v : '—');

const Detail: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="k-inset px-3 py-2.5">
    <p className="k-label !text-[10px]">{label}</p>
    <p className="mt-0.5 break-words text-sm font-bold text-kraveo-ink">{children}</p>
  </div>
);

export type Dialog =
  | { type: 'reason'; app: Application; status: 'REJECTED' | 'SUSPENDED' }
  | { type: 'password'; app: Application }
  | null;

export const ApplicationsPanel: React.FC<Props> = ({ refreshKey, query = '', onQueryChange, onChanged, onAuthError, onLocationSaved }) => {
  const toast = useToast();
  const copySignupLink = async () => {
    const link = `${window.location.origin}${RESTAURANT_SIGNUP_PATH}`;
    if (await copyText(link)) toast.success('Lien copié', 'Envoyez-le aux restaurants : ils s’inscrivent eux-mêmes, vous validez ici.');
    else toast.error('Copie impossible', link);
  };
  const [status, setStatus] = useState<StatusFilter>('PENDING');
  const [kind, setKind] = useState<KindFilter>('ALL');
  const [dossierFilter, setDossierFilter] = useState<DossierFilter>('ALL');
  const [items, setItems] = useState<Application[]>([]);
  const [counts, setCounts] = useState<ApplicationCounts>({ PENDING: 0, APPROVED: 0, REJECTED: 0, SUSPENDED: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [addMenu, setAddMenu] = useState(false);
  const [adding, setAdding] = useState<PartnerKind | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const result = await apiService.fetchApplications(status, kind === 'ALL' ? undefined : kind);
      setItems(result.data);
      setCounts(result.counts);
    } catch (e) {
      onAuthError(e);
      setError(e instanceof Error ? e.message : 'Les candidatures n’ont pas pu être chargées.');
    } finally {
      setLoading(false);
    }
  }, [status, kind, onAuthError]);

  useEffect(() => { setLoading(true); load(); }, [load, refreshKey]);

  const decide = async (app: Application, next: ApprovalStatus, reason?: string) => {
    setBusyId(app.id);
    try {
      await apiService.setPartnerStatus(app.kind, app.id, next, reason);
      const who = app.kind === 'VENDOR' ? app.vendor?.name ?? app.name : app.name;
      const [toastTitle, toastText] = decisionToast(app, next, who);
      toast.success(toastTitle, toastText);
      await load();
      onChanged();
    } catch (e) {
      onAuthError(e);
      toast.error('Mise à jour impossible', e instanceof Error ? e.message : 'Veuillez réessayer.');
    } finally {
      setBusyId(null);
    }
  };

  const pinSaved = (id: string, saved: SavedPin) => {
    setItems((current) => current.map((a) => (a.kind === 'VENDOR' && a.id === id && a.vendor ? { ...a, vendor: { ...a.vendor, ...saved } } : a)));
    onLocationSaved?.(id, saved);
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byDossier = dossierFilter === 'ALL' ? items : items.filter((a) => dossierOf(a).complete === (dossierFilter === 'COMPLETE'));
    if (!q) return byDossier;
    return byDossier.filter((a) => [a.name, a.phone ?? '', a.vendor?.name ?? '', a.vendor?.address ?? '', a.driver?.runnerCode ?? '', a.driver?.vehicleRegNo ?? ''].some((v) => v.toLowerCase().includes(q)));
  }, [items, query, dossierFilter]);

  const total = counts.PENDING + counts.APPROVED + counts.REJECTED + counts.SUSPENDED;
  const countFor = (id: StatusFilter) => (id === 'ALL' ? total : counts[id]);

  const renderDetails = (a: Application) => {
    const isVendor = a.kind === 'VENDOR';
    return (
      <>
      {a.phone ? (
        <a href={`tel:${a.phone}`} className="mt-4 inline-flex items-center gap-2 self-start rounded-k-sm bg-kraveo-g500/10 px-3 py-2 text-sm font-bold text-kraveo-g700 hover:bg-kraveo-g500/15">
          <Phone className="h-4 w-4" aria-hidden="true" />{a.phone}
          <span className="text-[11px] font-semibold text-kraveo-ink3">appuyer pour appeler</span>
        </a>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {isVendor ? (
          <>
            <Detail label="Cuisine">{dash(a.vendor?.category)}</Detail>
            <Detail label="NINEA">{dash(a.vendor?.fssaiNumber)}</Detail>
            <div className="col-span-2"><Detail label="Adresse"><span className="inline-flex items-start gap-1"><MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-kraveo-ink3" aria-hidden="true" />{dash(a.vendor?.address)}</span></Detail></div>
          </>
        ) : (
          <>
            <Detail label="Véhicule">{dash(vehicleLabel(a.driver?.vehicleType))}</Detail>
            <Detail label="Immatriculation">{dash(a.driver?.vehicleRegNo)}</Detail>
            <Detail label="Contact d’urgence">{dash(a.driver?.emergencyPhone)}</Detail>
            <Detail label="UPI de versement">{dash(a.driver?.upiId)}</Detail>
          </>
        )}
      </div>

      {isVendor && a.vendor && (
        <>
          <VendorLocationEditor id={a.id} name={a.vendor.name} pin={a.vendor} onSaved={pinSaved} heading="Repère sur la carte" notSetLabel="Non fourni" />
          {a.status === 'PENDING' && !vendorHasRealPin(a.vendor) && (
            <p className="mt-2 text-xs text-kraveo-ink3">Le restaurant n’a pas envoyé de position. Saisissez-en une ci-dessus avant de valider, ou validez maintenant et définissez-la plus tard (les livreurs ne pourront pas s’y rendre d’ici là).</p>
          )}
        </>
      )}

      {(a.status === 'REJECTED' || a.status === 'SUSPENDED') && a.rejectionReason && (
        <p className="mt-3 rounded-k-sm bg-kraveo-surface2 px-3 py-2 text-xs text-kraveo-ink2"><span className="font-bold text-kraveo-ink">Motif qui leur est affiché :</span> {a.rejectionReason}</p>
      )}
      </>
    );
  };

  /** Compact actions for table rows: round icon buttons with a tooltip. */
  const renderIconActions = (a: Application) => {
    const busy = busyId === a.id;
    const icon = 'inline-flex h-9 w-9 items-center justify-center rounded-full border transition-colors disabled:opacity-50';
    const approve = (label: string, Icon: React.ElementType) => (
      <button type="button" title={label} aria-label={label} disabled={busy} onClick={() => decide(a, 'APPROVED')} className={`${icon} border-kraveo-status-delivered/30 bg-kraveo-status-delivered/10 text-kraveo-status-delivered hover:bg-kraveo-status-delivered hover:text-white`}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Icon className="h-4 w-4" aria-hidden="true" />}
      </button>
    );
    const deny = (label: string, status: 'REJECTED' | 'SUSPENDED', Icon: React.ElementType) => (
      <button type="button" title={label} aria-label={label} disabled={busy} onClick={() => setDialog({ type: 'reason', app: a, status })} className={`${icon} border-kraveo-danger/30 bg-kraveo-danger/10 text-kraveo-danger hover:bg-kraveo-danger hover:text-white`}>
        <Icon className="h-4 w-4" aria-hidden="true" />
      </button>
    );
    return (
      <div className="flex items-center justify-end gap-1.5">
        {a.status === 'PENDING' && <>{approve('Approuver', Check)}{deny('Refuser', 'REJECTED', X)}</>}
        {a.status === 'REJECTED' && approve('Approuver quand même', Check)}
        {a.status === 'SUSPENDED' && approve('Réactiver', RefreshCw)}
        {a.status === 'APPROVED' && deny('Suspendre', 'SUSPENDED', Ban)}
        {a.userId && a.status !== 'PENDING' && (
          <button type="button" title="Réinitialiser le mot de passe" aria-label="Réinitialiser le mot de passe" onClick={() => setDialog({ type: 'password', app: a })} className={`${icon} border-kraveo-line bg-kraveo-surface text-kraveo-ink2 hover:bg-kraveo-surface2`}>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
        <button type="button" title="Voir le détail" aria-label={`Voir le détail de ${nameOf(a)}`} onClick={() => setDetailKey(keyOf(a))} className={`${icon} border-kraveo-line bg-kraveo-surface text-kraveo-ink2 hover:bg-kraveo-surface2`}>
          <Eye className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    );
  };

  const renderActions = (a: Application, compact: boolean) => {
    const busy = busyId === a.id;
    const grow = compact ? '' : 'flex-1';
    return (
      <div className="flex flex-wrap gap-2">
        {a.status === 'PENDING' && (
          <>
            <button className={`k-btn-primary ${grow}`} disabled={busy} onClick={() => decide(a, 'APPROVED')} aria-busy={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}Approuver
            </button>
            <button className={`k-btn-danger ${grow}`} disabled={busy} onClick={() => setDialog({ type: 'reason', app: a, status: 'REJECTED' })}><X className="h-4 w-4" aria-hidden="true" />Refuser</button>
          </>
        )}
        {a.status === 'REJECTED' && (
          <button className={`k-btn-primary ${grow}`} disabled={busy} onClick={() => decide(a, 'APPROVED')}><Check className="h-4 w-4" aria-hidden="true" />Approuver quand même</button>
        )}
        {a.status === 'SUSPENDED' && (
          <button className={`k-btn-primary ${grow}`} disabled={busy} onClick={() => decide(a, 'APPROVED')}><RefreshCw className="h-4 w-4" aria-hidden="true" />Réactiver</button>
        )}
        {a.status === 'APPROVED' && (
          <button className={`k-btn-danger ${grow}`} disabled={busy} onClick={() => setDialog({ type: 'reason', app: a, status: 'SUSPENDED' })}>Suspendre</button>
        )}
        {a.userId && a.status !== 'PENDING' && (
          <button className="k-btn-ghost" onClick={() => setDialog({ type: 'password', app: a })}><KeyRound className="h-4 w-4" aria-hidden="true" />Réinitialiser le mot de passe</button>
        )}
      </div>
    );
  };

  const prefs = useTablePrefs<AppColumn>('kraveo_applications_prefs', 'grid');
  const [sort, setSort] = useState<{ field: AppSort; dir: 'asc' | 'desc' } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailKey, setDetailKey] = useState<string | null>(null);
  const keyOf = (a: Application) => `${a.kind}-${a.id}`;
  const nameOf = (a: Application) => (a.kind === 'VENDOR' ? a.vendor?.name ?? a.name : a.name);
  const sorted = useMemo(() => {
    if (!sort) return visible;
    const value = (a: Application): string | number => (sort.field === 'name' ? nameOf(a).toLowerCase() : new Date(a.appliedAt ?? a.createdAt).getTime());
    return [...visible].sort((x, y) => {
      const u = value(x); const v = value(y);
      const cmp = typeof u === 'string' ? u.localeCompare(String(v), 'fr') : u - (v as number);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [visible, sort]);
  const pager = usePagination(sorted, `${status}|${kind}|${dossierFilter}|${query}`, 10);
  const pageAllSelected = pager.pageItems.length > 0 && pager.pageItems.every((a) => selected.has(keyOf(a)));
  const toggleOne = (a: Application) => setSelected((cur) => { const next = new Set(cur); if (next.has(keyOf(a))) next.delete(keyOf(a)); else next.add(keyOf(a)); return next; });
  const togglePage = () => setSelected((cur) => { const next = new Set(cur); pager.pageItems.forEach((a) => (pageAllSelected ? next.delete(keyOf(a)) : next.add(keyOf(a)))); return next; });
  const exportApps = (rows: Application[]) => downloadCsv('inscriptions',
    ['Type', 'Nom', 'Responsable', 'Téléphone', 'Détail', 'Statut', 'Date'],
    rows.map((a) => [a.kind === 'VENDOR' ? 'Restaurant' : 'Livreur', nameOf(a), a.name, a.phone, a.kind === 'VENDOR' ? a.vendor?.address : `${vehicleLabel(a.driver?.vehicleType)} ${a.driver?.vehicleRegNo ?? ''}`.trim(), a.status, a.appliedAt ?? a.createdAt]));
  const sortState = (field: AppSort): false | 'asc' | 'desc' => (sort?.field === field ? sort.dir : false);
  const emptyState = (
    <EmptyState
      icon={status === 'PENDING' && !query.trim() ? ClipboardCheck : SearchX}
      title={status === 'PENDING' && !query.trim() ? 'Aucune candidature en attente' : 'Rien ici'}
      description={status === 'PENDING' && !query.trim() ? 'Quand un restaurant ou un livreur crée un compte dans son application, il apparaît ici pour validation.' : 'Aucun partenaire ne correspond à ce filtre.'}
    />
  );
  const detailApp = detailKey ? items.find((a) => keyOf(a) === detailKey) ?? null : null;
  const colCount = 9;

  return (
    <div className="space-y-5">
      <PageHeader icon={ClipboardCheck} title="Inscriptions" subtitle="Validez les nouveaux restaurants et livreurs avant qu’ils ne reçoivent des commandes" onRefresh={() => { setLoading(true); load(); }} refreshing={loading && items.length > 0}
        actions={(
          <div className="relative flex items-center gap-2">
            <button type="button" className="k-btn-ghost" onClick={copySignupLink} title="Copier le lien que vous envoyez aux restaurants pour qu’ils s’inscrivent"><Link2 className="h-4 w-4" aria-hidden="true" />Lien d’inscription</button>
            <button type="button" className="k-btn-accent" aria-haspopup="menu" aria-expanded={addMenu} onClick={() => setAddMenu(!addMenu)}>
              <Plus className="h-4 w-4" aria-hidden="true" />Ajouter manuellement<ChevronDown className="h-4 w-4" aria-hidden="true" />
            </button>
            {addMenu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setAddMenu(false)} aria-hidden="true" />
                <ul role="menu" className="absolute right-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-k-md border border-kraveo-line bg-kraveo-surface py-1 shadow-k-lift">
                  <li role="none"><button type="button" role="menuitem" onClick={() => { setAddMenu(false); setAdding('VENDOR'); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-kraveo-ink2 hover:bg-kraveo-surface2"><Store className="h-4 w-4 text-kraveo-y700" aria-hidden="true" />Un restaurant</button></li>
                  <li role="none"><button type="button" role="menuitem" onClick={() => { setAddMenu(false); setAdding('DRIVER'); }} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm font-semibold text-kraveo-ink2 hover:bg-kraveo-surface2"><Bike className="h-4 w-4 text-kraveo-g600" aria-hidden="true" />Un livreur</button></li>
                </ul>
              </>
            )}
          </div>
        )} />
      {onQueryChange && <SearchField value={query} onChange={onQueryChange} label="Rechercher une inscription" placeholder="Rechercher par nom, téléphone, adresse ou immatriculation…" />}
      <UnderlineTabs label="Filtrer par décision" value={status} onChange={setStatus} tabs={STATUS_TABS.map((t) => ({ id: t.id, label: t.label, count: countFor(t.id), alert: t.id === 'PENDING' }))} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par type">
          {([['ALL', 'Tout le monde'], ['VENDOR', 'Restaurants'], ['DRIVER', 'Livreurs']] as const).map(([id, label]) => (
            <button key={id} className="k-chip" aria-pressed={kind === id} onClick={() => setKind(id)}>{label}</button>
          ))}
          <span className="mx-1 hidden w-px self-stretch bg-kraveo-line sm:block" aria-hidden="true" />
          {([['ALL', 'Tous les dossiers'], ['COMPLETE', 'Dossier complet'], ['MISSING', 'Documents manquants']] as const).map(([id, label]) => (
            <button key={id} className="k-chip" aria-pressed={dossierFilter === id} onClick={() => setDossierFilter(id)}>{label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="k-btn-ghost" onClick={() => exportApps(visible)} disabled={visible.length === 0}><Download className="h-4 w-4" aria-hidden="true" />Exporter en CSV</button>
          <ViewToggle value={prefs.view} onChange={prefs.setView} />
          <ColumnsMenu columns={APP_COLUMNS} hidden={prefs.hidden} onToggle={prefs.toggleColumn} onReset={prefs.resetColumns} />
        </div>
      </div>
      {selected.size > 0 && <SelectionBar count={selected.size} noun="inscription" onExport={() => exportApps(items.filter((a) => selected.has(keyOf(a))))} onClear={() => setSelected(new Set())} />}

      {error && <div role="alert" className="rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 px-4 py-3 text-sm text-kraveo-ink">{error}</div>}

      {prefs.view === 'table' && (
        <div className="k-card overflow-x-auto">
          <table className="w-full min-w-[900px] border-separate border-spacing-0 text-left text-sm">
            <thead>
              <tr className="k-label">
                <th scope="col" className="w-12 border-b border-kraveo-line px-4 py-3.5"><input type="checkbox" checked={pageAllSelected} onChange={togglePage} aria-label="Sélectionner toutes les inscriptions de la page" className="h-4 w-4 rounded border-kraveo-line accent-[#2F5BE0]" /></th>
                <th scope="col" className="w-[15rem] border-b border-kraveo-line px-4 py-3.5"><SortHeader label="Candidat" active={sortState('name')} onClick={() => setSort(nextSort(sort, 'name'))} /></th>
                {prefs.show('type') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Type</th>}
                {prefs.show('phone') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Téléphone</th>}
                {prefs.show('detail') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Détail</th>}
                {prefs.show('dossier') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Dossier</th>}
                {prefs.show('status') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5">Décision</th>}
                {prefs.show('date') && <th scope="col" className="border-b border-kraveo-line px-4 py-3.5"><SortHeader label="Reçue" active={sortState('date')} onClick={() => setSort(nextSort(sort, 'date'))} /></th>}
                <th scope="col" className="border-b border-kraveo-line px-4 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && items.length === 0 && Array.from({ length: 4 }).map((_, i) => <tr key={i}><td colSpan={colCount} className="border-b border-kraveo-line/60 px-4 py-3"><Skeleton className="h-10 w-full" /></td></tr>)}
              {!loading && pager.pageItems.length === 0 && <tr><td colSpan={colCount}>{emptyState}</td></tr>}
              {pager.pageItems.map((a) => {
                const isVendor = a.kind === 'VENDOR';
                const cell = 'border-b border-kraveo-line/60 px-4 py-3 align-middle';
                return (
                  <tr key={keyOf(a)} tabIndex={0} aria-label={`Ouvrir le détail de ${nameOf(a)}`} className="group cursor-pointer outline-none transition-colors hover:bg-kraveo-surface2/60 focus-visible:bg-kraveo-surface2/60"
                    onClick={() => setDetailKey(keyOf(a))} onKeyDown={(e) => { if (e.key === 'Enter') setDetailKey(keyOf(a)); }}>
                    <td className={`${cell} w-12`} onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(keyOf(a))} onChange={() => toggleOne(a)} aria-label={`Sélectionner ${nameOf(a)}`} className="h-4 w-4 rounded border-kraveo-line accent-[#2F5BE0]" /></td>
                    <td className={`${cell} w-[15rem] max-w-[15rem]`}>
                      <div className="flex items-center gap-3">
                        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-k-md ${isVendor ? 'bg-kraveo-yellow/20 text-kraveo-y700' : 'bg-kraveo-g500/10 text-kraveo-g600'}`}>{isVendor ? <Store className="h-5 w-5" aria-hidden="true" /> : <Bike className="h-5 w-5" aria-hidden="true" />}</span>
                        <div className="min-w-0">
                          <p className="truncate font-bold text-kraveo-ink" title={nameOf(a)}>{nameOf(a)}</p>
                          <p className="truncate text-xs text-kraveo-ink3">{isVendor ? `Responsable : ${a.name}` : 'Livreur partenaire'}</p>
                        </div>
                      </div>
                    </td>
                    {prefs.show('type') && <td className={cell}><span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-bold ${isVendor ? 'bg-kraveo-yellow/20 text-kraveo-y700' : 'bg-kraveo-g500/10 text-kraveo-g700'}`}>{isVendor ? 'Restaurant' : 'Livreur'}</span></td>}
                    {prefs.show('phone') && <td className={`${cell} whitespace-nowrap`} onClick={(e) => e.stopPropagation()}>{a.phone ? <a href={`tel:${a.phone}`} className="inline-flex items-center gap-1.5 font-semibold text-kraveo-ink2 hover:text-kraveo-g600"><Phone className="h-3.5 w-3.5 text-kraveo-ink3" aria-hidden="true" />{a.phone}</a> : <span className="text-kraveo-ink3">—</span>}</td>}
                    {prefs.show('detail') && <td className={`${cell} max-w-[14rem]`}><p className="flex items-center gap-1.5 truncate text-kraveo-ink2">{isVendor ? <><MapPin className="h-3.5 w-3.5 shrink-0 text-kraveo-ink3" aria-hidden="true" /><span className="truncate">{dash(a.vendor?.address)}</span></> : <span className="truncate">{dash(vehicleLabel(a.driver?.vehicleType))}{a.driver?.vehicleRegNo ? ` · ${a.driver.vehicleRegNo}` : ''}</span>}</p></td>}
                    {prefs.show('dossier') && <td className={`${cell} w-44`}><DossierPill dossier={dossierOf(a)} /></td>}
                    {prefs.show('status') && <td className={cell}><ApprovalPill status={a.status} showApproved /></td>}
                    {prefs.show('date') && <td className={`${cell} whitespace-nowrap text-xs text-kraveo-ink3`}>{a.selfSignup ? timeAgo(a.appliedAt) : `Ajouté ${timeAgo(a.createdAt)}`}</td>}
                    <td className={`${cell} w-px`} onClick={(e) => e.stopPropagation()}>{renderIconActions(a)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {prefs.view === 'grid' && (
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {loading && items.length === 0 && Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} lines={3} />)}
        {!loading && visible.length === 0 && (
          <div className="k-card lg:col-span-2 2xl:col-span-3">
            <EmptyState
              icon={ClipboardCheck}
              title={status === 'PENDING' ? 'Aucune candidature en attente' : 'Rien ici'}
              description={status === 'PENDING' ? 'Quand un restaurant ou un livreur crée un compte dans son application, il apparaît ici pour validation.' : 'Aucun partenaire ne correspond à ce filtre.'}
            />
          </div>
        )}
        {pager.pageItems.map((a, index) => {
          const isVendor = a.kind === 'VENDOR';
          const busy = busyId === a.id;
          return (
            <article key={`${a.kind}-${a.id}`} className="k-card k-reveal flex flex-col p-5" style={{ ['--i' as string]: Math.min(index, 10) }}>
              <div className="flex items-start gap-3.5">
                <Avatar name={isVendor ? a.vendor?.name ?? a.name : a.name} size="lg" className={isVendor ? '!rounded-k-md' : ''} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-kraveo-surface2 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-kraveo-ink2">
                      {isVendor ? <Store className="h-3 w-3" aria-hidden="true" /> : <Bike className="h-3 w-3" aria-hidden="true" />}{isVendor ? 'Restaurant' : 'Livreur'}
                    </span>
                    <ApprovalPill status={a.status} showApproved />
                  </div>
                  <h3 className="mt-1.5 truncate font-display text-lg font-bold leading-tight text-kraveo-ink">{isVendor ? a.vendor?.name : a.name}</h3>
                  {isVendor && <p className="truncate text-xs text-kraveo-ink3">Owner: {a.name}</p>}
                  <p className="mt-1 text-xs text-kraveo-ink3">{a.selfSignup ? `Candidature ${timeAgo(a.appliedAt)}` : `Ajouté par l’admin ${timeAgo(a.createdAt)}`}</p>
                </div>
              </div>

              <div className="mt-3"><DossierPill dossier={dossierOf(a)} /></div>

              {renderDetails(a)}

              <div className="mt-auto pt-4">{renderActions(a, false)}</div>
            </article>
          );
        })}
      </div>
      )}

      <PaginationBar page={pager.page} pageCount={pager.pageCount} pageSize={pager.pageSize} total={pager.total} onPage={pager.setPage} onPageSize={pager.setPageSize} noun="inscriptions" />

      <Drawer
        open={Boolean(detailApp)}
        onClose={() => setDetailKey(null)}
        title={detailApp ? nameOf(detailApp) : 'Inscription'}
        subtitle={detailApp ? `${detailApp.kind === 'VENDOR' ? 'Restaurant' : 'Livreur'} · ${detailApp.selfSignup ? `candidature ${timeAgo(detailApp.appliedAt)}` : `ajouté par l’admin ${timeAgo(detailApp.createdAt)}`}` : ''}
        icon={detailApp?.kind === 'DRIVER' ? Bike : Store}
        footer={detailApp ? renderActions(detailApp, false) : undefined}
      >
        {detailApp && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ApprovalPill status={detailApp.status} showApproved />
              {detailApp.kind === 'VENDOR' && <span className="text-xs text-kraveo-ink3">Responsable : {detailApp.name}</span>}
            </div>
            <DossierPill dossier={dossierOf(detailApp)} />
            <DossierChecklist dossier={dossierOf(detailApp)} />
            {renderDetails(detailApp)}
          </div>
        )}
      </Drawer>

      <AddPartnerDrawer open={adding !== null} kind={adding ?? 'VENDOR'} onClose={() => setAdding(null)} onCreated={() => { setLoading(true); load(); onChanged(); }} />

      <ReasonDrawer
        dialog={dialog?.type === 'reason' ? dialog : null}
        onClose={() => setDialog(null)}
        onSubmit={async (reason) => {
          const d = dialog;
          if (d?.type !== 'reason') return;
          setDialog(null);
          await decide(d.app, d.status, reason);
        }}
      />
      <PasswordDrawer
        app={dialog?.type === 'password' ? dialog.app : null}
        onClose={() => setDialog(null)}
        onAuthError={onAuthError}
      />
    </div>
  );
};

// ─────────────────────────── Reason (reject / suspend) ───────────────────────────
export const ReasonDrawer: React.FC<{
  dialog: Extract<Dialog, { type: 'reason' }> | null;
  onClose: () => void;
  onSubmit: (reason: string) => void | Promise<void>;
}> = ({ dialog, onClose, onSubmit }) => {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  useEffect(() => { if (dialog) { setReason(''); setTouched(false); } }, [dialog]);
  const open = Boolean(dialog);
  const isReject = dialog?.status === 'REJECTED';
  const chips = isReject ? REJECT_REASONS : SUSPEND_REASONS;
  const tooShort = reason.trim().length < 3;
  const name = dialog ? (dialog.app.kind === 'VENDOR' ? dialog.app.vendor?.name : dialog.app.name) : '';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isReject ? 'Refuser la candidature' : 'Suspendre le partenaire'}
      subtitle={name}
      icon={X}
      footer={
        <div className="flex gap-3">
          <button type="button" className="k-btn-ghost flex-1" onClick={onClose}>Annuler</button>
          <button type="submit" form="reason-form" className="k-btn-danger flex-1">{isReject ? 'Refuser' : 'Suspendre'}</button>
        </div>
      }
    >
      <form id="reason-form" noValidate className="space-y-4" onSubmit={(e) => { e.preventDefault(); setTouched(true); if (!tooShort) onSubmit(reason.trim()); }}>
        <p className="text-sm text-kraveo-ink2">{isReject ? 'Ils le verront dans l’application et pourront corriger leurs informations puis postuler à nouveau.' : 'Ils le verront dans l’application. Leurs commandes et leur statut en ligne s’arrêtent immédiatement.'}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Motifs rapides">
          {chips.map((c) => <button key={c} type="button" className="k-chip" aria-pressed={reason === c} onClick={() => setReason(c)}>{c}</button>)}
        </div>
        <Field label="Motif" htmlFor="decision-reason" required error={touched && tooShort ? 'Indiquez un motif court (au moins 3 caractères).' : undefined}>
          <textarea id="decision-reason" rows={4} maxLength={200} className="k-input !min-h-[110px] py-3" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={touched && tooShort} />
        </Field>
      </form>
    </Drawer>
  );
};

// ─────────────────────────── Reset password ───────────────────────────
const PasswordDrawer: React.FC<{ app: Application | null; onClose: () => void; onAuthError: (e: unknown) => void }> = ({ app, onClose, onAuthError }) => {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (app) { setPassword(generatePassword()); setSaving(false); setDone(false); setCopied(false); setError(''); } }, [app]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!app?.userId) return;
    if (password.length < 8) { setError('Au moins 8 caractères.'); return; }
    setSaving(true); setError('');
    try {
      await apiService.resetPartnerPassword(app.userId, password);
      setDone(true);
      toast.success('Mot de passe modifié', 'Tout blocage sur ce numéro est également levé.');
    } catch (err) {
      onAuthError(err);
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Impossible de réinitialiser le mot de passe.');
    } finally { setSaving(false); }
  };

  const text = app ? `Identifiants AFFIA FOODS${app.kind === 'VENDOR' ? 'Restaurant partenaire' : 'Livreur partenaire'}\nTéléphone : ${(app.phone ?? '').replace(/\D/g, '').slice(-10)}\nNouveau mot de passe : ${password}` : '';

  return (
    <Drawer
      open={Boolean(app)}
      onClose={() => { if (!saving) onClose(); }}
      title="Réinitialiser le mot de passe"
      subtitle={app ? `${app.name} · ${app.phone ?? ''}` : ''}
      icon={KeyRound}
      footer={done ? <button className="k-btn-primary w-full" onClick={onClose}>Terminé</button> : (
        <div className="flex gap-3">
          <button type="button" className="k-btn-ghost flex-1" onClick={onClose} disabled={saving}>Annuler</button>
          <button type="submit" form="reset-form" className="k-btn-primary flex-1" disabled={saving} aria-busy={saving}>{saving ? 'Enregistrement…' : 'Définir le nouveau mot de passe'}</button>
        </div>
      )}
    >
      {done ? (
        <div className="space-y-4">
          <div className="rounded-k-md border border-kraveo-g400/30 bg-kraveo-g500/10 p-4 text-sm text-kraveo-ink">Le nouveau mot de passe est actif. Envoyez-le ; il ne sera plus affiché.</div>
          <div className="k-inset p-4 font-mono"><p className="k-label font-body">Nouveau mot de passe</p><p className="select-all text-base font-bold text-kraveo-ink">{password}</p></div>
          <button className="k-btn-accent w-full" onClick={async () => setCopied(await copyText(text))}>{copied ? <><Check className="h-4 w-4" aria-hidden="true" />Copié</> : <><Copy className="h-4 w-4" aria-hidden="true" />Copier les identifiants</>}</button>
        </div>
      ) : (
        <form id="reset-form" noValidate onSubmit={save} className="space-y-4">
          {error && <div role="alert" className="rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 px-4 py-3 text-sm text-kraveo-ink">{error}</div>}
          <p className="text-sm text-kraveo-ink2">Il n’y a pas de « mot de passe oublié » par SMS : un partenaire qui oublie le sien vous en demande un nouveau.</p>
          <Field label="Nouveau mot de passe" htmlFor="new-pass" required>
            <div className="flex gap-2">
              <input id="new-pass" className="k-input font-mono" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
              <button type="button" className="k-btn-ghost shrink-0" onClick={() => setPassword(generatePassword())}><RefreshCw className="h-4 w-4" aria-hidden="true" />Générer</button>
            </div>
          </Field>
        </form>
      )}
    </Drawer>
  );
};
