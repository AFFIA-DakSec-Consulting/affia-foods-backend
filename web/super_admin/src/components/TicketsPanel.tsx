import React, { useCallback, useEffect, useState } from 'react';
import { LifeBuoy, Loader2, Lock, Send } from 'lucide-react';
import { apiService } from '../services/api';
import { AdminProfile } from '../types';
import { TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, Ticket, TicketPriority, TicketStatus } from '../lib/platformParse';
import { timeAgo } from '../lib/tokens';
import { Drawer } from './ui/Drawer';
import { EmptyState } from './ui/EmptyState';
import { Field } from './ui/Field';
import { KpiTile } from './ui/KpiTile';
import { PaginationBar } from './ui/Pagination';
import { SkeletonCard } from './ui/Skeleton';
import { useToast } from './ui/Toast';
import { PageHeader, SearchField, UnderlineTabs } from './ui/PageToolbar';
import { CheckRow, ErrorBanner, Pill, Tone, dateTime, errorText, useLoad } from './platform/common';
import { CheckCircle2, Clock3, Inbox, Wrench } from 'lucide-react';

export const STATUS_LABEL: Record<TicketStatus, string> = { OPEN: 'Ouverte', IN_PROGRESS: 'En cours', RESOLVED: 'Résolue', CLOSED: 'Clôturée' };
const STATUS_TONE: Record<TicketStatus, Tone> = { OPEN: 'red', IN_PROGRESS: 'amber', RESOLVED: 'green', CLOSED: 'grey' };
export const PRIORITY_LABEL: Record<TicketPriority, string> = { LOW: 'Basse', NORMAL: 'Normale', HIGH: 'Haute', URGENT: 'Urgente' };
const PRIORITY_TONE: Record<TicketPriority, Tone> = { LOW: 'grey', NORMAL: 'blue', HIGH: 'amber', URGENT: 'red' };
export const CATEGORY_LABEL: Record<string, string> = { ORDER: 'Commande', PAYMENT: 'Paiement', DELIVERY: 'Livraison', FOOD_QUALITY: 'Qualité des plats', ACCOUNT: 'Compte', APP: 'Application', OTHER: 'Autre' };
const ROLE_LABEL: Record<string, string> = { CLIENT: 'Client', VENDOR: 'Restaurant', DRIVER: 'Livreur', ADMIN: 'Équipe' };

