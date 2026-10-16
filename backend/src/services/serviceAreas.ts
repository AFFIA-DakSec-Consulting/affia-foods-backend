/**
 * Where the app is available (module `delivery.service_areas`).
 *
 * - Default: all of Senegal (mode COUNTRY, or the module switched off). Only a pin outside Senegal is refused.
 * - Mode AREAS: a location must also be inside at least one ACTIVE service area (a circle: centre + radius). The back-office can
 *   apply this to restaurants, to customers' delivery addresses, or both, and can require a map pin from customers.
 * The rule is read from the module registry on every check, so a change in the back-office applies at once.
 */
import { prisma } from '../db';
import { getRegistry } from '../core/modules/module-registry.service';
import { SENEGAL_BOUNDS, checkVendorLocation, distanceKm, inSenegal, LocationCheck } from '../config/campus';

export const MODULE = 'delivery.service_areas';
export const DEFAULT_MESSAGE = 'Affia Foods n’est pas encore disponible à cet endroit.';

export type AreaRow = { id: string; name: string; lat: number; lng: number; radiusKm: number };
export type Audience = 'vendor' | 'customer';
export type ServiceConfig = { restricted: boolean; applyToVendors: boolean; applyToCustomers: boolean; requirePin: boolean; message: string; areas: AreaRow[] };
export type Verdict = { ok: true; area: AreaRow | null } | { ok: false; code: 'OUTSIDE_COUNTRY' | 'OUTSIDE_SERVICE_AREA'; message: string };

export const OPEN_CONFIG: ServiceConfig = { restricted: false, applyToVendors: true, applyToCustomers: true, requirePin: false, message: DEFAULT_MESSAGE, areas: [] };

/** Pure: the verdict for one point. */
export const evaluate = (cfg: ServiceConfig, audience: Audience, lat: number, lng: number): Verdict => {
  if (!inSenegal(lat, lng)) return { ok: false, code: 'OUTSIDE_COUNTRY', message: 'The location must be inside Senegal.' };
  const applies = cfg.restricted && (audience === 'vendor' ? cfg.applyToVendors : cfg.applyToCustomers);
  if (!applies) return { ok: true, area: null };
  const area = cfg.areas.find((a) => distanceKm({ lat: a.lat, lng: a.lng }, { lat, lng }) <= a.radiusKm) ?? null;
  return area ? { ok: true, area } : { ok: false, code: 'OUTSIDE_SERVICE_AREA', message: cfg.message };
};

/** Pure: does the rule ask a customer for a map pin? */
export const pinRequired = (cfg: ServiceConfig): boolean => cfg.restricted && cfg.applyToCustomers && cfg.requirePin;

export const listAreas = (onlyActive = false) =>
  prisma.serviceArea.findMany({ where: onlyActive ? { isActive: true } : {}, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });

/** The current rule. A server whose database has no such module (not migrated yet) behaves as "all of Senegal". */
export const loadConfig = async (): Promise<ServiceConfig> => {
  try {
    const reg = await getRegistry();
    if (!reg.isEnabled(MODULE) || reg.str(MODULE, 'mode') !== 'AREAS') return OPEN_CONFIG;
    const areas = (await listAreas(true)).map((a) => ({ id: a.id, name: a.name, lat: a.lat, lng: a.lng, radiusKm: a.radiusKm }));
    return { restricted: true, applyToVendors: reg.bool(MODULE, 'apply_to_vendors'), applyToCustomers: reg.bool(MODULE, 'apply_to_customers'), requirePin: reg.bool(MODULE, 'require_pin'), message: reg.str(MODULE, 'outside_message'), areas };
  } catch (err) {
    console.error('service areas: rule unavailable, serving all of Senegal:', (err as Error).message);
    return OPEN_CONFIG;
  }
};

export const checkServiceLocation = async (audience: Audience, lat: number, lng: number): Promise<Verdict> => evaluate(await loadConfig(), audience, lat, lng);

/** A restaurant pin from untrusted input: real numbers, inside Senegal, and inside a service area when the app is narrowed down. */
export const checkVendorPin = async (lat: unknown, lng: unknown): Promise<LocationCheck> => {
  const base = checkVendorLocation(lat, lng);
  if (!base.ok) return base;
  const verdict = await checkServiceLocation('vendor', base.lat, base.lng);
  return verdict.ok ? base : { ok: false, field: 'location', message: verdict.message };
};

/**
 * A customer's delivery pin (optional in the contract). Returns the refusal to send, or null when the order may go on.
 * No pin is fine unless the rule requires one; a pin outside the service area is refused.
 */
export const checkCustomerPin = async (lat: number | null, lng: number | null): Promise<{ code: string; field: 'lat'; message: string } | null> => {
  const cfg = await loadConfig();
  if (lat === null || lng === null) return pinRequired(cfg) ? { code: 'PIN_REQUIRED', field: 'lat', message: 'Place your address on the map: a position is required to check that we deliver there.' } : null;
  const verdict = evaluate(cfg, 'customer', lat, lng);
  return verdict.ok ? null : { code: verdict.code, field: 'lat', message: verdict.message };
};

/** What the apps need: the rule, the areas, and the box of the country. */
export const publicView = async () => {
  const cfg = await loadConfig();
  return {
    mode: cfg.restricted ? 'AREAS' : 'COUNTRY',
    appliesToCustomers: cfg.restricted && cfg.applyToCustomers,
    appliesToVendors: cfg.restricted && cfg.applyToVendors,
    pinRequired: pinRequired(cfg),
    message: cfg.message,
    areas: cfg.restricted ? cfg.areas : [],
    country: { name: 'Sénégal', bounds: SENEGAL_BOUNDS },
  };
};
