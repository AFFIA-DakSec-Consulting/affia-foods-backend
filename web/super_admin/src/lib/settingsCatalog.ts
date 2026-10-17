// Everything the settings hub lists, for both workspaces. Data only (no React state).
// Pages marked with `planned` have no screen yet: they open a "Bientôt" page that says what they will configure.
// The super admin sees every card; nothing is hidden from this role.
import type React from 'react';
import {
  BellRing, Blocks, BookOpen, CalendarClock, Car, CreditCard, FileSignature, FileText, FolderTree, Gift, History, KeyRound, Languages, Lock,
  MapPinned, MessageSquareText, Navigation, Palette, Percent, Receipt, RotateCcw, Send, ShieldCheck, ShoppingBag, Store, UserRound,
  UtensilsCrossed, UserCog, Clock3, Wallet, Wrench, LifeBuoy, Download,
} from 'lucide-react';

export interface SettingsSoonPage {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  /** What this page will let the admin set. */
  planned: string[];
  /** What the server must provide first, in plain words. */
  needs: string;
}

const page = <I extends string>(p: SettingsSoonPage & { id: I }): SettingsSoonPage & { id: I } => p;

export const ADMIN_SETTINGS_PAGES = [
  page({ id: 'settings-security', title: 'Sécurité', icon: Lock, description: 'Double authentification et sessions ouvertes.', planned: ['Changer le code d’accès administrateur', 'Double authentification par SMS', 'Voir et fermer les sessions ouvertes', 'Adresses autorisées à se connecter'], needs: 'Des comptes administrateurs personnels côté serveur (aujourd’hui, un seul code d’accès).' }),
  page({ id: 'settings-brand', title: 'Entreprise & marque', icon: Palette, description: 'Nom, logo, contacts de support et liens des boutiques d’applications.', planned: ['Nom commercial et logo (Affia Foods)', 'E-mail et téléphone de support', 'Liens App Store et Google Play', 'Adresse et informations légales de la société'], needs: 'Un espace de réglages « entreprise » côté serveur, repris ensuite par les applications.' }),
  page({ id: 'settings-orders', title: 'Règles de commande', icon: ShoppingBag, description: 'Montant minimum, délais d’acceptation et annulations.', planned: ['Montant minimum de commande', 'Délai laissé au restaurant pour accepter, puis annulation automatique', 'Qui peut annuler, et jusqu’à quand', 'Nombre maximum de restaurants par commande (déjà réglable dans « Frais & commission »)'], needs: 'Ces règles sont aujourd’hui écrites dans le code du serveur : il faut les rendre modifiables.' }),
  page({ id: 'settings-dispatch', title: 'Attribution des livreurs', icon: Navigation, description: 'Comment une commande est confiée à un livreur.', planned: ['Attribution automatique ou manuelle', 'Rayon de recherche autour du restaurant', 'Temps laissé au livreur pour accepter', 'Nombre de commandes simultanées par livreur'], needs: 'Un moteur d’attribution configurable côté serveur.' }),
  page({ id: 'settings-hours', title: 'Horaires de la plateforme', icon: CalendarClock, description: 'Heures de service, jours fermés et mode occupé.', planned: ['Heures d’ouverture par jour', 'Jours fériés et fermetures exceptionnelles', 'Mode « occupé » : suspendre les nouvelles commandes', 'Message affiché aux clients quand c’est fermé'], needs: 'Un calendrier de service côté serveur et dans les applications.' }),
  page({ id: 'settings-payments', title: 'Moyens de paiement', icon: CreditCard, description: 'Wave, Orange Money, espèces et leurs clés d’accès.', planned: ['Activer ou désactiver Wave, Orange Money et le paiement en espèces', 'Clés d’accès de chaque opérateur', 'Plafond de paiement en espèces', 'Frais de transaction par moyen de paiement'], needs: 'Aujourd’hui seul Razorpay est branché : il faut intégrer les opérateurs sénégalais.' }),
  page({ id: 'settings-refunds', title: 'Politique de remboursement', icon: RotateCcw, description: 'Quand et comment un client est remboursé.', planned: ['Cas de remboursement automatique', 'Délai de remboursement', 'Qui supporte le coût (plateforme, restaurant ou livreur)', 'Montant maximum sans validation'], needs: 'Des règles de remboursement configurables côté serveur.' }),
  page({ id: 'settings-taxes', title: 'Taxes', icon: Receipt, description: 'TVA et taxes appliquées aux commandes et aux commissions.', planned: ['Taux de TVA', 'Prix affichés TTC ou HT', 'Numéro d’identification fiscale', 'Mentions sur les reçus'], needs: 'Un calcul de taxes côté serveur (les frais sont aujourd’hui « tout compris »).' }),
  page({ id: 'settings-onboarding', title: 'Critères de validation', icon: ShieldCheck, description: 'Ce qu’on exige d’un restaurant ou d’un livreur avant de l’approuver.', planned: ['Informations et documents obligatoires pour un restaurant', 'Informations et documents obligatoires pour un livreur', 'Validation automatique si le dossier est complet', 'Motifs de refus proposés'], needs: 'L’envoi de scans de documents dans les applications partenaires, puis leur stockage côté serveur.' }),
  page({ id: 'settings-categories', title: 'Catégories de cuisine', icon: FolderTree, description: 'Les types de cuisine proposés aux restaurants et aux clients.', planned: ['Ajouter, renommer et ordonner les catégories', 'Icône et image de chaque catégorie', 'Catégories mises en avant'], needs: 'Une liste de catégories gérée côté serveur (elle est aujourd’hui libre, saisie par chaque restaurant).' }),
  page({ id: 'settings-vehicles', title: 'Types de véhicules', icon: Car, description: 'Les véhicules acceptés pour les livreurs.', planned: ['Moto, scooter, vélo, à pied', 'Documents requis par véhicule', 'Capacité de chaque type de véhicule'], needs: 'Une liste de véhicules gérée côté serveur.' }),
  page({ id: 'settings-senders', title: 'Expéditeurs des messages', icon: Send, description: 'Nom et adresse d’envoi des SMS, e-mails et WhatsApp.', planned: ['Nom d’expéditeur des SMS', 'Adresse e-mail d’envoi (support@affiafoods.com)', 'Numéro WhatsApp Business', 'Pied de page des e-mails'], needs: 'Un prestataire d’envoi de SMS et d’e-mails configuré côté serveur.' }),
  page({ id: 'settings-languages', title: 'Langues', icon: Languages, description: 'Langues de l’application et des messages.', planned: ['Français par défaut', 'Anglais et wolof', 'Traductions des messages automatiques'], needs: 'La prise en charge de plusieurs langues dans les applications et les messages.' }),
  page({ id: 'settings-integrations', title: 'Intégrations & clés d’accès', icon: KeyRound, description: 'Services externes et clés pour les connecter.', planned: ['Cartes et géolocalisation', 'Envoi de SMS et d’e-mails', 'Clés d’accès pour des outils tiers', 'Adresses de rappel (webhooks)'], needs: 'Une gestion sécurisée des clés côté serveur.' }),
  page({ id: 'settings-maintenance', title: 'Maintenance & versions', icon: Wrench, description: 'Version minimale des applications et mode maintenance.', planned: ['Version minimale exigée pour chaque application', 'Mode maintenance avec message', 'Annonces aux utilisateurs'], needs: 'Un contrôle de version dans les applications mobiles.' }),
  page({ id: 'settings-export', title: 'Export de données', icon: Download, description: 'Télécharger les données de la plateforme.', planned: ['Export des commandes, clients, restaurants et livreurs', 'Export comptable des règlements', 'Demandes de suppression de compte'], needs: 'Des exports générés côté serveur.' }),
] as const;