const TicketDrawer: React.FC<{ ticketId: string | null; adminId?: string; onClose: () => void; onChanged: () => void; onAuthError: (e: unknown) => void }> = ({ ticketId, adminId, onClose, onChanged, onAuthError }) => {
  const toast = useToast();
  const { data: ticket, setData, loading, error, reload } = useLoad(() => (ticketId ? apiService.fetchTicket(ticketId) : Promise.resolve(null)), onAuthError, [ticketId]);
  const [message, setMessage] = useState('');
  const [internal, setInternal] = useState(false);
  const [resolution, setResolution] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  useEffect(() => { setMessage(''); setInternal(false); setProblem(''); }, [ticketId]);
  useEffect(() => { setResolution(ticket?.resolution ?? ''); }, [ticket?.id, ticket?.resolution]);

  const update = async (patch: { status?: TicketStatus; priority?: TicketPriority; assignedTo?: string | null; resolution?: string }, done: string) => {
    if (!ticket) return;
    setBusy(true); setProblem('');
    try { await apiService.updateTicket(ticket.id, patch); toast.success(done); await reload(); onChanged(); } catch (e) { onAuthError(e); setProblem(errorText(e)); } finally { setBusy(false); }
  };

  const markResolved = () => {
    if (resolution.trim().length < 3) { setProblem('Écrivez ce qui a été fait (3 caractères minimum) avant de marquer la réclamation comme résolue.'); return; }
    update({ status: 'RESOLVED', resolution: resolution.trim() }, 'Réclamation résolue');
  };

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!ticket) return;
    if (message.trim().length < 2) { setProblem('Écrivez un message.'); return; }
    setBusy(true); setProblem('');
    try {
      await apiService.replyTicket(ticket.id, message.trim(), internal);
      toast.success(internal ? 'Note interne ajoutée' : 'Réponse envoyée');
      setMessage(''); await reload(); onChanged();
    } catch (e) { onAuthError(e); setProblem(errorText(e)); } finally { setBusy(false); }
  };

  const closed = ticket?.status === 'CLOSED';
  return (
    <Drawer open={Boolean(ticketId)} onClose={onClose} title={ticket?.subject ?? 'Réclamation'} subtitle={ticket ? `${CATEGORY_LABEL[ticket.category] ?? ticket.category} · ${ROLE_LABEL[ticket.openedByRole] ?? ticket.openedByRole}` : undefined} icon={LifeBuoy} wide focusFirstField={false}>
      {error && <ErrorBanner message={error} onRetry={reload} />}
      {loading && !ticket && <SkeletonCard lines={4} />}
      {ticket && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2"><Pill tone={STATUS_TONE[ticket.status]}>{STATUS_LABEL[ticket.status]}</Pill><Pill tone={PRIORITY_TONE[ticket.priority]}>Priorité {PRIORITY_LABEL[ticket.priority].toLowerCase()}</Pill>{ticket.orderId && <Pill>Commande {ticket.orderId.slice(0, 8)}</Pill>}</div>
          {ticket.user && <div className="k-inset px-4 py-3 text-sm"><p className="font-bold text-kraveo-ink">{ticket.user.name}</p><p className="text-kraveo-ink2">{ticket.user.phone || 'Pas de téléphone'} · {ROLE_LABEL[ticket.user.role] ?? ticket.user.role}</p></div>}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Statut" htmlFor="t-status">
              <select id="t-status" className="k-input" value={ticket.status} disabled={busy} onChange={(e) => { const s = e.target.value as TicketStatus; if (s === 'RESOLVED') markResolved(); else update({ status: s }, 'Statut mis à jour'); }}>{TICKET_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
            </Field>
            <Field label="Priorité" htmlFor="t-prio">
              <select id="t-prio" className="k-input" value={ticket.priority} disabled={busy} onChange={(e) => update({ priority: e.target.value as TicketPriority }, 'Priorité mise à jour')}>{TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
            </Field>
          </div>
          {adminId && (
            <button type="button" className="k-btn-ghost !min-h-[36px] text-xs" disabled={busy} onClick={() => update({ assignedTo: ticket.assignedTo === adminId ? null : adminId }, ticket.assignedTo === adminId ? 'Réclamation libérée' : 'Réclamation assignée à vous')}>
              {ticket.assignedTo === adminId ? 'Me retirer de cette réclamation' : ticket.assignedTo ? 'Reprendre à mon nom' : 'M’assigner cette réclamation'}
            </button>
          )}
          <Field label="Résolution" htmlFor="t-resolution" hint="Obligatoire pour marquer la réclamation comme résolue.">
            <textarea id="t-resolution" rows={2} className="k-input" value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={1000} />
          </Field>

          <section aria-label="Échanges" className="space-y-3">
            <h3 className="k-label">Échanges ({ticket.messages.length})</h3>
            {ticket.messages.map((m) => {
              const mine = m.authorRole === 'ADMIN';
              return (
                <div key={m.id} className={`rounded-k-md px-4 py-3 text-sm ${m.internal ? 'border border-dashed border-kraveo-status-placed/50 bg-kraveo-status-placed/10' : mine ? 'bg-kraveo-g500/10' : 'bg-kraveo-surface2'}`}>
                  <p className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-kraveo-ink3">{ROLE_LABEL[m.authorRole] ?? m.authorRole}{m.internal && <span className="inline-flex items-center gap-1 text-kraveo-status-placed"><Lock className="h-3 w-3" aria-hidden="true" />Note interne</span>}<span className="font-normal normal-case">· {dateTime(m.createdAt)}</span></p>
                  <p className="whitespace-pre-wrap break-words text-kraveo-ink">{m.body}</p>
                </div>
              );
            })}
          </section>

          {problem && <p role="alert" className="text-sm font-semibold text-kraveo-danger">{problem}</p>}
          {closed ? <p className="text-sm text-kraveo-ink2">Cette réclamation est clôturée. Changez son statut pour répondre à nouveau.</p> : (
            <form onSubmit={send} className="space-y-3" noValidate>
              <Field label={internal ? 'Note interne (invisible pour la personne)' : 'Votre réponse'} htmlFor="t-message">
                <textarea id="t-message" rows={3} className="k-input" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} />
              </Field>
              <CheckRow id="t-internal" label="Note interne" hint="Seule l’équipe la voit." checked={internal} onChange={setInternal} />
              <button type="submit" className="k-btn-accent w-full" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}{internal ? 'Ajouter la note' : 'Envoyer la réponse'}</button>
            </form>
          )}
        </div>
      )}
    </Drawer>
  );
};

