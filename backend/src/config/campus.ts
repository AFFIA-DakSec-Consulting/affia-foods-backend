/**
 * Delivery zone data: the single source of truth for delivery drop points (Docs/19_campus_maps_contract.md section 1).
 * The product runs in Thies (Senegal): a drop point is a QUARTIER; the customer adds the street / landmark in `dropoffNotes`.
 * The mobile apps keep a mirrored constant list for offline use; `GET /api/campus` serves this one (the route and file names
 * come from the campus version of the product and are kept so the apps keep working).
 *
 * The coordinates are APPROXIMATE (one representative point per quartier, around the centre of Thies). Correct them with the
 * real pins before launch: they only feed the map and the rider's distance hint, never a price.
 */
export type DropPointGroup = 'centre' | 'nord' | 'sud';
export type DropPoint = { id: string; name: string; group: DropPointGroup; lat: number; lng: number };

export const CITY_NAME = 'Thiès';
/** Centre of Thies (Escale). */
const THIES_CENTER = Object.freeze({ lat: 14.7886, lng: -16.926 });

const point = (name: string, group: DropPointGroup, dLat: number, dLng: number): DropPoint => ({
  id: name,
  name,
  group,
  lat: Math.round((THIES_CENTER.lat + dLat) * 1e6) / 1e6,
  lng: Math.round((THIES_CENTER.lng + dLng) * 1e6) / 1e6,
});

/** Display / list order is exactly this order. */
export const DROP_POINTS: readonly DropPoint[] = Object.freeze([]);

export const DROP_POINT_NAMES: readonly string[] = [];

/** Lower case, no accents, single spaces and no hyphens: `Thiès-Nord`, `thies nord` and `THIES  NORD` are the same quartier. */
const fold = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

const BY_FOLDED = new Map(DROP_POINTS.map((p) => [fold(p.name), p.name] as const));

/** Arithmetic mean of the distinct pins (not of the names, so shared pins do not count twice). */
export const CAMPUS_CENTER: { lat: number; lng: number } = THIES_CENTER;

/**
 * The product serves all of Senegal. This box (a little generous: it also covers slivers of the neighbouring countries) only stops
 * nonsense such as a pin in the ocean, in another country or at 0,0. Where the app is really available is decided by the
 * "service areas" module (services/serviceAreas.ts), which can narrow it down on purpose.
 */
export const SENEGAL_BOUNDS = Object.freeze({ minLat: 12.2, maxLat: 16.8, minLng: -17.7, maxLng: -11.3 });

/** Longest address text accepted (a street, a landmark, a quartier). */
export const MAX_ADDRESS_LENGTH = 200;
const FORBIDDEN_ADDRESS_CHARS = /[\u0000-\u001f\u007f<>]/;

/**
 * Delivery address text. The customer chooses a saved address, a recent one or types a one-off address, so any readable text is
 * accepted (2 to 200 characters, single spaces); a known quartier written in another spelling is normalised to its canonical name.
 * Control characters (new lines, NUL...) and `<` `>` are refused: the text is shown in the apps and the dashboard. null = refused.
 */
export function normalizeDropPoint(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim().replace(/[ \t]+/g, ' ');
  if (s.length < 2 || s.length > MAX_ADDRESS_LENGTH || FORBIDDEN_ADDRESS_CHARS.test(s)) return null;
  return BY_FOLDED.get(fold(s)) ?? s;
}

/** True for a usable GPS pin (finite, in range). Both coordinates or none. */
export const validPin = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

/** Coordinates of a drop point (any accepted spelling), or null when the name is not a drop point. */
export function dropPointCoords(name: unknown): { lat: number; lng: number } | null {
  const canonical = normalizeDropPoint(name);
  if (!canonical) return null;
  const p = DROP_POINTS.find((d) => d.name === canonical);
  return p ? { lat: p.lat, lng: p.lng } : null;
}

/**
 * `{ name, lat, lng }` for OrderView: the pin saved with the order when the customer gave one, else the pin of a known quartier;
 * null when the address has no coordinates at all (text only).
 */
export function dropoffView(stored: unknown, lat?: unknown, lng?: unknown): { name: string; lat: number; lng: number } | null {
  const canonical = normalizeDropPoint(stored);
  if (!canonical) return null;
  if (validPin(lat, lng)) return { name: canonical, lat: lat as number, lng: lng as number };
  const coords = dropPointCoords(canonical);
  return coords ? { name: canonical, ...coords } : null;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres (haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when the point is a real coordinate inside the box of Senegal. */
export function inSenegal(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  const b = SENEGAL_BOUNDS;
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

/** The pin every restaurant got before it had a real one (schema default). */
export const PLACEHOLDER_VENDOR_PIN = Object.freeze({ lat: 14.7886, lng: -16.926 });

/** A restaurant has a real pin when it is a finite coordinate and not the schema's placeholder (or 0,0). */
export function vendorHasLocation(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return !(Math.abs(lat - PLACEHOLDER_VENDOR_PIN.lat) < 1e-9 && Math.abs(lng - PLACEHOLDER_VENDOR_PIN.lng) < 1e-9);
}

export type LocationCheck = { ok: true; lat: number; lng: number } | { ok: false; field: 'lat' | 'lng' | 'location'; message: string };

/** Validates a restaurant pin from untrusted input: numbers (not strings), real ranges, and inside Senegal. The service-area rule comes on top (checkVendorPin). */
export function checkVendorLocation(lat: unknown, lng: unknown): LocationCheck {
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, field: 'lat', message: 'Latitude must be a number between -90 and 90.' };
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, field: 'lng', message: 'Longitude must be a number between -180 and 180.' };
  if (!inSenegal(lat, lng)) return { ok: false, field: 'location', message: 'The location must be inside Senegal.' };
  return { ok: true, lat, lng };
}
