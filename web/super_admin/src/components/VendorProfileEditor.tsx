import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, Clock3, Copy, FileText, ImageOff, Lock, Loader2, MapPin, MapPinned, Phone, Plus, Store, Timer, Trash2, Undo2, UploadCloud, UtensilsCrossed, Utensils, Navigation, CalendarClock } from 'lucide-react';
import { SavedPin } from '../lib/vendorLocation';
import { Vendor } from '../types';
import { apiService } from '../services/api';
import { CATEGORY_SUGGESTIONS, DAYS, DAY_LABEL, Day, HourRange, MAX_DESCRIPTION, MAX_PICKUP_NOTES, MAX_RANGES_PER_DAY, ProfileForm, VendorProfile, dayText, formFromProfile, hoursFromForm, isDirty, isOpenNow, patchFromForm, validateProfile } from '../lib/vendorProfile';
import { profileProgress } from '../lib/restaurantStats';
import { prepareImage } from '../lib/imageResize';
import { tileGrid } from '../lib/mapTiles';
import { vendorHasRealPin } from '../lib/campus';
import { Field } from './ui/Field';
import { Switch } from './ui/Switch';
import { useToast } from './ui/Toast';
import { VendorLocationEditor } from './VendorLocationEditor';

export type ProfileSection = 'identity' | 'address' | 'contact' | 'prep' | 'hours';

interface Props {
  vendor: Vendor;
  /** Which blocks to show. Default: all. */
  sections?: ProfileSection[];
  /** Called with the saved profile so the lists use it at once. */
  onSaved: (vendorId: string, profile: VendorProfile) => void;
  /** Called after the map position was saved, so the live map and lists use it. */
  onLocationSaved?: (vendorId: string, saved: SavedPin) => void;
  onAuthError?: (error: unknown) => void;
  /** "page" shows the side navigation, "drawer" is the narrow version. */
  layout?: 'page' | 'drawer';
}

const ALL: ProfileSection[] = ['identity', 'address', 'contact', 'prep', 'hours'];
const plain = (error: unknown): string => (error instanceof Error ? error.message : 'Un problème est survenu. Veuillez réessayer.');
const DEFAULT_RANGE: HourRange = { open: '08:00', close: '22:00' };
const PREP_PRESETS: Array<[string, string]> = [['10', '15'], ['15', '25'], ['20', '30'], ['30', '45']];
const SECTION_LABEL: Record<ProfileSection, string> = { identity: 'Présentation', address: 'Adresse & accès', contact: 'Contact', prep: 'Préparation', hours: 'Horaires' };

const profileOf = (v: Vendor): Partial<VendorProfile> => ({ name: v.name, category: v.category, address: v.address, eta: v.eta, pickupNotes: v.pickupNotes, bannerImage: v.bannerImage, logoUrl: v.logoUrl, description: v.description, phone: v.phone, openingHours: v.openingHours });

