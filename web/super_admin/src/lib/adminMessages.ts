// Plain-language messages and small decisions for failure and success paths (no React).
import type { Application, ApprovalStatus } from '../types';

/** What the admin reads when assigning a rider fails. Server codes that are jargon become sentences; others pass through. */
export const reassignFailureMessage = (code: string | undefined, serverMessage: string): string => {
  if (code === 'RIDER_OFFLINE') return 'Ce livreur est hors ligne. Demandez-lui de se mettre en service, ou assignez-le quand même.';
  if (code === 'RIDER_BUSY') return 'Ce livreur a déjà une commande en cours. Terminez ou réassignez d’abord cette commande.';
  return serverMessage;
};

/** Toast shown after a partner decision. Reactivating a suspended restaurant leaves it closed (the server does not reopen it). */
export const decisionToast = (app: Pick<Application, 'kind' | 'status'>, next: ApprovalStatus, who: string): [string, string] => {
  if (next === 'APPROVED' && app.status === 'SUSPENDED') {
    return app.kind === 'VENDOR'
      ? ['Réactivé', `${who} est réactivé. Il reste fermé jusqu’à ce que le restaurant l’ouvre.`]
      : ['Réactivé', `${who} peut de nouveau travailler. La mise en service se fait depuis l’application.`];
  }
  const messages: Record<ApprovalStatus, [string, string]> = {
    APPROVED: ['Approuvé', `${who} peut commencer à travailler.`],
    REJECTED: ['Refusé', `${who} verra votre motif dans l’application.`],
    SUSPENDED: ['Suspendu', `${who} est bloqué jusqu’à sa réactivation.`],
    PENDING: ['Mis à jour', who],
  };
  return messages[next];
};

/** Only a rejected token (401/403) ends the stored session; a network blip, 5xx or 429 must not. */
export const isSessionRejected = (error: unknown): boolean => {
  const status = (error as { status?: unknown } | null)?.status;
  return status === 401 || status === 403;
};

/** Wait before the next session re-check: 2 s, 4 s, 8 s ... up to 30 s. */
export const sessionRetryDelayMs = (attempt: number): number => Math.min(30_000, 2_000 * 2 ** Math.max(0, attempt));
