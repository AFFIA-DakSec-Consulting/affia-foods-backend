// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiService, ApiError } from '../services/api';
import { byText, click, flush, mount, unmount } from '../test/dom';
import { ModulesPanel, dependentsOf, settingValue } from './ModulesPanel';
import { draftsFromZones, zonesFromDrafts } from './ZonesPanel';
import { groupForced, simulationRequest } from './SimulatorPanel';
import { buildBody } from './RulesCrud';
import { segmentOf } from './CampaignsPanel';
import { parseModule, parseSetting } from '../lib/platformParse';

afterEach(async () => { await unmount(); vi.restoreAllMocks(); });

const mod = (over: Record<string, unknown>) => parseModule({ code: 'x', name: 'X', description: 'd', category: 'marketing', isEnabled: true, effective: true, ...over })!;

describe('modules', () => {
  it('lists what leans on a module before it is switched off', () => {
    const all = [mod({ code: 'marketing' }), mod({ code: 'marketing.promo_codes', parentCode: 'marketing' }), mod({ code: 'marketing.x', requires: ['marketing'] }), mod({ code: 'other', isEnabled: false, parentCode: 'marketing' })];
    expect(dependentsOf('marketing', all).map((m) => m.code)).toEqual(['marketing.promo_codes', 'marketing.x']);
  });

  it('checks a setting before sending it', () => {
    const money = parseSetting({ key: 'base_fee', valueType: 'money', value: 500, min: 0, max: 5000 })!;
    expect(settingValue(money, '600')).toEqual({ ok: true, value: 600 });
    expect(settingValue(money, '600.5')).toMatchObject({ ok: false });
    expect(settingValue(money, '9000')).toMatchObject({ ok: false, message: 'Maximum : 5000.' });
    expect(settingValue(money, '')).toMatchObject({ ok: false });
    const json = parseSetting({ key: 'rush_hours', valueType: 'json', value: [] })!;
    expect(settingValue(json, '[{"from":"12:00","to":"14:00"}]')).toMatchObject({ ok: true });
    expect(settingValue(json, '[oops')).toMatchObject({ ok: false });
  });

  it('asks before cutting a module that others depend on, then cascades', async () => {
    const modules = [mod({ code: 'marketing', name: 'Marketing' }), mod({ code: 'marketing.promo_codes', name: 'Codes promo', parentCode: 'marketing' })];
    vi.spyOn(apiService, 'fetchModules').mockResolvedValue(modules);
    const toggle = vi.spyOn(apiService, 'toggleModule').mockResolvedValue({ changed: ['marketing', 'marketing.promo_codes'], modules: modules.map((m) => ({ ...m, isEnabled: false })) });
    await mount(<ModulesPanel onAuthError={() => {}} />);
    await flush();
    await click(document.querySelector('button[aria-label="Désactiver Marketing"]'));
    expect(document.body.textContent).toContain('Codes promo');
    await click(byText('button', 'Tout désactiver'));
    await flush();
    expect(toggle).toHaveBeenCalledWith('marketing', false, true);
  });

  it('shows the server message when a toggle is refused', async () => {
    const modules = [mod({ code: 'delivery.base', name: 'Base', isEnabled: false, effective: false })];
    vi.spyOn(apiService, 'fetchModules').mockResolvedValue(modules);
    vi.spyOn(apiService, 'toggleModule').mockRejectedValue(new ApiError(409, 'Activez d’abord core', 'MODULE_DEPENDENCY'));
    await mount(<ModulesPanel onAuthError={() => {}} />);
    await flush();
    await click(document.querySelector('button[aria-label="Activer Base"]'));
    await flush();
    expect(document.body.textContent).toContain('dont celui-ci dépend');
  });
});

