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
export const DROP_POINTS: readonly DropPoint[] = Object.freeze([
  point('Escale', 'centre', 0, 0),
  point('Médina Fall', 'centre', 0.004, -0.006),
  point('Grand Thiès', 'centre', 0.003, -0.011),
  point('Cité Ndiaye', 'centre', 0.005, 0.006),
  point('Dixième', 'centre', 0.002, 0.012),
  point('Randoulène', 'nord', 0.012, 0.004),
  point('Thiès Nord', 'nord', 0.018, -0.002),
  point('Parcelles Assainies', 'nord', 0.015, 0.012),
  point('Keur Mame El Hadji', 'nord', 0.008, -0.014),
  point('Cité Lamy', 'sud', -0.004, 0.008),
  point('Thiès Sud', 'sud', -0.012, -0.003),
  point('Nguinth', 'sud', -0.01, 0.009),
  point('Mbour 1', 'sud', -0.006, 0.016),
  point('Diakhao', 'sud', -0.016, -0.012),
]);

export const DROP_POINT_NAMES: readonly string[] = DROP_POINTS.map((p) => p.name);

/** Lower case, no accents, single spaces and no hyphens: `Thiès-Nord`, `thies nord` and `THIES  NORD` are the same quartier. */
const fold = (s: string): string =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();

const BY_FOLDED = new Map(DROP_POINTS.map((p) => [fold(p.name), p.name] as const));

/** Arithmetic mean of the distinct pins (not of the names, so shared pins do not count twice). */
export const CAMPUS_CENTER: { lat: number; lng: number } = (() => {
  const distinct = new Map<string, DropPoint>();
  for (const p of DROP_POINTS) distinct.set(`${p.lat},${p.lng}`, p);
  const pins = [...distinct.values()];
  return {
    lat: pins.reduce((s, p) => s + p.lat, 0) / pins.length,
    lng: pins.reduce((s, p) => s + p.lng, 0) / pins.length,
  };
})();

/** Locations further than this from the centre are rejected for restaurants (the delivery zone of Thies). */
export const NEAR_CAMPUS_KM = 8;

/**
 * Canonical quartier name for any accepted spelling, or null.
 * Accepts the canonical names ignoring case, accents, hyphens and extra spaces (`thies nord`, `RANDOULENE`, `Cite-Lamy`).
 */
export function normalizeDropPoint(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = fold(raw);
  if (!s || s.length > 40) return null;
  return BY_FOLDED.get(s) ?? null;
}

/** Coordinates of a drop point (any accepted spelling), or null when the name is not a drop point. */
export function dropPointCoords(name: unknown): { lat: number; lng: number } | null {
  const canonical = normalizeDropPoint(name);
  if (!canonical) return null;
  const p = DROP_POINTS.find((d) => d.name === canonical);
  return p ? { lat: p.lat, lng: p.lng } : null;
}

/** `{ name, lat, lng }` for OrderView, or null when the stored text is not a drop point (very old data). */
export function dropoffView(stored: unknown): { name: string; lat: number; lng: number } | null {
  const canonical = normalizeDropPoint(stored);
  const coords = canonical ? dropPointCoords(canonical) : null;
  return canonical && coords ? { name: canonical, ...coords } : null;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in kilometres (haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** True when the point is a valid coordinate within the delivery zone (NEAR_CAMPUS_KM of the centre of Thies). */
export function isNearCampus(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  return distanceKm(CAMPUS_CENTER, { lat, lng }) <= NEAR_CAMPUS_KM;
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

/** Validates a restaurant pin from untrusted input: numbers (not strings), real ranges, and on campus. */
export function checkVendorLocation(lat: unknown, lng: unknown): LocationCheck {
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return { ok: false, field: 'lat', message: 'Latitude must be a number between -90 and 90.' };
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) return { ok: false, field: 'lng', message: 'Longitude must be a number between -180 and 180.' };
  if (!isNearCampus(lat, lng)) return { ok: false, field: 'location', message: `The location must be within ${NEAR_CAMPUS_KM} km of the centre of ${CITY_NAME}.` };
  return { ok: true, lat, lng };
}
