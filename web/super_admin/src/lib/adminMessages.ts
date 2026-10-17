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
  const { status, code } = (error as { status?: unknown; code?: unknown } | null) ?? {};
  // A team role that lacks access to a section (or is read-only there) is a 403 too, but the session itself is fine.
  return status === 401 || (status === 403 && code !== 'PERMISSION_DENIED' && code !== 'READ_ONLY');
};

/** Wait before the next session re-check: 2 s, 4 s, 8 s ... up to 30 s. */
export const sessionRetryDelayMs = (attempt: number): number => Math.min(30_000, 2_000 * 2 ** Math.max(0, attempt));

/** Server codes of the modular platform, support and reviews turned into sentences the admin can act on. Others pass through. */
export const platformErrorMessage = (code: string | undefined, serverMessage: string): string => {
  switch (code) {
    case 'MODULE_CORE': return 'Ce module est obligatoire : il ne peut pas être désactivé.';
    case 'MODULE_DEPENDENCY': return `Activez d’abord les modules dont celui-ci dépend. ${serverMessage}`;
    case 'MODULE_DISABLED': return 'Activez d’abord le module concerné (page « Modules »), puis réessayez.';
    case 'CODE_TAKEN': return 'Ce code existe déjà. Choisissez-en un autre.';
    case 'PROMOTION_USED': return 'Cette promotion a déjà servi : désactivez-la au lieu de la supprimer.';
    case 'PLAN_HAS_SUBSCRIBERS': return 'Ce plan a des abonnés : désactivez-le au lieu de le supprimer.';
    case 'CAMPAIGN_NOT_DELETABLE': return 'Annulez d’abord la campagne. Une campagne envoyée est conservée pour ses statistiques.';
    case 'CAMPAIGN_SENT': return 'Une campagne envoyée ne peut plus être modifiée.';
    case 'LEGAL_NOT_DRAFT': return 'Une version publiée ne se modifie pas : créez une nouvelle version.';
    case 'LEGAL_NOT_PUBLISHED': return 'Publiez d’abord cette version.';
    case 'LEGAL_ACTIVE': return 'C’est la version affichée dans les applications : activez d’abord une autre version.';
    case 'SLUG_TAKEN': return 'Cette adresse est déjà utilisée par un autre article.';
    case 'LAST_ACTIVE_AREA': return 'L’application est limitée aux zones et c’est la dernière zone active. Ouvrez d’abord l’application à tout le Sénégal, ou ajoutez une autre zone.';
    case 'NO_ACTIVE_AREA': return 'Ajoutez et activez au moins une zone avant de limiter l’application aux zones.';
    case 'TOO_MANY_AREAS': return 'Vous avez atteint le nombre maximum de zones.';
    case 'READ_ONLY': return 'Votre rôle peut consulter cette section mais pas la modifier.';
    case 'OTP_REQUIRED': return 'Saisissez le code de votre application d’authentification (ou un code de secours).';
    case 'OTP_INVALID': return 'Ce code n’est pas valable. Vérifiez l’heure de votre téléphone ou utilisez un code de secours.';
    case 'TWO_FACTOR_ON': return 'La double authentification est déjà activée.';
    case 'TWO_FACTOR_UNAVAILABLE': return 'La double authentification n’est pas disponible : la clé de chiffrement du serveur n’est pas configurée.';
    case 'PERMISSION_DENIED': return 'Votre rôle dans l’équipe ne donne pas accès à cette section.';
    case 'PHONE_TAKEN': return 'Ce numéro a déjà un compte.';
    case 'TEAM_OWNER': return 'Le compte propriétaire se connecte avec le code d’accès général : il ne se modifie pas ici.';
    case 'TEAM_SELF': return 'Vous ne pouvez pas modifier votre propre rôle ni vous suspendre.';
    case 'TEAM_LAST_SUPER': return 'L’équipe doit garder au moins un super admin actif.';
    case 'REFERRAL_NOT_PENDING': return 'Seul un parrainage encore en attente peut être annulé.';
    case 'TICKET_CLOSED': return 'Cette réclamation est clôturée : rouvrez-la avant de répondre.';
    case 'RATE_LIMITED': return 'Trop de modifications d’un coup. Patientez quelques instants.';
    default: return serverMessage;
  }
};
