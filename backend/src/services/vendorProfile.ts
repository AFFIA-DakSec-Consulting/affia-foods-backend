import { canonicalPhone } from '../utils/phone';

/**
 * Restaurant public profile (Docs/24_vendor_profile_contract.md): logo, banner, description, contact phone and opening hours.
 * Shared by `PATCH /api/admin/vendors/:id/profile` (admin) and `PUT /api/partner/vendor/profile` (the restaurant itself).
 * Partial update: only the keys present in the body are touched. null / "" clears an optional field.
 */
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Day = (typeof DAYS)[number];
export interface HourRange { open: string; close: string }
export type OpeningHours = Partial<Record<Day, HourRange[]>>;

export const MAX_DESCRIPTION = 300;
export const MAX_URL = 500;
export const MAX_RANGES_PER_DAY = 3;
export const MAX_PICKUP_NOTES = 200;
export const MAX_ETA_MINUTES = 180;

export type ProfileFail = { ok: false; field: string; message: string };
export interface ProfileData {
  name?: string;
  category?: string;
  address?: string;
  /** "20-25 min": the preparation time shown to customers. */
  eta?: string;
  pickupNotes?: string | null;
  logoUrl?: string | null;
  bannerImage?: string;
  description?: string | null;
  phone?: string | null;
  openingHours?: OpeningHours | null;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

const checkText = (field: string, raw: unknown, min: number, max: number): { ok: true; value: string } | ProfileFail => {
  if (typeof raw !== 'string') return { ok: false, field, message: 'This field must be text.' };
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value.length < min) return { ok: false, field, message: `This field needs at least ${min} characters.` };
  if (value.length > max) return { ok: false, field, message: `This field is too long (up to ${max} characters).` };
  return { ok: true, value };
};

const checkUrl = (field: string, raw: unknown, required: boolean): { ok: true; value: string | null } | ProfileFail => {
  if (raw === null || (typeof raw === 'string' && raw.trim() === '')) {
    return required ? { ok: false, field, message: 'An image link is required.' } : { ok: true, value: null };
  }
  if (typeof raw !== 'string') return { ok: false, field, message: 'The image link must be text.' };
  const value = raw.trim();
  if (value.length > MAX_URL) return { ok: false, field, message: `The image link is too long (up to ${MAX_URL} characters).` };
  let url: URL;
  try { url = new URL(value); } catch { return { ok: false, field, message: 'The image link is not a valid web address.' }; }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || /\s/.test(value)) return { ok: false, field, message: 'The image link must start with https://.' };
  return { ok: true, value };
};

export const checkOpeningHours = (raw: unknown): { ok: true; value: OpeningHours | null } | ProfileFail => {
  if (raw === null) return { ok: true, value: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, field: 'openingHours', message: 'Opening hours must be an object with one entry per day.' };
  const out: OpeningHours = {};
  for (const [day, ranges] of Object.entries(raw as Record<string, unknown>)) {
    if (!(DAYS as readonly string[]).includes(day)) return { ok: false, field: 'openingHours', message: `Unknown day "${day}". Use ${DAYS.join(', ')}.` };
    if (!Array.isArray(ranges)) return { ok: false, field: 'openingHours', message: `${day}: expected a list of opening periods.` };
    if (ranges.length > MAX_RANGES_PER_DAY) return { ok: false, field: 'openingHours', message: `${day}: at most ${MAX_RANGES_PER_DAY} opening periods per day.` };
    const clean: HourRange[] = [];
    for (const r of ranges) {
      const open = (r as any)?.open; const close = (r as any)?.close;
      if (typeof open !== 'string' || typeof close !== 'string' || !TIME_RE.test(open) || !TIME_RE.test(close)) return { ok: false, field: 'openingHours', message: `${day}: times must look like 08:30.` };
      if (toMinutes(open) >= toMinutes(close)) return { ok: false, field: 'openingHours', message: `${day}: ${open} must be before ${close}.` };
      clean.push({ open, close });
    }
    clean.sort((a, b) => toMinutes(a.open) - toMinutes(b.open));
    for (let i = 1; i < clean.length; i++) {
      if (toMinutes(clean[i].open) < toMinutes(clean[i - 1].close)) return { ok: false, field: 'openingHours', message: `${day}: opening periods overlap.` };
    }
    if (clean.length) out[day as Day] = clean;
  }
  return { ok: true, value: out };
};

