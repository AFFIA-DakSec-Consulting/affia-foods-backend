// Is a new partner's file ready to be validated? Pure helpers (no React).
// The app does not upload document scans yet: the check is on the information each partner must give.
import { Application } from '../types';
import { vendorHasRealPin } from './campus';

export interface DossierItem { key: string; label: string; ok: boolean; hint: string }
export interface Dossier { items: DossierItem[]; missing: DossierItem[]; complete: boolean; done: number; total: number }

const filled = (value?: string | null): boolean => Boolean(value && value.trim() && value.trim() !== 'Non renseignée');

export const dossierOf = (app: Application): Dossier => {
  const items: DossierItem[] = app.kind === 'VENDOR'
    ? [
      { key: 'phone', label: 'Téléphone', ok: filled(app.phone), hint: 'Pour joindre le responsable' },
      { key: 'fssai', label: 'Licence alimentaire (FSSAI)', ok: filled(app.vendor?.fssaiNumber), hint: 'Numéro de licence à vérifier' },
      { key: 'address', label: 'Adresse du restaurant', ok: filled(app.vendor?.address), hint: 'Adresse écrite' },
      { key: 'pin', label: 'Position sur la carte', ok: app.vendor ? vendorHasRealPin(app.vendor) : false, hint: 'Sans position, les livreurs ne peuvent pas s’y rendre' },
      { key: 'category', label: 'Type de cuisine', ok: filled(app.vendor?.category), hint: 'Catégorie affichée aux clients' },
    ]
    : [
      { key: 'phone', label: 'Téléphone', ok: filled(app.phone), hint: 'Pour joindre le livreur' },
      { key: 'vehicle', label: 'Immatriculation du véhicule', ok: filled(app.driver?.vehicleRegNo), hint: 'Plaque du véhicule' },
      { key: 'emergency', label: 'Contact d’urgence', ok: filled(app.driver?.emergencyPhone), hint: 'Numéro d’une personne proche' },
      { key: 'payout', label: 'Compte de versement', ok: filled(app.driver?.upiId), hint: 'Pour payer les courses' },
    ];
  const missing = items.filter((item) => !item.ok);
  return { items, missing, complete: missing.length === 0, done: items.length - missing.length, total: items.length };
};
