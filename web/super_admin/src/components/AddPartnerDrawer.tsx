import React, { useEffect, useState } from 'react';
import { Bike, Check, Copy, Loader2, RefreshCw, Store } from 'lucide-react';
import { vehicleLabel } from '../lib/tokens';
import { NewPartnerInput, PartnerKind } from '../types';
import { apiService } from '../services/api';
import { copyText, generatePassword } from '../lib/credentials';
import { parseLocationInput } from '../lib/campus';
import { Drawer } from './ui/Drawer';
import { Field } from './ui/Field';
import { useToast } from './ui/Toast';

interface Props {
  open: boolean;
  kind: PartnerKind;
  onClose: () => void;
  /** Called after the account exists, so the lists can refresh. */
  onCreated: () => void;
}

// The server only accepts these English values; the list shows the French label (vehicleLabel).
const VEHICLES = ['Bike', 'Scooter', 'Cycle', 'On foot'];
const NO_PLATE = new Set(['Cycle', 'On foot']);
const CATEGORIES = ['Cuisine sénégalaise', 'Thiéboudienne & plats du jour', 'Grillades & dibi', 'Fataya & beignets', 'Fast-food', 'Shawarma & sandwichs', 'Petit-déjeuner', 'Jus locaux & desserts'];

type Form = Record<'name' | 'phone' | 'password' | 'restaurantName' | 'category' | 'address' | 'location' | 'fssaiNumber' | 'vehicleType' | 'vehicleRegNo' | 'emergencyPhone' | 'upiId', string>;
const EMPTY: Form = { name: '', phone: '', password: '', restaurantName: '', category: '', address: '', location: '', fssaiNumber: '', vehicleType: 'Bike', vehicleRegNo: '', emergencyPhone: '', upiId: '' };

const digits = (v: string) => v.replace(/\D/g, '').slice(-10);
const pinFrom = (text: string): { lat?: number; lng?: number } => { const p = text.trim() ? parseLocationInput(text) : null; return p && p.ok ? { lat: p.lat, lng: p.lng } : {}; };

const validate = (kind: PartnerKind, f: Form): Partial<Record<keyof Form, string>> => {
  const e: Partial<Record<keyof Form, string>> = {};
  if (f.name.trim().length < 2) e.name = kind === 'VENDOR' ? 'Saisissez le nom du propriétaire.' : 'Saisissez le nom du livreur.';
  if (!/^[6-9]\d{9}$/.test(digits(f.phone))) e.phone = 'Saisissez un numéro de mobile valide à 10 chiffres.';
  if (f.password.length < 8) e.password = 'Au moins 8 caractères. Utilisez « Générer » pour un mot de passe solide.';
  if (kind === 'VENDOR') {
    if (f.restaurantName.trim().length < 2) e.restaurantName = 'Saisissez le nom du restaurant.';
    if (f.address.trim().length < 3) e.address = 'Indiquez où se trouve la cuisine.';
    if (f.location.trim()) {
      const parsed = parseLocationInput(f.location);
      if (!parsed.ok) e.location = parsed.message;
    }
    if (f.fssaiNumber.trim() && !/^\d{14}$/.test(f.fssaiNumber.replace(/\s/g, ''))) e.fssaiNumber = 'Le numéro FSSAI comporte 14 chiffres. Laissez vide s’il n’est pas disponible.';
  } else {
    if (!NO_PLATE.has(f.vehicleType) && f.vehicleRegNo.trim().length < 4) e.vehicleRegNo = 'Saisissez la plaque d’immatriculation (laissez une note si elle n’est pas encore connue).';
    if (f.emergencyPhone.trim() && !/^[6-9]\d{9}$/.test(digits(f.emergencyPhone))) e.emergencyPhone = 'Saisissez un numéro valide à 10 chiffres ou laissez vide.';
    if (f.upiId.trim() && !/^[a-zA-Z0-9.\-_]{2,}@[a-zA-Z]{2,}$/.test(f.upiId.trim())) e.upiId = 'Exemple : nom@upi';
  }
  return e;
};