describe('zones', () => {
  const zone = (label: string, maxKm: string, fee = '', pay = '') => ({ label, maxKm, fee, courierPayout: pay });
  it('builds a contiguous grid from the lines', () => {
    const r = zonesFromDrafts([zone('0–2 km', '2', '700', '700'), zone('2–5 km', '5', '1000', '1000'), zone('5 km et +', '')]);
    expect(r).toEqual({ ok: true, zones: [
      { label: '0–2 km', minKm: 0, maxKm: 2, fee: 700, courierPayout: 700 },
      { label: '2–5 km', minKm: 2, maxKm: 5, fee: 1000, courierPayout: 1000 },
      { label: '5 km et +', minKm: 5, maxKm: null, fee: null, courierPayout: null },
    ] });
  });
  it('refuses a limit that does not grow, a bad amount, or an empty grid', () => {
    expect(zonesFromDrafts([zone('a', '2'), zone('b', '2'), zone('c', '')])).toMatchObject({ ok: false });
    expect(zonesFromDrafts([zone('a', '2', '7.5'), zone('b', '')])).toMatchObject({ ok: false });
    expect(zonesFromDrafts([zone('', '2'), zone('b', '')])).toMatchObject({ ok: false });
    expect(zonesFromDrafts([])).toMatchObject({ ok: false });
  });
  it('turns stored zones into lines and back', () => {
    const stored = [{ label: 'A', minKm: 0, maxKm: 3, fee: 500, courierPayout: null }, { label: 'B', minKm: 3, maxKm: null, fee: null, courierPayout: null }];
    const r = zonesFromDrafts(draftsFromZones(stored));
    expect(r).toEqual({ ok: true, zones: stored });
  });
});

describe('simulator', () => {
  const base = { distance: '4', cart: '10000', restaurants: '1', promo: '', commission: '', at: '' };
  it('sends only what was filled and the forced modules', () => {
    const r = simulationRequest({ ...base, promo: 'kraveo20' }, { 'marketing.free_delivery': 'on', 'marketing.loyalty_coins': 'default' });
    expect(r).toEqual({ ok: true, body: { distance_km: 4, cart_amount: 10000, restaurants_count: 1, promo_code: 'KRAVEO20', overrides: { 'marketing.free_delivery': true } } });
  });
  it('explains what is wrong', () => {
    expect(simulationRequest({ ...base, distance: '' }, {})).toMatchObject({ ok: false, field: 'distance' });
    expect(simulationRequest({ ...base, cart: '10.5' }, {})).toMatchObject({ ok: false, field: 'cart' });
    expect(simulationRequest({ ...base, restaurants: '11' }, {})).toMatchObject({ ok: false, field: 'restaurants' });
  });
});

describe('rules forms', () => {
  const fields = [
    { key: 'name', label: 'Nom', kind: 'text' as const, required: true },
    { key: 'price', label: 'Prix', kind: 'int' as const, required: true },
    { key: 'quota', label: 'Quota', kind: 'int' as const },
    { key: 'from', label: 'De', kind: 'time' as const, showWhen: (v: Record<string, unknown>) => v.on === true },
    { key: 'isActive', label: 'Actif', kind: 'bool' as const },
  ];
  it('turns numbers into numbers and empty optional fields into null', () => {
    expect(buildBody(fields, { name: ' Plan ', price: '5000', quota: '', isActive: true })).toEqual({ ok: true, body: { name: 'Plan', price: 5000, quota: null, isActive: true } });
  });
  it('flags the first wrong field', () => {
    expect(buildBody(fields, { name: '', price: '1', isActive: true })).toMatchObject({ ok: false, field: 'name' });
    expect(buildBody(fields, { name: 'a', price: '1.5', isActive: true })).toMatchObject({ ok: false, field: 'price' });
    expect(buildBody(fields, { name: 'a', price: '1', on: true, from: '25:00', isActive: true })).toMatchObject({ ok: false, field: 'from' });
  });
});

