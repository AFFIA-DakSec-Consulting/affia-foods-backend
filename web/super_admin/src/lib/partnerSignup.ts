// Sign-up of a partner restaurant (no React). The server (POST /api/auth/partner-signup) is the judge; these checks only
// spare the visitor a round trip and name the field in French. Rules mirror backend/src/routes/partners.ts.
import { normalizeVendor } from '../types';
import type { ApprovalStatus, Vendor } from '../types';

export type SignupField = 'name' | 'phone' | 'password' | 'restaurantName' | 'category' | 'address' | 'fssaiNumber';
export type FieldErrors = Partial<Record<SignupField, string>>;

export interface SignupForm {
  name: string;
  phone: string;
  password: string;
  restaurantName: string;
  category: string;
  address: string;
  /** NINEA, the Senegalese tax number (stored in the `fssaiNumber` column). Optional. */
  ninea: string;
}

export const EMPTY_SIGNUP: SignupForm = { name: '', phone: '', password: '', restaurantName: '', category: '', address: '', ninea: '' };

/** Kinds of cuisine offered in the list; the server accepts any text up to 60 characters. */
export const CATEGORIES = ['Fast-food', 'Cuisine sénégalaise', 'Grillades', 'Pizzeria', 'Poulet & frites', 'Café & pâtisserie', 'Jus & boissons', 'Autre'] as const;

const collapse = (value: string) => value.trim().replace(/\s+/g, ' ');

/** "77 123 45 67", "+221 77…", "00221…" -> "+221 771234567"; null when it is not a Senegalese mobile (70, 75, 76, 77, 78). */
export const canonicalPhone = (raw: string): string | null => {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 12 && digits.startsWith('221')) digits = digits.slice(3);
  return /^7[05678]\d{7}$/.test(digits) ? `+221 ${digits}` : null;
};

/** Shown while typing: "77 123 45 67". Leaves anything that is not a plain 9-digit number alone. */
export const formatPhone = (raw: string): string => {
  const digits = raw.replace(/\D/g, '').slice(0, 9);
  if (digits.length !== raw.replace(/\D/g, '').length || raw.trim().startsWith('+') || raw.trim().startsWith('00')) return raw;
  return [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7), digits.slice(7, 9)].filter(Boolean).join(' ');
};

export const passwordProblem = (password: string): string | null => {
  if (password.length < 8) return 'Au moins 8 caractères.';
  if (password.length > 128) return 'Mot de passe trop long.';
  return null;
};

/** How strong the password looks, 0 (empty) to 4. A hint only: the server enforces the minimum length. */
export const passwordStrength = (password: string): 0 | 1 | 2 | 3 | 4 => {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(4, Math.max(1, score)) as 1 | 2 | 3 | 4;
};

