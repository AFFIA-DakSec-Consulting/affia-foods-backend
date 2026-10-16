import { DEFAULT_MESSAGE, OPEN_CONFIG, ServiceConfig, evaluate, pinRequired } from '../../src/services/serviceAreas';
import { SENEGAL_BOUNDS, inSenegal } from '../../src/config/campus';

const THIES = { id: 'a1', name: 'Thiès', lat: 14.7886, lng: -16.926, radiusKm: 8 };
const DAKAR = { id: 'a2', name: 'Dakar', lat: 14.6937, lng: -17.4441, radiusKm: 25 };
const limited = (over: Partial<ServiceConfig> = {}): ServiceConfig => ({ restricted: true, applyToVendors: true, applyToCustomers: true, requirePin: false, message: 'Pas encore chez vous.', areas: [THIES, DAKAR], ...over });

describe('service areas: the box of Senegal', () => {
  it('accepts the main cities and refuses other countries, the ocean and 0,0', () => {
    for (const [lat, lng] of [[14.6937, -17.4441], [14.7886, -16.926], [16.0179, -16.4896], [12.5681, -16.2719], [14.4167, -16.9667], [12.5578, -12.1814]]) expect(inSenegal(lat, lng)).toBe(true);
    for (const [lat, lng] of [[48.8566, 2.3522], [12.6392, -8.0029], [0, 0], [14.7, -25], [23.07, 76.85]]) expect(inSenegal(lat, lng)).toBe(false);
    expect(SENEGAL_BOUNDS.minLat).toBeLessThan(SENEGAL_BOUNDS.maxLat);
    for (const bad of [NaN, Infinity, '14.7', null, undefined]) expect(inSenegal(bad, -16.9)).toBe(false);
  });
});

describe('service areas: the verdict', () => {
  it('serves all of Senegal when the app is not limited, and only refuses what is outside the country', () => {
    expect(evaluate(OPEN_CONFIG, 'customer', 14.4167, -16.9667)).toEqual({ ok: true, area: null });
    expect(evaluate(OPEN_CONFIG, 'vendor', 12.5681, -16.2719)).toEqual({ ok: true, area: null });
    expect(evaluate(OPEN_CONFIG, 'customer', 48.8566, 2.3522)).toMatchObject({ ok: false, code: 'OUTSIDE_COUNTRY' });
  });

  it('when limited, serves only what is inside an active area, and says which one', () => {
    const cfg = limited();
    expect(evaluate(cfg, 'customer', 14.79, -16.93)).toMatchObject({ ok: true, area: { name: 'Thiès' } });
    expect(evaluate(cfg, 'customer', 14.72, -17.45)).toMatchObject({ ok: true, area: { name: 'Dakar' } });
    const mbour = evaluate(cfg, 'customer', 14.4167, -16.9667);
    expect(mbour).toEqual({ ok: false, code: 'OUTSIDE_SERVICE_AREA', message: 'Pas encore chez vous.' });
    expect(evaluate(cfg, 'vendor', 12.5681, -16.2719)).toMatchObject({ ok: false, code: 'OUTSIDE_SERVICE_AREA' });
  });

  it('a radius is a circle: just inside is served, just outside is not', () => {
    const cfg = limited({ areas: [THIES] });
    const km = 1 / 111.19;
    expect(evaluate(cfg, 'customer', THIES.lat + 7.9 * km, THIES.lng).ok).toBe(true);
    expect(evaluate(cfg, 'customer', THIES.lat + 8.1 * km, THIES.lng).ok).toBe(false);
  });

  it('applies the limit to restaurants, to customers, or to both', () => {
    const farFromAreas = [14.4167, -16.9667] as const; // Mbour
    expect(evaluate(limited({ applyToCustomers: false }), 'customer', ...farFromAreas).ok).toBe(true);
    expect(evaluate(limited({ applyToCustomers: false }), 'vendor', ...farFromAreas).ok).toBe(false);
    expect(evaluate(limited({ applyToVendors: false }), 'vendor', ...farFromAreas).ok).toBe(true);
    expect(evaluate(limited({ applyToVendors: false }), 'customer', ...farFromAreas).ok).toBe(false);
  });

  it('with no active area, a limited app serves nobody (the back-office refuses to get there)', () => {
    expect(evaluate(limited({ areas: [] }), 'customer', 14.79, -16.93).ok).toBe(false);
  });

  it('asks for a map pin only when limited, for customers, and when the rule says so', () => {
    expect(pinRequired(limited({ requirePin: true }))).toBe(true);
    expect(pinRequired(limited({ requirePin: false }))).toBe(false);
    expect(pinRequired(limited({ requirePin: true, applyToCustomers: false }))).toBe(false);
    expect(pinRequired({ ...OPEN_CONFIG, requirePin: true })).toBe(false); // not limited: never
    expect(DEFAULT_MESSAGE.length).toBeLessThanOrEqual(200);
  });
});