describe('campaign segment', () => {
  it('keeps filled fields only and checks the order range', () => {
    expect(segmentOf({ inactiveDays: '30', minOrders: '', maxOrders: '', city: ' Thiès ' })).toEqual({ ok: true, segment: { last_order_days_gt: 30, city: 'Thiès' } });
    expect(segmentOf({ inactiveDays: '', minOrders: '5', maxOrders: '2', city: '' })).toMatchObject({ ok: false, field: 'maxOrders' });
    expect(segmentOf({ inactiveDays: 'x', minOrders: '', maxOrders: '', city: '' })).toMatchObject({ ok: false, field: 'inactiveDays' });
  });
});

import { ordersForMode, topDishesOver, lastDays } from './RestaurantPages';
import { refundStateOf } from './FinanceExtraPanels';
import type { Order } from '../types';

const order = (over: Partial<Order>): Order => ({ id: 'o', customerName: 'Awa Diop', vendorName: 'V', items: [], itemsCount: 0, totalAmount: 0, deliveryFee: 0, dropoffHostel: '', status: 'DELIVERED', paymentStatus: 'PAID', createdAt: '2026-10-15T12:00:00Z', vendorId: 'v1', ...over } as Order);

describe('restaurant pages', () => {
  const orders = [
    order({ id: 'a', status: 'PLACED', createdAt: '2026-10-15T12:00:00Z' }),
    order({ id: 'b', status: 'PREPARING', createdAt: '2026-10-15T11:00:00Z' }),
    order({ id: 'c', status: 'DELIVERED', createdAt: '2026-10-14T11:00:00Z' }),
    order({ id: 'd', status: 'CANCELLED', paymentStatus: 'REFUNDED' as Order['paymentStatus'], createdAt: '2026-10-13T11:00:00Z' }),
    order({ id: 'e', status: 'PLACED', paymentStatus: 'PENDING', createdAt: '2026-10-15T10:00:00Z' }),
    order({ id: 'f', status: 'PLACED', vendorId: 'other' }),
  ];
  it('splits orders by screen and never shows another restaurant or an unpaid order as in progress', () => {
    expect(ordersForMode(orders, 'v1', 'current').map((o) => o.id)).toEqual(['b', 'a']); // oldest first
    expect(ordersForMode(orders, 'v1', 'history').map((o) => o.id)).toEqual(['c']);
    expect(ordersForMode(orders, 'v1', 'returns').map((o) => o.id)).toEqual(['d']);
  });
  it('counts the most ordered dishes over the chosen days only', () => {
    const items = (n: string, q: number) => [{ name: n, quantity: q }] as Order['items'];
    const list = [order({ id: '1', items: items('Yassa', 2), createdAt: '2026-10-15T10:00:00Z' }), order({ id: '2', items: items('Yassa', 1), createdAt: '2026-10-14T10:00:00Z' }), order({ id: '3', items: items('Mafé', 5), createdAt: '2026-10-01T10:00:00Z' }), order({ id: '4', items: items('Thiou', 9), status: 'CANCELLED', createdAt: '2026-10-15T10:00:00Z' })];
    expect(topDishesOver(list, ['2026-10-14', '2026-10-15'])).toEqual([{ name: 'Yassa', quantity: 3 }]);
    expect(lastDays(Date.parse('2026-10-15T12:00:00Z'), 3)).toEqual(['2026-10-13', '2026-10-14', '2026-10-15']);
  });
  it('reads the refund state of an order', () => {
    expect(refundStateOf({ refundStatus: 'FAILED', paymentStatus: 'PAID' })).toBe('FAILED');
    expect(refundStateOf({ refundStatus: 'PENDING', paymentStatus: 'PAID' })).toBe('PENDING');
    expect(refundStateOf({ refundStatus: 'NONE', paymentStatus: 'REFUNDED' })).toBe('DONE');
    expect(refundStateOf({ refundStatus: 'NONE', paymentStatus: 'PAID' })).toBeNull();
  });
});

