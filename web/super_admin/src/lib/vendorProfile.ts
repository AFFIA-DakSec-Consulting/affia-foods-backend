// Restaurant public profile (Docs/24): form <-> API conversion and checks. Pure, React-free.

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];
export const DAY_LABEL: Record<Day, string> = { mon: 'Lundi', tue: 'Mardi', wed: 'Mercredi', thu: 'Jeudi', fri: 'Vendredi', sat: 'Samedi', sun: 'Dimanche' };
export const MAX_DESCRIPTION = 300;
export const MAX_PICKUP_NOTES = 200;
export const MAX_PREP_MINUTES = 180;
export const CATEGORY_SUGGESTIONS = ['Sénégalais', 'Grillades', 'Fast-food', 'Poulet & frites', 'Pizzas', 'Libanais', 'Asiatique', 'Pâtisserie & desserts', 'Jus & boissons', 'Petit-déjeuner'];
export const MAX_RANGES_PER_DAY = 3;

export interface HourRange { open: string; close: string }
export type OpeningHours = Partial<Record<Day, HourRange[]>>;

export interface VendorProfile {
  name?: string;
  category?: string;
  address?: string;
  /** "20-25 min": the preparation time customers see. */
  eta?: string | null;
  /** What a rider should know to find or enter the restaurant. */
  pickupNotes?: string | null;
  bannerImage: string;
  logoUrl: string | null;
  description: string | null;
  phone: string | null;
  openingHours: OpeningHours | null;
}

/** What the editor edits. Empty text = not filled in. `hours[day]` empty = closed that day. */
export interface ProfileForm {
  name: string;
  category: string;
  address: string;
  /** Preparation time in minutes, as typed (empty = not set). */
  prepMin: string;
  prepMax: string;
  pickupNotes: string;
  logoUrl: string;
  bannerImage: string;
  description: string;
  phone: string;
  hours: Record<Day, HourRange[]>;
}

const emptyHours = (): Record<Day, HourRange[]> => ({ mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] });

export const formFromProfile = (p: Partial<VendorProfile>): ProfileForm => {
  const hours = emptyHours();
  for (const day of DAYS) hours[day] = (p.openingHours?.[day] ?? []).map((r) => ({ ...r }));
  const eta = /^(\d{1,3})-(\d{1,3}) min$/.exec(p.eta ?? '');
  return { name: p.name ?? '', category: p.category ?? '', address: p.address ?? '', prepMin: eta?.[1] ?? '', prepMax: eta?.[2] ?? '', pickupNotes: p.pickupNotes ?? '', logoUrl: p.logoUrl ?? '', bannerImage: p.bannerImage ?? '', description: p.description ?? '', phone: p.phone ?? '', hours };
};

const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const sortedRanges = (ranges: HourRange[]) => [...ranges].sort((a, b) => toMinutes(a.open) - toMinutes(b.open));

/** The API shape of the hours. Closed days are left out. */
export const hoursFromForm = (hours: Record<Day, HourRange[]>): OpeningHours => {
  const out: OpeningHours = {};
  for (const day of DAYS) if (hours[day].length) out[day] = sortedRanges(hours[day]);
  return out;
};

const sameHours = (a: Record<Day, HourRange[]>, b: Record<Day, HourRange[]>) => JSON.stringify(hoursFromForm(a)) === JSON.stringify(hoursFromForm(b));
export const isDirty = (a: ProfileForm, b: ProfileForm): boolean =>
  a.name.trim() !== b.name.trim() || a.category.trim() !== b.category.trim() || a.address.trim() !== b.address.trim() || a.prepMin.trim() !== b.prepMin.trim() || a.prepMax.trim() !== b.prepMax.trim() || a.pickupNotes.trim() !== b.pickupNotes.trim() ||
  a.logoUrl.trim() !== b.logoUrl.trim() || a.bannerImage.trim() !== b.bannerImage.trim() || a.description.trim() !== b.description.trim() || a.phone.trim() !== b.phone.trim() || !sameHours(a.hours, b.hours);

export type ProfileErrors = Partial<Record<'name' | 'category' | 'address' | 'prep' | 'pickupNotes' | 'logoUrl' | 'bannerImage' | 'description' | 'phone' | 'hours', string>>;

const urlProblem = (value: string, required: boolean): string | undefined => {
  const v = value.trim();
  if (!v) return required ? 'Indiquez le lien de l’image.' : undefined;
  if (v.length > 500) return 'Le lien est trop long (500 caractères au maximum).';
  try {
    const url = new URL(v);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || /\s/.test(v)) return 'Le lien doit commencer par https://.';
  } catch { return 'Ce lien n’est pas une adresse web valide.'; }
  return undefined;
};

