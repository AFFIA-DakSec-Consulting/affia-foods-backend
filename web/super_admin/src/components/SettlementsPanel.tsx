import React, { useMemo, useRef, useState } from 'react';
import { ChevronRight, Download, Loader2, PlayCircle, Wallet } from 'lucide-react';
import { Vendor } from '../types';
import { apiService } from '../services/api';
import { DateRange, RunResult, SETTLEMENT_STATUSES, SettlementPage, STATUS_LABEL, SettlementStatus, dateLabel, istDateTime, presetRange, rupeesSigned } from '../lib/financeParse';
import { saveBlob } from '../lib/download';
import { rupees } from '../lib/pricing';
import { EmptyState } from './ui/EmptyState';
import { Skeleton } from './ui/Skeleton';
import { useConfirm } from './ui/ConfirmDialog';
import { useToast } from './ui/Toast';
import { DateRangePicker, ErrorNote, Pager, ReloadButton, ScrollTable, SectionCard, Td, Th, plainError, useLoad } from './FinanceCommon';
import { SettlementDrawer, SettlementStatusBadge } from './SettlementDrawer';
import type { Settlement } from '../lib/financeParse';

interface Props {
  vendors: Vendor[];
  /** The sidebar badge needs refreshing after a change here. */
  onChanged: () => void;
  onAuthError: (error: unknown) => void;
}

const PAGE_SIZE = 25;
/** The CSV export endpoint refuses ranges longer than this. */
const EXPORT_MAX_DAYS = 366;
const LIST_MAX_DAYS = 3660;

const periodText = (s: Settlement): string => {
  const a = istDateTime(s.periodStart);
  const b = istDateTime(s.periodEnd);
  return a && b ? `${a} au ${b}` : a || b || '';
};