import { countSegments, segmentsOf } from '../lib/segments';
describe('customer segments', () => {
  const now = Date.parse('2026-10-16T12:00:00Z');
  const day = (n: number) => new Date(now - n * 86_400_000).toISOString();
  const c = (over: Record<string, unknown>) => ({ createdAt: day(100), ordersCount: 0, lastOrderAt: null, deleted: false, ...over }) as Parameters<typeof segmentsOf>[0];
  it('puts a customer in every segment that fits', () => {
    expect(segmentsOf(c({ createdAt: day(3) }), now)).toEqual(['NEW', 'NEVER_ORDERED']);
    expect(segmentsOf(c({ ordersCount: 1, lastOrderAt: day(2) }), now)).toEqual(['FIRST_ORDER']);
    expect(segmentsOf(c({ ordersCount: 3, lastOrderAt: day(45) }), now)).toEqual(['RECURRING', 'AT_RISK']);
    expect(segmentsOf(c({ ordersCount: 9, lastOrderAt: day(1) }), now)).toEqual(['LOYAL']);
    expect(segmentsOf(c({ deleted: true, ordersCount: 9 }), now)).toEqual([]);
  });
  it('counts each segment', () => {
    const counts = countSegments([c({ createdAt: day(1) }), c({ ordersCount: 6, lastOrderAt: day(40) }), c({ ordersCount: 6, lastOrderAt: day(2) })], now);
    expect(counts).toMatchObject({ NEW: 1, NEVER_ORDERED: 1, LOYAL: 2, AT_RISK: 1, FIRST_ORDER: 0 });
  });
});

import { groupVersions } from './LegalDocumentsPanel';
import { LEGAL_SCOPES, parseHelpArticle, parseLegalDocument, slugify } from '../lib/platformParse';
describe('legal documents and help', () => {
  const doc = (over: Record<string, unknown>) => parseLegalDocument({ id: 'x', type: 'TERMS', locale: 'fr', version: 1, title: 'CGU', status: 'PUBLISHED', ...over })!;
  it('groups versions by type, newest first, and finds the one shown in the apps', () => {
    const groups = groupVersions([doc({ id: 'a', version: 1, isActive: true }), doc({ id: 'b', version: 2, status: 'DRAFT' }), doc({ id: 'c', type: 'PRIVACY' })], LEGAL_SCOPES.legal);
    expect(groups.map((g) => g.type)).toEqual(['TERMS', 'PRIVACY', 'REFUNDS']);
    expect(groups[0].versions.map((v) => v.id)).toEqual(['b', 'a']);
    expect(groups[0].active?.id).toBe('a');
    expect(groups[1].active).toBeNull();
    expect(groups[2].versions).toEqual([]);
  });
  it('drops a document of an unknown type and reads an article safely', () => {
    expect(parseLegalDocument({ id: 'x', type: 'WHATEVER' })).toBeNull();
    expect(parseHelpArticle({ id: 'h', audience: 'NOBODY', isPublished: true })).toMatchObject({ audience: 'ALL', isPublished: true });
  });
  it('makes a clean slug from a French title', () => {
    expect(slugify('Annuler une commande & être remboursé !')).toBe('annuler-une-commande-etre-rembourse');
    expect(slugify('  À propos  ')).toBe('a-propos');
  });
});

import { canOpen, canUse, firstAllowedTab, groupOfTab } from '../lib/permissions';
import { isSessionRejected } from '../lib/adminMessages';
import { prospectBody } from './ProspectsPanel';
import { isOverdue, parseProspectStats, parseTeamMe, parseTeamMember } from '../lib/platformParse';