export const RESTAURANT_SETTINGS_PAGES = [
  page({ id: 'r-settings-account', title: 'Mon compte', icon: UserRound, description: 'Le compte du responsable du restaurant.', planned: ['Nom et téléphone du responsable', 'Changer le mot de passe', 'Se déconnecter'], needs: 'Une connexion web pour les restaurants (aujourd’hui, ils utilisent seulement l’application mobile).' }),
  page({ id: 'r-settings-notifications', title: 'Notifications de commande', icon: BellRing, description: 'Comment le restaurant est prévenu d’une nouvelle commande.', planned: ['Son et alerte à chaque commande', 'Notification par SMS ou WhatsApp', 'Rappel si une commande n’est pas acceptée'], needs: 'Des préférences de notification par restaurant côté serveur.' }),
  page({ id: 'r-settings-security', title: 'Sécurité', icon: Lock, description: 'Mot de passe et appareils connectés.', planned: ['Changer le mot de passe', 'Appareils connectés', 'Déconnexion à distance'], needs: 'Une connexion web pour les restaurants.' }),
  page({ id: 'r-settings-ordering', title: 'Prise de commandes', icon: ShoppingBag, description: 'Temps de préparation et commandes acceptées.', planned: ['Temps de préparation moyen', 'Nombre maximum de commandes en même temps', 'Acceptation automatique des commandes'], needs: 'Des réglages par restaurant côté serveur.' }),
] as const;

export type AdminSettingsTab = (typeof ADMIN_SETTINGS_PAGES)[number]['id'];
export type RestaurantSettingsTab = (typeof RESTAURANT_SETTINGS_PAGES)[number]['id'];

export const soonPageOf = (id: string): SettingsSoonPage | undefined =>
  [...ADMIN_SETTINGS_PAGES, ...RESTAURANT_SETTINGS_PAGES].find((entry) => entry.id === id);