export const SettlementsPanel: React.FC<Props> = ({ vendors, onChanged, onAuthError }) => {
  const toast = useToast();
  const { confirm, dialog } = useConfirm();
  const [status, setStatus] = useState<SettlementStatus | ''>('PENDING');
  const [vendorId, setVendorId] = useState('');
  const [range, setRange] = useState<DateRange | null>(null);
  const [pageState, setPageState] = useState({ key: '', page: 1 });
  const [open, setOpen] = useState<Settlement | null>(null);
  const [running, setRunning] = useState(false);
  const [exporting, setExporting] = useState(false);
  const busyRef = useRef(false);
  const [runResult, setRunResult] = useState<RunResult | null>(null);
  const [runError, setRunError] = useState('');
  const [exportError, setExportError] = useState('');
  const sortedVendors = useMemo(() => [...vendors].sort((a, b) => a.name.localeCompare(b.name)), [vendors]);

  const filterKey = `${status}|${vendorId}|${range ? `${range.from}..${range.to}` : 'all'}`;
  const page = pageState.key === filterKey ? pageState.page : 1;
  const list = useLoad<SettlementPage>(() => apiService.fetchSettlements({ status, vendorId, range, page, pageSize: PAGE_SIZE }), [filterKey, page], onAuthError);

  const changed = () => { list.reload(); onChanged(); };

  const runNow = async () => {
    if (busyRef.current) return;
    const ok = await confirm({
      title: 'Créer les règlements maintenant ?',
      message: 'Cela regroupe toutes les commandes livrées et payées qui ne sont pas encore dans un règlement, pour tous les restaurants, en un nouveau règlement EN ATTENTE par restaurant, avec le délai de rétention défini dans Réglages. Les commandes déjà réglées ne sont jamais comptées deux fois : vous pouvez relancer sans risque. Rien n’est payé par cette action.',
      confirmLabel: 'Créer les règlements',
    });
    if (!ok || busyRef.current) return;
    busyRef.current = true; setRunning(true); setRunError(''); setRunResult(null);
    try {
      const result = await apiService.runSettlements();
      setRunResult(result);
      toast.success('Création des règlements terminée', result.message || undefined);
      changed();
    } catch (failure) {
      onAuthError(failure);
      setRunError(plainError(failure));
    } finally { busyRef.current = false; setRunning(false); }
  };

  const exportRange = async () => {
    if (busyRef.current) return;
    if (range && (new Date(`${range.to}T00:00:00Z`).getTime() - new Date(`${range.from}T00:00:00Z`).getTime()) / 86_400_000 + 1 > EXPORT_MAX_DAYS) {
      setExportError(`L’export CSV couvre au maximum ${EXPORT_MAX_DAYS} jours. Choisissez une période plus courte.`);
      return;
    }
    busyRef.current = true; setExporting(true); setExportError('');
    try {
      const file = await apiService.downloadSettlementsCsv(range);
      saveBlob(file.blob, file.filename);
      toast.success('CSV téléchargé', file.filename);
    } catch (failure) {
      onAuthError(failure);
      setExportError(plainError(failure));
    } finally { busyRef.current = false; setExporting(false); }
  };

  const data = list.data;
  const shownStatuses: readonly SettlementStatus[] = status ? [status] : SETTLEMENT_STATUSES;
  const empty = !list.loading && !list.error && data !== null && data.items.length === 0;

  return (
    <div className="space-y-5">
      <SectionCard
        title="Règlements"
        description="Ce que l’on doit à chaque restaurant pour les commandes livrées. La tâche quotidienne les crée ; vous payez par virement ou UPI et enregistrez la référence."
        actions={(
          <>
            <ReloadButton onClick={list.reload} loading={list.loading} label="Recharger les règlements" />
            <button type="button" className="k-btn-ghost" onClick={exportRange} disabled={exporting} aria-busy={exporting}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              Exporter en CSV{range ? ` (du ${dateLabel(range.from)} au ${dateLabel(range.to)})` : ' (31 derniers jours)'}
            </button>
            <button type="button" className="k-btn-primary" onClick={runNow} disabled={running} aria-busy={running}>
              {running ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PlayCircle className="h-4 w-4" aria-hidden="true" />}Créer les règlements maintenant
            </button>
          </>
        )}
      >
        {runError && <ErrorNote message={runError} />}
        {exportError && <ErrorNote message={exportError} />}
        {runResult && (
          <div role="status" className="rounded-k-md border border-kraveo-g400/40 bg-kraveo-g500/10 px-4 py-3 text-sm text-kraveo-ink" data-testid="run-result">
            <p className="font-bold">{runResult.message || (runResult.created.length > 0 ? `${runResult.created.length} règlement(s) créé(s).` : 'Rien à régler.')}</p>
            {runResult.created.length > 0 && <p className="mt-1 text-xs text-kraveo-ink2">{runResult.created.length} {runResult.created.length === 1 ? 'règlement' : 'règlements'}, {runResult.orderCount} {runResult.orderCount === 1 ? 'commande' : 'commandes'}, {rupees(runResult.netPayable)} à payer{runResult.holdDays ? `, commandes retenues ${runResult.holdDays} jours` : ''}.</p>}
            {runResult.skipped.length > 0 && <p className="mt-1 text-xs text-kraveo-status-placed">{runResult.skipped.length} ignoré(s) : le lot automatique du jour existe déjà pour eux.</p>}
            {runResult.failed.length > 0 && <p className="mt-1 text-xs font-bold text-kraveo-danger">{runResult.failed.length} {runResult.failed.length === 1 ? 'restaurant en échec' : 'restaurants en échec'}. Cliquez à nouveau sur le bouton pour réessayer.</p>}
            <button type="button" className="mt-2 text-xs font-bold text-kraveo-g700 underline" onClick={() => setRunResult(null)}>Fermer</button>
          </div>
        )}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none lg:mx-0 lg:px-0" role="group" aria-label="Filtrer par statut">
            {SETTLEMENT_STATUSES.map((id) => (
              <button key={id} type="button" className="k-chip" aria-pressed={status === id} onClick={() => setStatus(id)}>{STATUS_LABEL[id]}</button>
            ))}
            <button type="button" className="k-chip" aria-pressed={status === ''} onClick={() => setStatus('')}>Tous</button>
          </div>
          <div>
            <label className="sr-only" htmlFor="settle-vendor-filter">Restaurant</label>
            <select id="settle-vendor-filter" className="k-select !min-h-[40px] w-full sm:w-64" value={vendorId} onChange={(event) => setVendorId(event.target.value)}>
              <option value="">Tous les restaurants</option>
              {sortedVendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        </div>
        <DateRangePicker value={range} onChange={setRange} maxDays={LIST_MAX_DAYS} allowAll label="Créés entre" />
      </SectionCard>

      {data && !list.error && (
        <section aria-label="Totaux pour ce filtre" className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="settlement-summary">
          {shownStatuses.map((id) => (
            <div key={id} className="k-card px-4 py-3">
              <p className="k-label">{STATUS_LABEL[id]}</p>
              <p className="k-num mt-1 text-2xl text-kraveo-ink">{rupees(data.summary[id].netPayable)}</p>
              <p className="text-[11px] text-kraveo-ink3">{data.summary[id].count} {data.summary[id].count === 1 ? 'règlement' : 'règlements'}</p>
            </div>
          ))}
        </section>
      )}
      {data && !list.error && status !== '' && <p className="-mt-3 text-[11px] text-kraveo-ink3">Les totaux suivent le filtre. Choisissez « Tous » pour voir tous les statuts.</p>}

      {list.error && <ErrorNote message={list.error} onRetry={list.reload} />}
      {list.loading && !data && !list.error && <div role="status" aria-label="Chargement des règlements" className="k-card space-y-3 p-5"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-2/3" /></div>}

      {empty && (
        <div className="k-card">
          <EmptyState icon={Wallet} title={status === 'PENDING' ? 'Rien en attente de paiement' : 'Aucun règlement ici'}
            description={status === 'PENDING' ? 'Les nouveaux règlements apparaissent après la tâche quotidienne, ou quand vous cliquez sur « Créer les règlements maintenant ».' : 'Rien ne correspond à ce filtre.'}
            action={status !== '' ? <button type="button" className="k-btn-ghost" onClick={() => setStatus('')}>Afficher tous les statuts</button> : undefined} />
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className={`k-card space-y-3 p-4 sm:p-5 ${list.loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}`} aria-busy={list.loading}>
          <p className="text-xs text-kraveo-ink3" aria-live="polite">{data.total} {data.total === 1 ? 'settlement' : 'settlements'}</p>
          <div className="hidden md:block">
            <ScrollTable caption="Règlements" minWidth="min-w-[860px]">
              <thead><tr><Th>Restaurant</Th><Th>Statut</Th><Th right>Commandes</Th><Th right>Part restaurant</Th><Th right>Ajustements</Th><Th right>Net à payer</Th><Th>Versement</Th><Th>Créé le</Th><Th><span className="sr-only">Ouvrir</span></Th></tr></thead>
              <tbody>
                {data.items.map((s) => (
                  <tr key={s.id} tabIndex={0} aria-label={`Ouvrir le règlement de ${s.vendorName}`} onClick={() => setOpen(s)} onKeyDown={(event) => { if (event.key === 'Enter' && event.target === event.currentTarget) setOpen(s); }}
                    className="cursor-pointer outline-none transition-colors hover:bg-kraveo-surface2/60 focus-visible:bg-kraveo-surface2/60">
                    <Td className="max-w-[14rem] break-words font-bold text-kraveo-ink">{s.vendorName}</Td>
                    <Td><SettlementStatusBadge status={s.status} /></Td>
                    <Td right>{s.orderCount}</Td>
                    <Td right>{rupees(s.vendorAmount)}</Td>
                    <Td right>{rupeesSigned(s.adjustmentTotal)}</Td>
                    <Td right><b className="text-kraveo-ink">{rupees(s.netPayable)}</b></Td>
                    <Td className="text-xs">{s.hasPayoutDetails ? (s.payoutSnapshot?.method === 'UPI' ? 'UPI' : 'Virement') : <span className="font-bold text-kraveo-status-placed">Aucune coordonnée de versement</span>}</Td>
                    <Td className="whitespace-nowrap text-xs">{istDateTime(s.createdAt)}</Td>
                    <Td><ChevronRight className="h-4 w-4 text-kraveo-ink3" aria-hidden="true" /></Td>
                  </tr>
                ))}
              </tbody>
            </ScrollTable>
          </div>
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:hidden">
            {data.items.map((s) => (
              <li key={s.id}>
                <button type="button" className="k-inset w-full space-y-2 px-3 py-3 text-left" onClick={() => setOpen(s)} aria-label={`Ouvrir le règlement de ${s.vendorName}`}>
                  <span className="flex items-start justify-between gap-2"><span className="min-w-0 break-words font-bold text-kraveo-ink">{s.vendorName}</span><SettlementStatusBadge status={s.status} /></span>
                  <span className="k-num block text-xl text-kraveo-ink">{rupees(s.netPayable)}</span>
                  <span className="block text-xs text-kraveo-ink3">{s.orderCount} {s.orderCount === 1 ? 'order' : 'orders'} · {periodText(s) || istDateTime(s.createdAt)}</span>
                  {!s.hasPayoutDetails && <span className="block text-xs font-bold text-kraveo-status-placed">Aucune coordonnée de versement</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && <Pager page={page} pages={data.pages} loading={list.loading} onPage={(next) => setPageState({ key: filterKey, page: next })} />}

      {open && <SettlementDrawer key={open.id} settlementId={open.id} preview={open} onClose={() => setOpen(null)} onChanged={changed} onAuthError={onAuthError} />}
      {dialog}
    </div>
  );
};