describe('team permissions in the dashboard', () => {
  it('opens everything when there is no permission list (owner, older server)', () => {
    expect(canOpen(undefined, 'finance')).toBe(true);
    expect(canUse(undefined, 'team')).toBe(true);
  });
  it('opens only the groups of the role', () => {
    const finance = ['finance', 'stats'];
    expect(canOpen(finance, 'finance')).toBe(true);
    expect(canOpen(finance, 'analytics')).toBe(true);
    expect(canOpen(finance, 'orders')).toBe(false);
    expect(canOpen(finance, 'team')).toBe(false);
    expect(canOpen(finance, 'settings')).toBe(true); // the settings hub and the own account need no group
    expect(canOpen(finance, 'settings-account')).toBe(true);
    expect(canOpen(finance, 'r-dashboard')).toBe(false); // the restaurant preview reads operations data
    expect(groupOfTab('simulator')).toBe('marketing');
    expect(firstAllowedTab(finance, ['map', 'tickets', 'finance'])).toBe('finance');
    expect(firstAllowedTab(['support'], ['finance'])).toBeNull();
  });
  it('does not end the session on a role refusal, but does on a refused token', () => {
    expect(isSessionRejected({ status: 403, code: 'PERMISSION_DENIED' })).toBe(false);
    expect(isSessionRejected({ status: 403, code: 'FORBIDDEN' })).toBe(true);
    expect(isSessionRejected({ status: 401 })).toBe(true);
    expect(isSessionRejected({ status: 500 })).toBe(false);
  });
  it('reads a team member and the own role', () => {
    expect(parseTeamMember({ id: 'u', name: 'Awa', role: 'SUPPORT', isOwner: false, disabled: true })).toMatchObject({ role: 'SUPPORT', disabled: true, isOwner: false });
    expect(parseTeamMember({ name: 'no id' })).toBeNull();
    expect(parseTeamMe({ data: { role: 'FINANCE', permissions: ['finance', 'stats'] } })).toEqual({ role: 'FINANCE', permissions: ['finance', 'stats'], access: {}, twoFactor: false, backupCodesLeft: 0 });
    expect(parseTeamMe({})).toBeNull();
  });
});

describe('prospecting', () => {
  const base = { kind: 'RESTAURANT', businessName: ' Chez Mama ', contactName: '', phone: '77 456 12 30', email: '', district: 'Randoulène', category: '', source: '', fit: '', stage: 'TO_CONTACT', nextFollowUpAt: '' } as Parameters<typeof prospectBody>[0];
  it('sends empty fields as null so they can be cleared, and trims the name', () => {
    expect(prospectBody(base)).toMatchObject({ businessName: 'Chez Mama', contactName: null, email: null, fit: null, nextFollowUpAt: null, phone: '77 456 12 30' });
    expect(prospectBody({ ...base, fit: 'A', nextFollowUpAt: '2026-10-20T09:00' }).fit).toBe('A');
    expect(typeof prospectBody({ ...base, nextFollowUpAt: '2026-10-20T09:00' }).nextFollowUpAt).toBe('string');
  });
  it('flags a follow-up only while the contact is still being worked', () => {
    const now = Date.parse('2026-10-16T12:00:00Z');
    expect(isOverdue({ stage: 'CONTACTED', nextFollowUpAt: '2026-10-15T09:00:00Z' }, now)).toBe(true);
    expect(isOverdue({ stage: 'CONTACTED', nextFollowUpAt: '2026-10-20T09:00:00Z' }, now)).toBe(false);
    expect(isOverdue({ stage: 'SIGNED', nextFollowUpAt: '2026-10-01T09:00:00Z' }, now)).toBe(false);
    expect(isOverdue({ stage: 'TO_CONTACT', nextFollowUpAt: null }, now)).toBe(false);
  });
  it('reads the pipeline counts', () => {
    const s = parseProspectStats({ data: { total: 8, overdue: 2, conversionRate: 50, counts: { SIGNED: 1, REJECTED: 1, TO_CONTACT: 2 } } });
    expect(s.counts).toMatchObject({ SIGNED: 1, TO_CONTACT: 2, CONTACTED: 0 });
    expect(s.overdue).toBe(2);
  });
});