/** Add a restaurant (with its owner login) or a rider. The account is approved immediately and the login details are shown once. */
export const AddPartnerDrawer: React.FC<Props> = ({ open, kind, onClose, onCreated }) => {
  const toast = useToast();
  const [form, setForm] = useState<Form>(EMPTY);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ phone: string; password: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setForm({ ...EMPTY, password: generatePassword() });
      setTouched(false); setError(''); setCreated(null); setCopied(false);
    }
  }, [open, kind]);

  const errors = validate(kind, form);
  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((c) => ({ ...c, [key]: e.target.value }));
  const show = (key: keyof Form) => (touched ? errors[key] : undefined);
  const isVendor = kind === 'VENDOR';

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length > 0) return;
    setSaving(true); setError('');
    const input: NewPartnerInput = {
      role: kind,
      name: form.name.trim(),
      phone: digits(form.phone),
      password: form.password,
      ...(isVendor
        ? { restaurantName: form.restaurantName.trim(), category: form.category.trim() || 'Cuisine locale', address: form.address.trim(), fssaiNumber: form.fssaiNumber.replace(/\s/g, ''), ...pinFrom(form.location) }
        : { vehicleType: form.vehicleType, vehicleRegNo: form.vehicleRegNo.trim(), emergencyPhone: digits(form.emergencyPhone) || '', upiId: form.upiId.trim() }),
    };
    try {
      await apiService.createPartner(input);
      setCreated({ phone: digits(form.phone), password: form.password, name: isVendor ? form.restaurantName.trim() : form.name.trim() });
      onCreated();
      toast.success(isVendor ? 'Restaurant ajouté' : 'Livreur ajouté', 'Le compte est approuvé et prêt pour la connexion.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Le compte n’a pas pu être créé.');
    } finally { setSaving(false); }
  };

  const loginText = created ? `Identifiants AFFIA FOODS${isVendor ? 'Restaurant partenaire' : 'Livreur partenaire'}\nTéléphone : ${created.phone}\nMot de passe : ${created.password}` : '';
  const copyLogin = async () => { setCopied(await copyText(loginText)); };

  return (
    <Drawer
      open={open}
      onClose={() => { if (!saving) onClose(); }}
      title={created ? 'Compte prêt' : isVendor ? 'Ajouter un restaurant' : 'Ajouter un livreur'}
      subtitle={created ? 'Transmettez-leur les identifiants maintenant' : isVendor ? 'Crée le restaurant et le compte de son propriétaire' : 'Crée un compte livreur'}
      icon={isVendor ? Store : Bike}
      footer={created ? (
        <div className="flex gap-3"><button type="button" onClick={onClose} className="k-btn-primary flex-1">Terminé</button></div>
      ) : (
        <div className="flex gap-3">
          <button type="button" onClick={onClose} disabled={saving} className="k-btn-ghost flex-1">Annuler</button>
          <button type="submit" form="add-partner-form" disabled={saving} className="k-btn-primary flex-1" aria-busy={saving}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Enregistrement…</> : isVendor ? 'Ajouter le restaurant' : 'Ajouter le livreur'}
          </button>
        </div>
      )}
    >
      {created ? (
        <div className="space-y-4">
          <div className="rounded-k-md border border-kraveo-g400/30 bg-kraveo-g500/10 p-4 text-sm text-kraveo-ink">
            <p className="font-bold">{created.name} peut se connecter dès maintenant.</p>
            <p className="mt-1 text-kraveo-ink2">Ce mot de passe n’est affiché qu’ici. Envoyez-le, puis demandez-leur de le garder en lieu sûr.</p>
          </div>
          <div className="k-inset space-y-3 p-4 font-mono text-sm">
            <div><p className="k-label font-body">Téléphone</p><p className="text-base font-bold text-kraveo-ink">{created.phone}</p></div>
            <div><p className="k-label font-body">Mot de passe</p><p className="select-all text-base font-bold text-kraveo-ink">{created.password}</p></div>
          </div>
          <button type="button" onClick={copyLogin} className="k-btn-accent w-full">
            {copied ? <><Check className="h-4 w-4" aria-hidden="true" />Copié</> : <><Copy className="h-4 w-4" aria-hidden="true" />Copier les identifiants</>}
          </button>
        </div>
      ) : (
        <form id="add-partner-form" onSubmit={submit} className="space-y-5" noValidate>
          {error && <div role="alert" className="rounded-k-md border border-kraveo-danger/30 bg-kraveo-danger/10 px-4 py-3 text-sm text-kraveo-ink">{error}</div>}
          {isVendor && (
            <>
              <Field label="Nom du restaurant" htmlFor="ap-restaurant" required error={show('restaurantName')}>
                <input id="ap-restaurant" className="k-input" value={form.restaurantName} onChange={set('restaurantName')} placeholder="Nom connu des clients" aria-invalid={Boolean(show('restaurantName'))} />
              </Field>
              <Field label="Cuisine ou catégorie" htmlFor="ap-category">
                <input id="ap-category" className="k-input" list="ap-categories" value={form.category} onChange={set('category')} placeholder="Par exemple : Cuisine sénégalaise" />
                <datalist id="ap-categories">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
              </Field>
              <Field label="Où se trouve la cuisine ?" htmlFor="ap-address" required error={show('address')}>
                <input id="ap-address" className="k-input" value={form.address} onChange={set('address')} placeholder="Quartier ou repère à Thiès (ex. Randoulène, près du marché central)" aria-invalid={Boolean(show('address'))} />
              </Field>
              <Field label="Position (à coller depuis Google Maps, ex. 23.0745, 76.8590)" htmlFor="ap-location" hint="Facultatif pour l’instant. Affiche la cuisine sur la carte en direct et aux livreurs. Vous pourrez l’ajouter plus tard depuis l’onglet Restaurants." error={show('location')}>
                <input id="ap-location" className="k-input" inputMode="decimal" autoComplete="off" value={form.location} onChange={set('location')} placeholder="23.0745, 76.8590" aria-invalid={Boolean(show('location'))} />
              </Field>
              <Field label="Numéro de licence FSSAI" htmlFor="ap-fssai" hint="Facultatif pour l’instant. 14 chiffres." error={show('fssaiNumber')}>
                <input id="ap-fssai" className="k-input" inputMode="numeric" value={form.fssaiNumber} onChange={set('fssaiNumber')} aria-invalid={Boolean(show('fssaiNumber'))} />
              </Field>
            </>
          )}
          <Field label={isVendor ? 'Nom du propriétaire' : 'Nom complet'} htmlFor="ap-name" required error={show('name')}>
            <input id="ap-name" className="k-input" autoComplete="off" value={form.name} onChange={set('name')} aria-invalid={Boolean(show('name'))} />
          </Field>
          <Field label="Numéro de mobile" htmlFor="ap-phone" required error={show('phone')} hint="La connexion se fait avec ce numéro.">
            <input id="ap-phone" className="k-input" inputMode="tel" autoComplete="off" value={form.phone} onChange={set('phone')} placeholder="98765 43210" aria-invalid={Boolean(show('phone'))} />
          </Field>
          <Field label="Mot de passe" htmlFor="ap-password" required error={show('password')}>
            <div className="flex gap-2">
              <input id="ap-password" className="k-input font-mono" autoComplete="off" value={form.password} onChange={set('password')} aria-invalid={Boolean(show('password'))} />
              <button type="button" className="k-btn-ghost shrink-0" onClick={() => setForm((c) => ({ ...c, password: generatePassword() }))} aria-label="Générer un nouveau mot de passe">
                <RefreshCw className="h-4 w-4" aria-hidden="true" />Générer
              </button>
            </div>
          </Field>
          {!isVendor && (
            <>
              <Field label="Véhicule" htmlFor="ap-vehicle" required>
                <select id="ap-vehicle" className="k-select" value={form.vehicleType} onChange={set('vehicleType')}>{VEHICLES.map((v) => <option key={v} value={v}>{vehicleLabel(v)}</option>)}</select>
              </Field>
              {!NO_PLATE.has(form.vehicleType) && (
                <Field label="Plaque d’immatriculation" htmlFor="ap-plate" required error={show('vehicleRegNo')}>
                  <input id="ap-plate" className="k-input uppercase" value={form.vehicleRegNo} onChange={set('vehicleRegNo')} placeholder="TH 1234 A" aria-invalid={Boolean(show('vehicleRegNo'))} />
                </Field>
              )}
              <Field label="Contact d’urgence" htmlFor="ap-emergency" hint="Facultatif. Le numéro d’un proche." error={show('emergencyPhone')}>
                <input id="ap-emergency" className="k-input" inputMode="tel" value={form.emergencyPhone} onChange={set('emergencyPhone')} aria-invalid={Boolean(show('emergencyPhone'))} />
              </Field>
              <Field label="Identifiant UPI pour les versements" htmlFor="ap-upi" hint="Facultatif." error={show('upiId')}>
                <input id="ap-upi" className="k-input" value={form.upiId} onChange={set('upiId')} placeholder="name@upi" aria-invalid={Boolean(show('upiId'))} />
              </Field>
            </>
          )}
        </form>
      )}
    </Drawer>
  );
};