// ───────────────────────── Hub layout ─────────────────────────
export interface HubCard { icon: React.ElementType; title: string; description: string; tab: string }
export interface HubSection { id: string; title: string; cards: HubCard[] }

const fromPage = (id: string): HubCard => {
  const entry = soonPageOf(id)!;
  return { icon: entry.icon, title: entry.title, description: entry.description, tab: entry.id };
};

export const ADMIN_HUB: HubSection[] = [
  { id: 'account', title: 'Mon compte', cards: [
    { icon: UserRound, title: 'Mon compte', description: 'Votre profil, votre rôle et votre session.', tab: 'settings-account' },
    fromPage('settings-security'),
    { icon: UserCog, title: 'Équipe & rôles', description: 'Comptes administrateurs, rôles et permissions.', tab: 'team' },
    { icon: History, title: 'Journal d’activité', description: 'Qui a fait quoi, et quand.', tab: 'audit' },
  ] },
  { id: 'company', title: 'Entreprise', cards: [fromPage('settings-brand'), fromPage('settings-languages')] },
  { id: 'operations', title: 'Opérations', cards: [
    fromPage('settings-orders'), fromPage('settings-dispatch'), fromPage('settings-hours'),
    { icon: MapPinned, title: 'Zones de livraison', description: 'Villes ouvertes, zones et frais de livraison.', tab: 'zones' },
  ] },
  { id: 'finance', title: 'Finances', cards: [
    { icon: Percent, title: 'Frais & commission', description: 'Frais de livraison, commission d’Affia Foods, arrondi et règlements des restaurants.', tab: 'settings-fees' },
    fromPage('settings-payments'), fromPage('settings-refunds'), fromPage('settings-taxes'),
  ] },
  { id: 'partners', title: 'Partenaires', cards: [
    fromPage('settings-onboarding'), fromPage('settings-categories'), fromPage('settings-vehicles'),
    { icon: FileSignature, title: 'Modèle de contrat', description: 'Contrats signés avec les restaurants et livreurs.', tab: 'contracts' },
  ] },
  { id: 'marketing', title: 'Marketing', cards: [
    { icon: Gift, title: 'Fidélité & abonnements', description: 'Pièces Affia Foods et plans de livraison offerte.', tab: 'loyalty' },
  ] },
  { id: 'communication', title: 'Communication', cards: [
    { icon: MessageSquareText, title: 'Modèles de messages', description: 'SMS, e-mails et notifications envoyés automatiquement.', tab: 'templates' },
    { icon: BellRing, title: 'Notifications', description: 'Annonces et messages push aux clients.', tab: 'notifications' },
    fromPage('settings-senders'),
  ] },
  { id: 'legal', title: 'Légal et aide', cards: [
    { icon: FileText, title: 'Documents légaux', description: 'Conditions d’utilisation, confidentialité et remboursements.', tab: 'legal' },
    { icon: BookOpen, title: 'Centre d’aide', description: 'Articles d’aide pour les clients, restaurants et livreurs.', tab: 'help-center' },
  ] },
  { id: 'system', title: 'Système', cards: [
    { icon: Blocks, title: 'Modules', description: 'Activer ou couper chaque fonctionnalité de la plateforme.', tab: 'modules' },
    fromPage('settings-integrations'), fromPage('settings-maintenance'), fromPage('settings-export')] },
];

export const RESTAURANT_HUB: HubSection[] = [
  { id: 'account', title: 'Mon compte', cards: [fromPage('r-settings-account'), fromPage('r-settings-security'), { icon: UserCog, title: 'Équipe', description: 'Accès pour vos employés (caisse, cuisine).', tab: 'r-team' }] },
  { id: 'restaurant', title: 'Mon restaurant', cards: [
    { icon: Store, title: 'Profil du restaurant', description: 'Nom, adresse, position et photos.', tab: 'r-profile' },
    { icon: Clock3, title: 'Horaires & ouverture', description: 'Horaires d’ouverture et fermeture temporaire.', tab: 'r-hours' },
    { icon: UtensilsCrossed, title: 'Menu & plats', description: 'Plats, prix, photos et disponibilité.', tab: 'r-menu' },
  ] },
  { id: 'orders', title: 'Commandes', cards: [fromPage('r-settings-ordering'), fromPage('r-settings-notifications')] },
  { id: 'money', title: 'Ventes', cards: [{ icon: Wallet, title: 'Paiements', description: 'Règlements reçus et à venir.', tab: 'r-payouts' }] },
  { id: 'help', title: 'Aide', cards: [{ icon: LifeBuoy, title: 'Aide & support', description: 'Contacter l’équipe Affia Foods.', tab: 'r-help' }] },
];