import { ROLE_ACCESS, isReadOnlyTab } from '../lib/permissions';
import { describeAgent, groupSecret, parseAdminSession, parseTwoFactorSetup } from '../lib/platformParse';

describe('read-only roles and security', () => {
  it('knows when a screen is read-only for the role', () => {
    const finance = { ops: 'read', finance: 'write', stats: 'write' } as const;
    expect(isReadOnlyTab(finance, 'orders')).toBe(true);
    expect(isReadOnlyTab(finance, 'finance')).toBe(false);
    expect(isReadOnlyTab(finance, 'settings')).toBe(false); // the hub and the own account need no group
    expect(isReadOnlyTab(undefined, 'orders')).toBe(false); // the owner and older servers: write everywhere
  });
  it('keeps the table shown to the admin equal to the one the server enforces', () => {
    expect(ROLE_ACCESS.VIEWER.team).toBeUndefined();
    expect(Object.values(ROLE_ACCESS.VIEWER).every((a) => a === 'read')).toBe(true);
    expect(ROLE_ACCESS.MARKETING.ops).toBe('read'); // segments read the customer list
    expect(ROLE_ACCESS.FINANCE.finance).toBe('write');
    expect(Object.keys(ROLE_ACCESS.SUPER_ADMIN)).toContain('team');
    for (const [role, levels] of Object.entries(ROLE_ACCESS)) if (role !== 'SUPER_ADMIN') expect((levels as Record<string, string>).team).toBeUndefined();
  });
  it('does not end the session on a read-only refusal', () => {
    expect(isSessionRejected({ status: 403, code: 'READ_ONLY' })).toBe(false);
  });
  it('reads my access, the sessions and the two-step setup', () => {
    expect(parseTeamMe({ data: { role: 'VIEWER', permissions: ['ops'], access: { ops: 'read', junk: 'admin' }, twoFactor: true, backupCodesLeft: 6 } })).toEqual({ role: 'VIEWER', permissions: ['ops'], access: { ops: 'read' }, twoFactor: true, backupCodesLeft: 6 });
    expect(parseAdminSession({ id: 's', ip: '1.2.3.4', current: true })).toMatchObject({ id: 's', current: true, userAgent: null });
    expect(parseAdminSession({ ip: 'no id' })).toBeNull();
    expect(parseTwoFactorSetup({ data: { secret: 'ABCDEFGH', otpauthUrl: 'otpauth://x' } })).toEqual({ secret: 'ABCDEFGH', otpauthUrl: 'otpauth://x' });
    expect(parseTwoFactorSetup({ data: {} })).toBeNull();
  });
  it('describes a browser and groups the secret by four', () => {
    expect(describeAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36')).toBe('Chrome sur macOS');
    expect(describeAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Safari/604.1')).toBe('Safari sur iOS');
    expect(describeAgent('Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/121.0')).toBe('Firefox sur Windows');
    expect(describeAgent(null)).toBe('Navigateur inconnu');
    expect(groupSecret('GEZDGNBVGY3TQOJQ')).toBe('GEZD GNBV GY3T QOJQ');
  });
});

import { usableSupers } from './TeamPanel';
describe('team safety notice', () => {
  const m = (over: Record<string, unknown>) => ({ role: 'SUPER_ADMIN', disabled: false, dormant: false, ...over }) as Parameters<typeof usableSupers>[0][number];
  it('counts only super admins who can really sign in', () => {
    expect(usableSupers([m({}), m({ role: 'SUPPORT' })])).toBe(1);
    expect(usableSupers([m({}), m({})])).toBe(2);
    expect(usableSupers([m({}), m({ disabled: true }), m({ dormant: true })])).toBe(1);
    expect(usableSupers([])).toBe(0);
  });
});

describe('simulator module list', () => {
  const m = (code: string, category: string) => parseModule({ code, name: code, category, isEnabled: true, effective: true })!;
  it('groups what can change a price, in a fixed order, and leaves out what cannot', () => {
    const groups = groupForced([m('marketing.promo_codes', 'marketing'), m('analytics', 'analytics'), m('courier.base_payout', 'courier'), m('delivery.base_pricing', 'delivery'), m('marketing.referral', 'marketing'), m('marketing.campaigns', 'marketing'), m('marketing.loyalty_coins', 'marketing')]);
    expect(groups.map((g) => g.label)).toEqual(['Livraison', 'Livreur', 'Marketing']);
    expect(groups[2].modules.map((x) => x.code)).toEqual(['marketing.promo_codes']);
    expect(groupForced([])).toEqual([]);
  });
});

import { SENEGAL_CITIES, cityByName } from '../lib/senegalCities';
import { areaBody, parsePointCheck, parseServiceAreas } from '../lib/platformParse';
import { isInSenegal } from '../lib/campus';

describe('service areas', () => {
  it('ships only real towns of Senegal, once each, with a usable radius', () => {
    expect(SENEGAL_CITIES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(SENEGAL_CITIES.map((c) => c.name)).size).toBe(SENEGAL_CITIES.length);
    for (const c of SENEGAL_CITIES) {
      expect([c.name, isInSenegal(c.lat, c.lng)]).toEqual([c.name, true]);
      expect(c.radiusKm).toBeGreaterThanOrEqual(0.5);
      expect(c.radiusKm).toBeLessThanOrEqual(500);
    }
    expect(cityByName('Thiès')).toMatchObject({ lat: 14.7886, lng: -16.926, radiusKm: 8 });
    expect(cityByName('Atlantis')).toBeUndefined();
  });

  it('turns the form into the body the server accepts, keeping every decimal of a position', () => {
    expect(areaBody({ name: ' Mbour ', lat: '14,4167', lng: '-16.966700', radiusKm: '10', isActive: true })).toEqual({ ok: true, body: { name: 'Mbour', lat: 14.4167, lng: -16.9667, radiusKm: 10, isActive: true } });
    expect(areaBody({ name: 'M', lat: '14', lng: '-16', radiusKm: '5', isActive: true })).toMatchObject({ ok: false, field: 'name' });
    expect(areaBody({ name: 'Mbour', lat: '', lng: '-16', radiusKm: '5', isActive: true })).toMatchObject({ ok: false, field: 'lat' });
    expect(areaBody({ name: 'Mbour', lat: '91', lng: '-16', radiusKm: '5', isActive: true })).toMatchObject({ ok: false, field: 'lat' });
    expect(areaBody({ name: 'Mbour', lat: '14', lng: 'abc', radiusKm: '5', isActive: true })).toMatchObject({ ok: false, field: 'lng' });
    expect(areaBody({ name: 'Mbour', lat: '14', lng: '-16', radiusKm: '0.1', isActive: true })).toMatchObject({ ok: false, field: 'radiusKm' });
    expect(areaBody({ name: 'Mbour', lat: '14', lng: '-16', radiusKm: '600', isActive: true })).toMatchObject({ ok: false, field: 'radiusKm' });
  });

  it('reads the zones with the state of the rule, and a point check for each audience', () => {
    const info = parseServiceAreas({ data: [{ id: 'a', name: 'Thiès', lat: 14.7886, lng: -16.926, radiusKm: 8, isActive: true }, { name: 'no id' }], meta: { restricted: true, maxAreas: 50 } });
    expect(info.areas).toHaveLength(1);
    expect(info).toMatchObject({ restricted: true, maxAreas: 50 });
    const check = parsePointCheck({ data: { restricted: true, inCountry: true, vendor: { served: true, area: { name: 'Thiès' } }, customer: { served: false, message: 'Pas encore chez vous.' } } });
    expect(check.vendor).toEqual({ served: true, area: 'Thiès', message: null });
    expect(check.customer).toEqual({ served: false, area: null, message: 'Pas encore chez vous.' });
  });
});