/** Same rules as the server (Docs/24), so the admin sees the problem before saving. */
export const validateProfile = (form: ProfileForm): ProfileErrors => {
  const errors: ProfileErrors = {};
  if (form.name.trim().length < 2) errors.name = 'Indiquez le nom du restaurant (2 lettres au minimum).';
  else if (form.name.trim().length > 60) errors.name = 'Le nom est trop long (60 caractères au maximum).';
  if (form.category.trim().length < 2) errors.category = 'Choisissez ou écrivez un type de cuisine.';
  else if (form.category.trim().length > 60) errors.category = 'Le type de cuisine est trop long (60 caractères au maximum).';
  if (form.address.trim().length < 3) errors.address = 'Indiquez l’adresse du restaurant.';
  else if (form.address.trim().length > 140) errors.address = 'L’adresse est trop longue (140 caractères au maximum).';
  if (form.pickupNotes.trim().length > MAX_PICKUP_NOTES) errors.pickupNotes = `Les consignes sont trop longues (${MAX_PICKUP_NOTES} caractères au maximum).`;
  if (form.prepMin.trim() || form.prepMax.trim()) {
    const lo = Number(form.prepMin); const hi = Number(form.prepMax);
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi > MAX_PREP_MINUTES) errors.prep = `Indiquez deux nombres de minutes (de 1 à ${MAX_PREP_MINUTES}).`;
    else if (lo >= hi) errors.prep = 'Le premier nombre doit être plus petit que le second.';
  }
  const logo = urlProblem(form.logoUrl, false); if (logo) errors.logoUrl = logo;
  const banner = urlProblem(form.bannerImage, true); if (banner) errors.bannerImage = banner;
  if (form.description.trim().length > MAX_DESCRIPTION) errors.description = `La description est trop longue (${MAX_DESCRIPTION} caractères au maximum).`;
  const digits = form.phone.replace(/\D/g, '');
  const national = digits.startsWith('00221') ? digits.slice(5) : digits.startsWith('221') && digits.length === 12 ? digits.slice(3) : digits;
  if (form.phone.trim() && !/^7[05678]\d{7}$/.test(national)) errors.phone = 'Entrez un mobile sénégalais, par exemple 77 123 45 67.';
  for (const day of DAYS) {
    const ranges = form.hours[day];
    if (ranges.length > MAX_RANGES_PER_DAY) { errors.hours = `${DAY_LABEL[day]} : ${MAX_RANGES_PER_DAY} plages au maximum.`; break; }
    if (ranges.some((r) => !TIME_RE.test(r.open) || !TIME_RE.test(r.close))) { errors.hours = `${DAY_LABEL[day]} : indiquez l’heure d’ouverture et de fermeture.`; break; }
    if (ranges.some((r) => toMinutes(r.open) >= toMinutes(r.close))) { errors.hours = `${DAY_LABEL[day]} : l’ouverture doit être avant la fermeture.`; break; }
    const sorted = sortedRanges(ranges);
    if (sorted.some((r, i) => i > 0 && toMinutes(r.open) < toMinutes(sorted[i - 1].close))) { errors.hours = `${DAY_LABEL[day]} : les plages se chevauchent.`; break; }
  }
  return errors;
};

/** Only what changed, in the API shape (partial update). */
export const patchFromForm = (form: ProfileForm, base: ProfileForm): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  if (form.name.trim() !== base.name.trim()) patch.name = form.name.trim();
  if (form.category.trim() !== base.category.trim()) patch.category = form.category.trim();
  if (form.address.trim() !== base.address.trim()) patch.address = form.address.trim();
  if ((form.prepMin.trim() !== base.prepMin.trim() || form.prepMax.trim() !== base.prepMax.trim()) && form.prepMin.trim() && form.prepMax.trim()) patch.eta = `${Number(form.prepMin)}-${Number(form.prepMax)} min`;
  if (form.pickupNotes.trim() !== base.pickupNotes.trim()) patch.pickupNotes = form.pickupNotes.trim() || null;
  if (form.logoUrl.trim() !== base.logoUrl.trim()) patch.logoUrl = form.logoUrl.trim() || null;
  if (form.bannerImage.trim() !== base.bannerImage.trim()) patch.bannerImage = form.bannerImage.trim();
  if (form.description.trim() !== base.description.trim()) patch.description = form.description.trim() || null;
  if (form.phone.trim() !== base.phone.trim()) patch.phone = form.phone.trim() || null;
  if (!sameHours(form.hours, base.hours)) patch.openingHours = hoursFromForm(form.hours);
  return patch;
};

/** Is the restaurant inside its opening hours now? Thiès is UTC+0 (Africa/Dakar). null = no hours set. */
export const isOpenNow = (hours: OpeningHours | null | undefined, now: number = Date.now()): boolean | null => {
  if (!hours || Object.keys(hours).length === 0) return null;
  const date = new Date(now);
  const day = DAYS[(date.getUTCDay() + 6) % 7];
  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes();
  return (hours[day] ?? []).some((r) => minutes >= toMinutes(r.open) && minutes < toMinutes(r.close));
};

/** "08:00 – 14:00, 18:00 – 23:00" or "Fermé". */
export const dayText = (ranges: HourRange[] | undefined): string => (ranges && ranges.length ? ranges.map((r) => `${r.open} – ${r.close}`).join(', ') : 'Fermé');