/** Validates a partial profile update. At least one known key is required. */
export const checkProfile = (body: unknown): { ok: true; data: ProfileData } | ProfileFail => {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const data: ProfileData = {};
  let touched = 0;

  if ('name' in b) {
    const c = checkText('name', b.name, 2, 60); if (!c.ok) return c;
    data.name = c.value; touched++;
  }
  if ('category' in b) {
    const c = checkText('category', b.category, 2, 60); if (!c.ok) return c;
    data.category = c.value; touched++;
  }
  if ('address' in b) {
    const c = checkText('address', b.address, 3, 140); if (!c.ok) return c;
    data.address = c.value; touched++;
  }
  if ('eta' in b) {
    const m = typeof b.eta === 'string' ? /^(\d{1,3})-(\d{1,3}) min$/.exec(b.eta.trim()) : null;
    const lo = m ? Number(m[1]) : NaN; const hi = m ? Number(m[2]) : NaN;
    if (!m || lo < 1 || hi > MAX_ETA_MINUTES || lo >= hi) return { ok: false, field: 'eta', message: `The preparation time must look like "20-25 min" (from 1 to ${MAX_ETA_MINUTES} minutes, the first number smaller).` };
    data.eta = `${lo}-${hi} min`; touched++;
  }
  if ('pickupNotes' in b) {
    if (b.pickupNotes !== null && typeof b.pickupNotes !== 'string') return { ok: false, field: 'pickupNotes', message: 'The notes must be text.' };
    const text = typeof b.pickupNotes === 'string' ? b.pickupNotes.trim() : '';
    if (text.length > MAX_PICKUP_NOTES) return { ok: false, field: 'pickupNotes', message: `The notes are too long (up to ${MAX_PICKUP_NOTES} characters).` };
    data.pickupNotes = text || null; touched++;
  }
  if ('logoUrl' in b) {
    const c = checkUrl('logoUrl', b.logoUrl, false); if (!c.ok) return c;
    data.logoUrl = c.value; touched++;
  }
  if ('bannerImage' in b) {
    const c = checkUrl('bannerImage', b.bannerImage, true); if (!c.ok) return c;
    data.bannerImage = c.value as string; touched++;
  }
  if ('description' in b) {
    if (b.description !== null && typeof b.description !== 'string') return { ok: false, field: 'description', message: 'The description must be text.' };
    const text = typeof b.description === 'string' ? b.description.trim() : '';
    if (text.length > MAX_DESCRIPTION) return { ok: false, field: 'description', message: `The description is too long (up to ${MAX_DESCRIPTION} characters).` };
    data.description = text || null; touched++;
  }
  if ('phone' in b) {
    if (b.phone === null || (typeof b.phone === 'string' && b.phone.trim() === '')) data.phone = null;
    else {
      const phone = canonicalPhone(b.phone);
      if (!phone) return { ok: false, field: 'phone', message: 'Enter a Senegalese mobile number such as 77 123 45 67.' };
      data.phone = phone;
    }
    touched++;
  }
  if ('openingHours' in b) {
    const c = checkOpeningHours(b.openingHours); if (!c.ok) return c;
    data.openingHours = c.value; touched++;
  }
  if (touched === 0) return { ok: false, field: 'body', message: 'Nothing to update. Send at least one of: name, category, address, eta, pickupNotes, logoUrl, bannerImage, description, phone, openingHours.' };
  return { ok: true, data };
};

/** The profile fields every vendor view carries. */
export const vendorProfileView = (v: any) => ({
  name: (v?.name ?? null) as string | null,
  category: (v?.category ?? null) as string | null,
  address: (v?.address ?? null) as string | null,
  eta: (v?.eta ?? null) as string | null,
  pickupNotes: (v?.pickupNotes ?? null) as string | null,
  logoUrl: (v?.logoUrl ?? null) as string | null,
  description: (v?.description ?? null) as string | null,
  phone: (v?.phone ?? null) as string | null,
  openingHours: (v?.openingHours ?? null) as OpeningHours | null,
});

export const PROFILE_SELECT = { id: true, name: true, category: true, address: true, eta: true, pickupNotes: true, bannerImage: true, logoUrl: true, description: true, phone: true, openingHours: true } as const;