export const TicketsPanel: React.FC<{ adminProfile: AdminProfile | null; onAuthError: (e: unknown) => void }> = ({ adminProfile, onAuthError }) => {
  const [status, setStatus] = useState<'ALL' | TicketStatus>('OPEN');
  const [category, setCategory] = useState('');
  const [priority, setPriority] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => { const t = window.setTimeout(() => setDebounced(search), 350); return () => window.clearTimeout(t); }, [search]);
  useEffect(() => { setPage(1); }, [status, category, priority, debounced]);

  const stats = useLoad(() => apiService.fetchSupportStats('30d'), onAuthError);
  const list = useLoad(() => apiService.fetchTickets({ status: status === 'ALL' ? '' : status, category, priority, q: debounced }, page, 25), onAuthError, [status, category, priority, debounced, page]);
  const reloadList = list.reload; const reloadStats = stats.reload;
  const refresh = useCallback(() => { reloadList(); reloadStats(); }, [reloadList, reloadStats]);
  const s = stats.data;
  const rows = list.data?.data ?? [];

  return (
    <div className="space-y-5">
      <PageHeader icon={LifeBuoy} title="Réclamations" subtitle="Litiges et demandes des clients, restaurants et livreurs." onRefresh={refresh} refreshing={list.loading} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile label="Ouvertes" value={s?.open ?? 0} icon={Inbox} tone="text-kraveo-danger" toneBg="bg-kraveo-danger/10" loading={stats.loading && !s} index={0} />
        <KpiTile label="En cours" value={s?.inProgress ?? 0} icon={Wrench} loading={stats.loading && !s} index={1} />
        <KpiTile label="1re réponse" value={s?.avgFirstResponseMinutes == null ? '—' : `${Math.round(s.avgFirstResponseMinutes)} min`} note="Moyenne sur 30 jours" icon={Clock3} loading={stats.loading && !s} index={2} />
        <KpiTile label="Résolution" value={s?.avgResolutionHours == null ? '—' : `${s.avgResolutionHours.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} h`} note="Moyenne sur 30 jours" icon={CheckCircle2} loading={stats.loading && !s} index={3} />
      </div>
      <UnderlineTabs label="Statut" value={status} onChange={setStatus}
        tabs={[{ id: 'OPEN', label: 'Ouvertes', count: s?.open, alert: true }, { id: 'IN_PROGRESS', label: 'En cours', count: s?.inProgress }, { id: 'RESOLVED', label: 'Résolues', count: s?.resolved }, { id: 'CLOSED', label: 'Clôturées', count: s?.closed }, { id: 'ALL', label: 'Toutes', count: s?.total }]} />
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex-1"><SearchField value={search} onChange={setSearch} placeholder="Rechercher dans les sujets" label="Rechercher une réclamation" /></div>
        <select aria-label="Catégorie" className="k-input sm:!w-48" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Toutes les catégories</option>{TICKET_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select>
        <select aria-label="Priorité" className="k-input sm:!w-44" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">Toutes priorités</option>{TICKET_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</select>
      </div>
      {list.error && <ErrorBanner message={list.error} onRetry={list.reload} />}
      {list.loading && !list.data && <SkeletonCard lines={4} />}
      {list.data && rows.length === 0 && <div className="k-card p-6"><EmptyState icon={Inbox} title="Aucune réclamation" description="Rien à traiter avec ces filtres." /></div>}
      {rows.length > 0 && (
        <ul className="k-card divide-y divide-kraveo-line/60 overflow-hidden">
          {rows.map((t: Ticket) => (
            <li key={t.id}>
              <button type="button" onClick={() => setOpenId(t.id)} className="flex w-full flex-col gap-2 px-4 py-3 text-left hover:bg-kraveo-surface2 sm:flex-row sm:items-center sm:justify-between">
                <span className="min-w-0"><span className="block truncate font-bold text-kraveo-ink">{t.subject}</span><span className="block truncate text-xs text-kraveo-ink3">{t.user?.name ?? 'Inconnu'} · {ROLE_LABEL[t.openedByRole] ?? t.openedByRole} · {CATEGORY_LABEL[t.category] ?? t.category} · {t.messageCount} message{t.messageCount > 1 ? 's' : ''} · {timeAgo(t.lastMessageAt)}</span></span>
                <span className="flex shrink-0 items-center gap-2"><Pill tone={PRIORITY_TONE[t.priority]}>{PRIORITY_LABEL[t.priority]}</Pill><Pill tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Pill></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.data && <PaginationBar page={page} pageCount={Math.max(1, Math.ceil(list.data.total / 25))} pageSize={25} total={list.data.total} onPage={setPage} noun="réclamations" />}
      <TicketDrawer ticketId={openId} adminId={adminProfile?.id} onClose={() => setOpenId(null)} onChanged={refresh} onAuthError={onAuthError} />
    </div>
  );
};