const NAME_RE = /^[\p{L}][\p{L}\p{M}\p{Nd} .'\u2019\-]{1,59}$/u;
export const NINEA_RE = /^[A-Za-z0-9]{7,14}$/;

type RestaurantForm = Pick<SignupForm, 'restaurantName' | 'category' | 'address' | 'ninea'>;

/** The restaurant part of the form (also used to fix an application). */
export const validateRestaurant = (form: RestaurantForm): FieldErrors => {
  const errors: FieldErrors = {};
  if (collapse(form.restaurantName).length < 2) errors.restaurantName = 'Indiquez le nom du restaurant.';
  if (!collapse(form.category)) errors.category = 'Choisissez le type de cuisine.';
  if (collapse(form.address).length < 3) errors.address = 'Indiquez où se trouve la cuisine.';
  const ninea = form.ninea.replace(/[\s.-]/g, '');
  if (ninea && !NINEA_RE.test(ninea)) errors.fssaiNumber = 'Le NINEA compte 7 à 14 lettres ou chiffres. Laissez vide si vous ne l’avez pas encore.';
  return errors;
};

/** First problem per field, in the order the form shows them. An empty object means the form can be sent. */
export const validateSignup = (form: SignupForm): FieldErrors => {
  const errors: FieldErrors = {};
  if (!NAME_RE.test(collapse(form.name))) errors.name = 'Indiquez votre prénom et votre nom.';
  if (!canonicalPhone(form.phone)) errors.phone = 'Numéro sénégalais invalide (ex. 77 123 45 67).';
  const problem = passwordProblem(form.password);
  if (problem) errors.password = problem;
  return { ...errors, ...validateRestaurant(form) };
};

/** The body of POST /api/auth/partner-signup. */
export const signupBody = (form: SignupForm, pin?: { lat: number; lng: number; accuracyM?: number | null } | null) => ({
  role: 'VENDOR',
  name: collapse(form.name),
  phone: form.phone.trim(),
  password: form.password,
  restaurantName: collapse(form.restaurantName),
  category: collapse(form.category),
  address: collapse(form.address),
  ...(form.ninea.trim() ? { fssaiNumber: form.ninea.replace(/[\s.-]/g, '') } : {}),
  ...(pin ? { lat: pin.lat, lng: pin.lng, ...(pin.accuracyM != null ? { locationAccuracyM: Math.round(pin.accuracyM) } : {}) } : {}),
});

/** Server error field -> form field (the server names the NINEA `fssaiNumber`, the latitude `lat`, etc.). */
export const fieldFromServer = (field: string | undefined): SignupField | 'location' | null => {
  if (!field) return null;
  if (['name', 'phone', 'password', 'restaurantName', 'category', 'address', 'fssaiNumber'].includes(field)) return field as SignupField;
  if (['lat', 'lng', 'location', 'locationAccuracyM'].includes(field)) return 'location';
  return null;
};

// The server answers in English; the person reading this is not. Known messages are translated, the rest is shown as is.
const SERVER_MESSAGES: Array<[RegExp, string]> = [
  [/already has an account/i, 'Ce numéro a déjà un compte. Connectez-vous plutôt.'],
  [/too many sign-up attempts/i, 'Trop de tentatives d’inscription. Réessayez dans une heure.'],
  [/valid senegalese mobile/i, 'Numéro sénégalais invalide (ex. 77 123 45 67).'],
  [/at least 8 characters/i, 'Le mot de passe doit avoir au moins 8 caractères.'],
  [/password is too long/i, 'Mot de passe trop long.'],
  [/full name/i, 'Indiquez votre prénom et votre nom.'],
  [/restaurant name/i, 'Indiquez le nom du restaurant.'],
  [/where the kitchen is/i, 'Indiquez où se trouve la cuisine.'],
  [/ninea/i, 'Le NINEA compte 7 à 14 lettres ou chiffres. Laissez vide si vous ne l’avez pas encore.'],
  [/wrong phone or password/i, 'Téléphone ou mot de passe incorrect.'],
  [/too many wrong attempts/i, 'Trop d’essais incorrects. Réessayez dans quelques minutes.'],
  [/not registered for this app/i, 'Ce compte n’est pas un compte restaurant.'],
  [/enter your phone number and password/i, 'Saisissez votre numéro et votre mot de passe.'],
  [/something went wrong/i, 'Un problème est survenu. Réessayez dans un instant.'],
  [/inside Senegal/i, 'Cette position n’est pas au Sénégal. Faites-le depuis votre cuisine, ou continuez sans position.'],
  [/latitude|longitude|accuracy/i, 'Position invalide. Réessayez, ou continuez sans position.'],
  [/already approved/i, 'Votre compte est déjà approuvé.'],
];
export const frenchServerMessage = (message: string): string => SERVER_MESSAGES.find(([re]) => re.test(message))?.[1] ?? message;

// ───────────── What the server says about the restaurant's own application ─────────────

export interface PartnerSession {
  approvalStatus: ApprovalStatus;
  rejectionReason: string | null;
  user: { id: string; name: string; phone: string; role: string };
  vendor: Vendor | null;
  /** Fields of the application as filed (the NINEA is not part of `Vendor`). */
  application: { restaurantName: string; category: string; address: string; ninea: string | null } | null;
}

const STATUSES: ApprovalStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'];

export const parsePartnerSession = (body: any): PartnerSession => {
  const status = STATUSES.includes(body?.approvalStatus) ? (body.approvalStatus as ApprovalStatus) : 'PENDING';
  const raw = body?.vendor && typeof body.vendor === 'object' ? body.vendor : null;
  return {
    approvalStatus: status,
    rejectionReason: typeof body?.rejectionReason === 'string' && body.rejectionReason ? body.rejectionReason : null,
    user: {
      id: String(body?.user?.id ?? ''),
      name: String(body?.user?.name ?? ''),
      phone: String(body?.user?.phone ?? ''),
      role: String(body?.user?.role ?? ''),
    },
    vendor: raw ? normalizeVendor(raw) : null,
    application: raw
      ? { restaurantName: String(raw.name ?? ''), category: String(raw.category ?? ''), address: String(raw.address ?? ''), ninea: typeof raw.fssaiNumber === 'string' && raw.fssaiNumber ? raw.fssaiNumber : null }
      : null,
  };
};