/** A picture, or a calm placeholder when there is none or it cannot be loaded. */
const Picture: React.FC<{ url: string; alt: string; className: string; contain?: boolean; placeholder: React.ReactNode }> = ({ url, alt, className, contain, placeholder }) => {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const ok = url.trim() && !failed;
  return (
    <div className={`overflow-hidden ${className}`}>
      {ok
        ? <img src={url.trim()} alt={alt} className={`h-full w-full ${contain ? 'object-contain p-2' : 'object-cover'}`} referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        : <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-white/90">{url.trim() ? <><ImageOff className="h-6 w-6" aria-hidden="true" /><span className="text-xs">Image introuvable</span></> : placeholder}</div>}
    </div>
  );
};

type Tone = 'blue' | 'yellow' | 'green' | 'orange' | 'violet';
// One colour per rubric so the page is easy to scan: the icon square and a soft tint on the header carry it.
const BLUE = { square: 'bg-kraveo-g500 text-white', tint: 'from-kraveo-g500/10' };
// One blue for every rubric: the page stays calm and matches the rest of the dashboard.
const TONES: Record<Tone, { square: string; tint: string }> = { blue: BLUE, yellow: BLUE, green: BLUE, orange: BLUE, violet: BLUE };

const Card: React.FC<{ id: string; title: string; description: string; icon: React.ElementType; tone: Tone; aside?: React.ReactNode; children: React.ReactNode }> = ({ id, title, description, icon: Icon, tone, aside, children }) => (
  <section id={id} className="k-card scroll-mt-24 overflow-hidden" aria-label={title}>
    <header className={`flex items-center gap-4 border-b border-kraveo-line bg-gradient-to-r ${TONES[tone].tint} to-transparent px-5 py-4 sm:px-6`}>
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl shadow-k-soft ${TONES[tone].square}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-lg font-bold leading-tight text-kraveo-ink">{title}</h2>
        <p className="text-sm text-kraveo-ink3">{description}</p>
      </div>
      {aside}
    </header>
    <div className="space-y-5 p-5 sm:p-6">{children}</div>
  </section>
);

/** A small map picture around the pin (OpenStreetMap tiles), so the address is something you can see. */
const MapPreview: React.FC<{ lat: number; lng: number }> = ({ lat, lng }) => {
  const { urls, offsetX, offsetY } = tileGrid(lat, lng, 16);
  return (
    <div className="relative h-44 overflow-hidden rounded-k-lg border border-kraveo-line bg-kraveo-surface2" role="img" aria-label="Aperçu de la carte autour du restaurant">
      <div className="absolute left-1/2 top-1/2 grid grid-cols-3" style={{ width: 768, height: 768, transform: `translate(${-offsetX}px, ${-offsetY}px)` }} aria-hidden="true">
        {urls.map((u, i) => <img key={i} src={u} alt="" width={256} height={256} className="block h-64 w-64 max-w-none" loading="lazy" referrerPolicy="no-referrer" draggable={false} />)}
      </div>
      <span className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-full" aria-hidden="true">
        <MapPin className="h-9 w-9 fill-kraveo-g500 text-white drop-shadow-md" strokeWidth={1.6} />
      </span>
      <span className="absolute bottom-1 right-1.5 rounded bg-white/80 px-1.5 py-0.5 text-[9px] text-kraveo-ink2">© OpenStreetMap</span>
    </div>
  );
};

/** One day on a 24 h line: where the restaurant is open at a glance. */
const DayBar: React.FC<{ ranges: HourRange[] }> = ({ ranges }) => {
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return (
    <div className="relative h-3 w-full rounded-full bg-kraveo-line/70" aria-hidden="true">
      {ranges.filter((r) => /^\d\d:\d\d$/.test(r.open) && /^\d\d:\d\d$/.test(r.close) && m(r.close) > m(r.open)).map((r, i) => (
        <span key={i} className="absolute top-0 h-3 rounded-full bg-kraveo-g500" style={{ left: `${(m(r.open) / 1440) * 100}%`, width: `${((m(r.close) - m(r.open)) / 1440) * 100}%` }} />
      ))}
    </div>
  );
};

/** The restaurant's page, like a storefront: cover and logo on top, then presentation, address, contact, preparation time and opening hours. */
export const VendorProfileEditor: React.FC<Props> = ({ vendor, sections = ALL, onSaved, onLocationSaved, onAuthError, layout = 'page' }) => {
  const toast = useToast();
  const base = useMemo(() => formFromProfile(profileOf(vendor)), [vendor]);
  const [form, setForm] = useState<ProfileForm>(base);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState<'logo' | 'banner' | null>(null);
  const [dragging, setDragging] = useState<'logo' | 'banner' | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  useEffect(() => { setForm(base); setTouched(false); setError(''); }, [base]);

  const errors = validateProfile(form);
  const dirty = isDirty(form, base);
  const show = (s: ProfileSection) => sections.includes(s);
  const set = <K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) => { setForm((f) => ({ ...f, [key]: value })); setError(''); };
  const err = (key: keyof typeof errors) => (touched ? errors[key] : undefined);

  const setRanges = (day: Day, ranges: HourRange[]) => set('hours', { ...form.hours, [day]: ranges });
  const updateRange = (day: Day, index: number, field: keyof HourRange, value: string) => setRanges(day, form.hours[day].map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  const copyMondayToAll = () => set('hours', Object.fromEntries(DAYS.map((d) => [d, form.hours.mon.map((r) => ({ ...r }))])) as ProfileForm['hours']);

  const upload = async (kind: 'logo' | 'banner', file: File | undefined | null) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { toast.error('Image non acceptée', 'Choisissez une image PNG, JPEG ou WebP.'); return; }
    setUploading(kind);
    try {
      const ready = await prepareImage(file, kind);
      if (ready.size > 3 * 1024 * 1024) { toast.error('Image trop lourde', 'Choisissez une image de moins de 3 Mo.'); return; }
      const url = await apiService.uploadVendorImage(vendor.id, kind, ready);
      set(kind === 'logo' ? 'logoUrl' : 'bannerImage', url);
      toast.success(kind === 'logo' ? 'Logo envoyé' : 'Photo envoyée', 'Cliquez sur Enregistrer pour l’appliquer.');
    } catch (e) {
      onAuthError?.(e);
      toast.error('Envoi impossible', plain(e));
    } finally { setUploading(null); }
  };
  const dropOn = (kind: 'logo' | 'banner') => ({
    onDragOver: (e: React.DragEvent) => { e.preventDefault(); setDragging(kind); },
    onDragLeave: () => setDragging(null),
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDragging(null); void upload(kind, e.dataTransfer.files?.[0]); },
  });

  const save = async () => {
    setTouched(true);
    if (Object.keys(errors).length > 0) { setError('Corrigez les champs en rouge avant d’enregistrer.'); return; }
    setSaving(true); setError('');
    try {
      const saved = await apiService.updateVendorProfile(vendor.id, patchFromForm(form, base));
      onSaved(vendor.id, saved);
      toast.success('Fiche enregistrée', `${form.name.trim() || vendor.name} est à jour.`);
    } catch (e) {
      onAuthError?.(e);
      setError(plain(e));
    } finally { setSaving(false); }
  };

  const openNow = isOpenNow(hoursFromForm(form.hours));
  const progress = profileProgress({ ...vendor, logoUrl: form.logoUrl.trim() || null, description: form.description, phone: form.phone, openingHours: hoursFromForm(form.hours) });
  const etaText = form.prepMin && form.prepMax ? `${Number(form.prepMin)}-${Number(form.prepMax)} min` : null;

  const hero = (
    <section aria-label="Aperçu de la boutique" className="k-card overflow-hidden">
      {/* Cover with the logo and the name laid over it, like a storefront */}
      <div className={`relative ${layout === 'drawer' ? 'h-44' : 'h-52 sm:h-64'} bg-gradient-to-br from-kraveo-g800 via-kraveo-g700 to-kraveo-g500 ${dragging === 'banner' ? 'ring-4 ring-inset ring-kraveo-yellow' : ''}`} {...dropOn('banner')}>
        <Picture url={form.bannerImage} alt="Photo de couverture" className="absolute inset-0 h-full w-full" placeholder={<><UtensilsCrossed className="h-8 w-8" aria-hidden="true" /><span className="text-sm font-semibold">Ajoutez une photo de couverture</span></>} />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/10" aria-hidden="true" />
        {uploading === 'banner' && <div className="absolute inset-0 grid place-items-center bg-black/40 text-white" role="status"><span className="inline-flex items-center gap-2 text-sm font-semibold"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />Envoi en cours…</span></div>}
        {dragging === 'banner' && <div className="absolute inset-0 grid place-items-center bg-kraveo-g800/70 text-white"><span className="inline-flex items-center gap-2 text-base font-bold"><UploadCloud className="h-6 w-6" aria-hidden="true" />Déposez l’image ici</span></div>}
        <button type="button" onClick={() => bannerInput.current?.click()} disabled={uploading !== null} className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-full bg-white/95 px-4 py-2 text-sm font-semibold text-kraveo-ink shadow-k-lift transition-colors hover:bg-white disabled:opacity-60" aria-label="Changer la photo de couverture">
          <Camera className="h-4 w-4" aria-hidden="true" />Changer la couverture
        </button>
        <input ref={bannerInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label="Choisir la photo de couverture" onChange={(e) => { void upload('banner', e.target.files?.[0]); e.target.value = ''; }} />

        <div className="absolute inset-x-0 bottom-0 flex items-end gap-4 p-4 sm:p-5">
          <div className={`group relative h-20 w-20 shrink-0 rounded-2xl border-2 border-white bg-white shadow-k-lift sm:h-24 sm:w-24 ${dragging === 'logo' ? 'ring-4 ring-kraveo-yellow' : ''}`} {...dropOn('logo')}>
            <Picture url={form.logoUrl} alt="Logo" className="h-full w-full rounded-[14px] bg-kraveo-surface" contain placeholder={<Store className="h-8 w-8 text-kraveo-ink3" aria-hidden="true" />} />
            {uploading === 'logo' && <div className="absolute inset-0 grid place-items-center rounded-[14px] bg-black/40 text-white" role="status"><Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /><span className="sr-only">Envoi en cours</span></div>}
            <button type="button" onClick={() => logoInput.current?.click()} disabled={uploading !== null} className="absolute -bottom-2 -right-2 grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-kraveo-g500 text-white shadow-k-lift transition-colors hover:bg-kraveo-g600 disabled:opacity-60" aria-label="Changer le logo" title="Changer le logo"><Camera className="h-4 w-4" aria-hidden="true" /></button>
            <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" tabIndex={-1} aria-label="Choisir le logo" onChange={(e) => { void upload('logo', e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          <div className="min-w-0 flex-1 text-white">
            <h2 className="truncate font-display text-xl font-extrabold tracking-tight drop-shadow sm:text-3xl">{form.name.trim() || vendor.name}</h2>
            <p className="truncate text-sm text-white/85">{form.category.trim() || 'Type de cuisine non renseigné'} · {form.address.trim() || 'Adresse non renseignée'}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-5 py-3.5 text-xs font-bold sm:px-6">
        {openNow === null ? <span className="rounded-full bg-kraveo-surface2 px-2.5 py-1 text-kraveo-ink3">Horaires non renseignés</span> : openNow ? <span className="rounded-full bg-kraveo-g500/10 px-2.5 py-1 text-kraveo-g700">Ouvert maintenant</span> : <span className="rounded-full bg-kraveo-danger/10 px-2.5 py-1 text-kraveo-danger">Fermé maintenant</span>}
        {etaText && <span className="inline-flex items-center gap-1 rounded-full bg-kraveo-surface2 px-2.5 py-1 text-kraveo-ink2"><Clock3 className="h-3 w-3" aria-hidden="true" />{etaText}</span>}
        <span className="rounded-full bg-kraveo-g500/10 px-2.5 py-1 text-kraveo-g700">Fiche complète à {progress.percent} %</span>
        <span className="ml-auto hidden font-medium text-kraveo-ink3 md:inline">Glissez une image sur la couverture ou le logo · PNG, JPEG ou WebP, 3 Mo max</span>
      </div>
    </section>
  );

  const present = sections.filter((s) => s !== 'identity' || true);
  const tick: Record<ProfileSection, boolean> = {
    identity: Boolean(form.name.trim() && form.category.trim() && form.description.trim()),
    address: Boolean(form.address.trim()),
    contact: Boolean(form.phone.trim()),
    prep: Boolean(etaText),
    hours: Object.keys(hoursFromForm(form.hours)).length > 0,
  };
  const nav = layout === 'page' && present.length > 1 && (
    <nav aria-label="Rubriques de la fiche" className="hidden xl:block xl:sticky xl:top-24 xl:self-start">
      <ul className="space-y-1">
        {present.map((s) => (
          <li key={s}>
            <button type="button" onClick={() => document.getElementById(`vp-${s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="flex w-full items-center gap-2.5 rounded-k-sm px-3 py-2 text-left text-sm font-semibold text-kraveo-ink2 transition-colors hover:bg-kraveo-surface2 hover:text-kraveo-ink">
              <span className={`grid h-5 w-5 place-items-center rounded-full border ${tick[s] ? 'border-kraveo-g500 bg-kraveo-g500 text-white' : 'border-kraveo-line text-transparent'}`}><Check className="h-3 w-3" aria-hidden="true" /></span>
              {SECTION_LABEL[s]}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );

  return (
    <div className="space-y-5">
      {show('identity') && hero}

      <div className={nav ? 'grid grid-cols-1 gap-6 xl:grid-cols-[190px_minmax(0,1fr)]' : ''}>
        {nav}
        <div className="space-y-5">
          {show('identity') && (
            <Card id="vp-identity" icon={Utensils} tone="blue" title="Présentation" description="Ce que les clients lisent en ouvrant votre page.">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Nom du restaurant" htmlFor="vp-name" required error={err('name')}>
                  <div className="relative"><Store className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kraveo-ink3" aria-hidden="true" /><input id="vp-name" className="k-input !pl-10" value={form.name} onChange={(e) => set('name', e.target.value)} aria-invalid={Boolean(err('name'))} aria-describedby="vp-name-msg" maxLength={60} /></div>
                </Field>
                <Field label="Type de cuisine" htmlFor="vp-category" required error={err('category')}>
                  <div className="relative"><UtensilsCrossed className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kraveo-ink3" aria-hidden="true" /><input id="vp-category" className="k-input !pl-10" value={form.category} onChange={(e) => set('category', e.target.value)} aria-invalid={Boolean(err('category'))} aria-describedby="vp-category-msg" maxLength={60} placeholder="Sénégalais, Grillades…" /></div>
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Types de cuisine proposés">
                <span className="text-xs text-kraveo-ink3">Suggestions :</span>
                {CATEGORY_SUGGESTIONS.slice(0, 6).map((c) => <button key={c} type="button" className="k-chip" aria-pressed={form.category.trim() === c} onClick={() => set('category', c)}>{c}</button>)}
              </div>
              <Field label="Description" htmlFor="vp-description" error={err('description')}>
                <div className="relative">
                  <textarea id="vp-description" rows={4} className="k-input !min-h-[120px] py-3 pb-8" value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Vos spécialités, ce qui vous rend unique…" aria-invalid={Boolean(err('description'))} aria-describedby="vp-description-msg" />
                  <span className={`pointer-events-none absolute bottom-2.5 right-3.5 text-xs tabular-nums ${form.description.trim().length > MAX_DESCRIPTION ? 'font-bold text-kraveo-danger' : 'text-kraveo-ink3'}`}>{form.description.trim().length} / {MAX_DESCRIPTION}</span>
                </div>
              </Field>
            </Card>
          )}

          {show('address') && (
            <Card id="vp-address" icon={MapPinned} tone="yellow" title="Adresse & accès" description="Où le trouver, et comment le livreur entre.">
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div className="space-y-4">
                  <Field label="Adresse" htmlFor="vp-address-input" required error={err('address')} hint="Rue, quartier, ville : « Rue 10, Randoulène, Thiès ».">
                    <div className="relative"><MapPin className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-kraveo-ink3" aria-hidden="true" /><input id="vp-address-input" className="k-input !pl-10" value={form.address} onChange={(e) => set('address', e.target.value)} aria-invalid={Boolean(err('address'))} aria-describedby="vp-address-input-msg" maxLength={140} /></div>
                  </Field>
                  <Field label="Consignes pour le livreur" htmlFor="vp-pickup" error={err('pickupNotes')} hint="Facultatif : « porte bleue », « 2e étage », « sonner deux fois »…">
                    <div className="relative">
                      <Navigation className="pointer-events-none absolute left-3.5 top-3.5 h-4 w-4 text-kraveo-ink3" aria-hidden="true" />
                      <textarea id="vp-pickup" rows={3} className="k-input !pl-10 py-3" value={form.pickupNotes} onChange={(e) => set('pickupNotes', e.target.value)} aria-invalid={Boolean(err('pickupNotes'))} aria-describedby="vp-pickup-msg" />
                    </div>
                  </Field>
                </div>
                <div className="space-y-2">
                  {vendorHasRealPin(vendor) && typeof vendor.lat === 'number' && typeof vendor.lng === 'number'
                    ? <MapPreview lat={vendor.lat} lng={vendor.lng} />
                    : <div className="grid h-44 place-items-center rounded-k-lg border border-dashed border-kraveo-line bg-kraveo-night/60 px-4 text-center text-sm text-kraveo-ink3"><span><MapPin className="mx-auto mb-1 h-6 w-6" aria-hidden="true" />Pas encore de position sur la carte.<br />Les livreurs en ont besoin pour venir.</span></div>}
                  <VendorLocationEditor id={vendor.id} name={vendor.name} pin={vendor} heading="Position GPS" onSaved={(id, saved) => onLocationSaved?.(id, saved)} />
                </div>
              </div>
            </Card>
          )}

          {show('contact') && (
            <Card id="vp-contact" icon={Phone} tone="green" title="Contact" description="Pour que l’équipe puisse vous joindre."
              aside={<span className="hidden items-center gap-1.5 rounded-full bg-kraveo-surface px-3 py-1.5 text-xs font-semibold text-kraveo-ink2 shadow-k-soft sm:inline-flex"><Lock className="h-3.5 w-3.5" aria-hidden="true" />Jamais montré aux clients</span>}>
              <Field label="Téléphone du restaurant" htmlFor="vp-phone" error={err('phone')} hint="Mobile sénégalais, par exemple 77 123 45 67.">
                <div className="relative max-w-md">
                  <Phone className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-kraveo-g500" aria-hidden="true" />
                  <input id="vp-phone" className="k-input !min-h-[52px] !pl-12 font-display text-lg font-bold tracking-wide" inputMode="tel" placeholder="77 123 45 67" value={form.phone} onChange={(e) => set('phone', e.target.value)} aria-invalid={Boolean(err('phone'))} aria-describedby="vp-phone-msg" />
                </div>
              </Field>
            </Card>
          )}

          {show('prep') && (
            <Card id="vp-prep" icon={Timer} tone="orange" title="Temps de préparation" description="Le délai annoncé avant que la commande soit prête."
              aside={etaText ? <span className="inline-flex items-center gap-1.5 rounded-full bg-kraveo-surface px-3 py-1.5 text-sm font-bold text-kraveo-ink shadow-k-soft"><Clock3 className="h-4 w-4 text-kraveo-g600" aria-hidden="true" />{etaText}</span> : undefined}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="group" aria-label="Temps courants">
                {PREP_PRESETS.map(([lo, hi]) => {
                  const on = form.prepMin === lo && form.prepMax === hi;
                  return (
                    <button key={lo} type="button" aria-pressed={on} onClick={() => setForm((f) => ({ ...f, prepMin: lo, prepMax: hi }))}
                      className={`rounded-k-lg border-2 px-3 py-4 text-center transition-all ${on ? 'border-kraveo-g500 bg-kraveo-g500/10 shadow-k-soft' : 'border-kraveo-line bg-kraveo-surface hover:-translate-y-0.5 hover:border-kraveo-g400/60'}`}>
                      <span className="block font-display text-2xl font-extrabold tabular-nums text-kraveo-ink">{lo}–{hi}</span>
                      <span className="text-xs font-semibold text-kraveo-ink3">minutes</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-end gap-3 rounded-k-lg bg-kraveo-night/70 px-4 py-3">
                <span className="pb-2.5 text-sm font-semibold text-kraveo-ink2">Autre durée :</span>
                <Field label="De" htmlFor="vp-prep-min" error={err('prep')}>
                  <div className="flex items-center gap-2"><input id="vp-prep-min" type="number" min={1} max={180} inputMode="numeric" className="k-input !w-20 text-center" value={form.prepMin} onChange={(e) => set('prepMin', e.target.value)} aria-invalid={Boolean(err('prep'))} aria-describedby="vp-prep-min-msg" /></div>
                </Field>
                <Field label="À" htmlFor="vp-prep-max">
                  <div className="flex items-center gap-2"><input id="vp-prep-max" type="number" min={1} max={180} inputMode="numeric" className="k-input !w-20 text-center" value={form.prepMax} onChange={(e) => set('prepMax', e.target.value)} aria-invalid={Boolean(err('prep'))} /><span className="text-sm text-kraveo-ink3">min</span></div>
                </Field>
              </div>
            </Card>
          )}

          {show('hours') && (
            <Card id="vp-hours" icon={CalendarClock} tone="violet" title="Horaires d’ouverture" description="Heure de Thiès. Midi et soir : ajoutez deux plages."
              aside={<button type="button" className="k-btn-ghost !min-h-[36px] bg-kraveo-surface !px-3 text-xs" onClick={copyMondayToAll} disabled={form.hours.mon.length === 0}><Copy className="h-3.5 w-3.5" aria-hidden="true" />Copier le lundi partout</button>}>
              <div className="hidden grid-cols-[160px_1fr] items-center gap-4 px-1 text-[10px] font-bold text-kraveo-ink3 md:grid" aria-hidden="true">
                <span />
                <div className="relative h-3"><span className="absolute left-0">0h</span><span className="absolute left-1/4 -translate-x-1/2">6h</span><span className="absolute left-1/2 -translate-x-1/2">12h</span><span className="absolute left-3/4 -translate-x-1/2">18h</span><span className="absolute right-0">24h</span></div>
              </div>
              <ul className="space-y-2.5">
                {DAYS.map((day) => {
                  const ranges = form.hours[day];
                  const open = ranges.length > 0;
                  return (
                    <li key={day} className={`rounded-k-lg border px-4 py-3 transition-colors ${open ? 'border-kraveo-line bg-kraveo-surface' : 'border-transparent bg-kraveo-night/60'}`}>
                      <div className="grid grid-cols-1 items-center gap-x-4 gap-y-3 md:grid-cols-[160px_1fr]">
                        <div className="flex items-center gap-3">
                          <Switch checked={open} onChange={() => setRanges(day, open ? [] : [{ ...DEFAULT_RANGE }])} label={`${DAY_LABEL[day]} : ouvert`} />
                          <span className={`text-sm font-bold ${open ? 'text-kraveo-ink' : 'text-kraveo-ink3'}`}>{DAY_LABEL[day]}</span>
                        </div>
                        {open ? <DayBar ranges={ranges} /> : <p className="text-sm text-kraveo-ink3">Fermé toute la journée</p>}
                      </div>
                      {open && (
                        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 md:pl-[176px]">
                          {ranges.map((r, i) => (
                            <div key={i} className="inline-flex items-center gap-2 rounded-full bg-kraveo-night px-2 py-1.5">
                              <input type="time" className="k-input !min-h-[34px] !w-[104px] !rounded-full !py-0 text-center text-sm" value={r.open} onChange={(e) => updateRange(day, i, 'open', e.target.value)} aria-label={`${DAY_LABEL[day]} : ouverture, plage ${i + 1}`} />
                              <span className="text-kraveo-ink3" aria-hidden="true">→</span>
                              <input type="time" className="k-input !min-h-[34px] !w-[104px] !rounded-full !py-0 text-center text-sm" value={r.close} onChange={(e) => updateRange(day, i, 'close', e.target.value)} aria-label={`${DAY_LABEL[day]} : fermeture, plage ${i + 1}`} />
                              <button type="button" className="grid h-7 w-7 place-items-center rounded-full text-kraveo-ink3 transition-colors hover:bg-kraveo-danger/10 hover:text-kraveo-danger" title="Supprimer cette plage" aria-label={`${DAY_LABEL[day]} : supprimer la plage ${i + 1}`} onClick={() => setRanges(day, ranges.filter((_, n) => n !== i))}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
                            </div>
                          ))}
                          {ranges.length < MAX_RANGES_PER_DAY && (
                            <button type="button" className="inline-flex items-center gap-1 text-xs font-bold text-kraveo-g600 hover:underline" onClick={() => setRanges(day, [...ranges, { open: '18:00', close: '23:00' }])}><Plus className="h-3.5 w-3.5" aria-hidden="true" />Ajouter une plage</button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {err('hours') && <p role="alert" className="text-sm font-semibold text-kraveo-danger">{err('hours')}</p>}
            </Card>
          )}
        </div>
      </div>

      <div className="sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-3 rounded-k-lg border border-kraveo-line bg-kraveo-surface/95 px-4 py-3 shadow-k-lift backdrop-blur">
        <p className={`text-sm ${error ? 'font-semibold text-kraveo-danger' : 'text-kraveo-ink3'}`} role={error ? 'alert' : 'status'}>{error || (dirty ? 'Modifications non enregistrées.' : 'Tout est enregistré.')}</p>
        <div className="flex items-center gap-2">
          <button type="button" className="k-btn-ghost" onClick={() => { setForm(base); setTouched(false); setError(''); }} disabled={!dirty || saving}><Undo2 className="h-4 w-4" aria-hidden="true" />Annuler</button>
          <button type="button" className="k-btn-primary" onClick={save} disabled={!dirty || saving || uploading !== null} aria-busy={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}Enregistrer
          </button>
        </div>
      </div>
    </div>
  );
};
