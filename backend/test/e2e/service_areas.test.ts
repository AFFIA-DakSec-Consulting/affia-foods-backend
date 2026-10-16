/**
 * Service areas (module delivery.service_areas, Docs/27): the app serves all of Senegal by default, and the back-office can narrow it down
 * on purpose to circles (restaurants, customers' delivery addresses, or both). Real PostgreSQL: run it against a throw-away database.
 */
import supertest from 'supertest';
import { randomUUID } from 'crypto';
import { Role } from '@prisma/client';
import { startTestServer, stopTestServer, TestServerInstance } from '../harness/app';
import { prisma } from '../harness/db';
import { generateTestToken } from '../harness/auth';
import { World, createWorld, purgeWorld, createApi, Api } from '../harness/journey';
import { invalidateModuleCache } from '../../src/core/modules/module-registry.service';
import { invalidateAdminRole } from '../../src/services/adminTeam';
import { __resetRateLimits } from '../../src/middleware/rateLimit';

jest.setTimeout(60_000);

const MODULE = 'delivery.service_areas';
const MBOUR = { lat: 14.4167, lng: -16.9667 };
const THIES = { lat: 14.79, lng: -16.93 };
const DAKAR = { lat: 14.6937, lng: -17.4441 };
const PARIS = { lat: 48.8566, lng: 2.3522 };

describe('service areas', () => {
  let server: TestServerInstance;
  let request: ReturnType<typeof supertest>;
  let W: World;
  let api: Api;
  let saved: { module: any; settings: any[]; areas: any[] };
  const admin = () => `Bearer ${W.admin.token}`;
  const as = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, body?: unknown, token = admin()) => {
    const r = (request as any)[method](url).set('Authorization', token);
    return body === undefined ? r : r.send(body);
  };
  const setting = (key: string, value: unknown) => as('patch', `/api/admin/modules/${MODULE}/settings/${key}`, { value });
  const vendorId = () => W.vendors[0].vendorId;
  const setVendorPin = (pin: { lat: number; lng: number }) => as('patch', `/api/admin/vendors/${vendorId()}/location`, pin);
  const placeAt = (pin?: { lat: number; lng: number }) => api.place(W.customers[0], W.vendors[0], pin ? { ...pin } : {});
  const thies = async () => (await prisma.serviceArea.findFirstOrThrow({ where: { name: 'Thiès' } }));
  const reset = async () => {
    await prisma.serviceArea.deleteMany({ where: { name: { startsWith: 'ZZ' } } });
    await prisma.serviceArea.updateMany({ where: { name: 'Thiès' }, data: { isActive: true } });
    for (const s of saved.settings) await prisma.moduleSetting.update({ where: { id: s.id }, data: { value: s.value } });
    await prisma.platformModule.update({ where: { code: MODULE }, data: { isEnabled: saved.module.isEnabled } });
    invalidateModuleCache();
  };

  beforeAll(async () => {
    W = await createWorld('sa', '3', { customers: 1, vendors: 2, riders: 0 });
    server = await startTestServer(0);
    request = supertest(server.app);
    api = createApi(server.baseUrl);
    saved = { module: await prisma.platformModule.findUniqueOrThrow({ where: { code: MODULE } }), settings: await prisma.moduleSetting.findMany({ where: { moduleCode: MODULE } }), areas: await prisma.serviceArea.findMany() };
  });
  afterAll(async () => {
    await reset();
    await prisma.vendor.update({ where: { id: vendorId() }, data: { lat: 14.7886, lng: -16.926 } }).catch(() => undefined);
    await purgeWorld('sa');
    await stopTestServer(server);
  });
  beforeEach(async () => {
    __resetRateLimits(); invalidateAdminRole(); await reset();
    await prisma.address.deleteMany({ where: { userId: W.customers[0].id } });
    await prisma.payment.deleteMany({ where: { order: { customerId: W.customers[0].id } } });
    await prisma.order.deleteMany({ where: { customerId: W.customers[0].id } });
  });

  describe('by default: all of Senegal', () => {
    it('ships the module on, in COUNTRY mode, with Thiès as a ready-made zone', async () => {
      expect(saved.module).toMatchObject({ isEnabled: true, isCore: false, category: 'delivery' });
      const mode = saved.settings.find((s) => s.key === 'mode');
      expect(mode.value).toBe('COUNTRY');
      expect(mode.options).toEqual(['COUNTRY', 'AREAS']);
      const list = await as('get', '/api/admin/service-areas');
      expect(list.status).toBe(200);
      expect(list.body.data.map((a: any) => a.name)).toContain('Thiès');
      expect(list.body.meta).toMatchObject({ restricted: false, maxAreas: 50 });
      const campus = await as('get', '/api/campus');
      expect(campus.body.data.service).toMatchObject({ mode: 'COUNTRY', areas: [], appliesToCustomers: false, appliesToVendors: false });
    });

    it('accepts a restaurant and a delivery address anywhere in Senegal, and refuses only other countries', async () => {
      expect((await setVendorPin(DAKAR)).status).toBe(200);
      expect((await setVendorPin(MBOUR)).status).toBe(200);
      const abroad = await setVendorPin(PARIS);
      expect([abroad.status, abroad.body.field, abroad.body.message]).toEqual([400, 'location', 'The location must be inside Senegal.']);
      expect((await placeAt(MBOUR)).status).toBe(201);
      expect((await placeAt()).status).toBe(201); // no pin: text only, as before
      const far = await placeAt(PARIS);
      expect([far.status, far.body.code]).toEqual([400, 'OUTSIDE_COUNTRY']);
    });
  });

  describe('managing the zones', () => {
    const zone = (extra: object = {}) => ({ name: 'ZZ Dakar', lat: DAKAR.lat, lng: DAKAR.lng, radiusKm: 25, ...extra });

    it('creates, edits and deletes a zone, with the checks and an audit trail', async () => {
      const created = await as('post', '/api/admin/service-areas', zone());
      expect(created.status).toBe(201);
      const id = created.body.data.id;
      expect(created.body.data).toMatchObject({ name: 'ZZ Dakar', radiusKm: 25, isActive: true });
      expect((await as('post', '/api/admin/service-areas', zone({ lat: PARIS.lat, lng: PARIS.lng }))).body.field).toBe('lat'); // the centre must be in Senegal
      expect((await as('post', '/api/admin/service-areas', zone({ radiusKm: 0 }))).body.field).toBe('radiusKm');
      expect((await as('post', '/api/admin/service-areas', zone({ radiusKm: 900 }))).body.field).toBe('radiusKm');
      expect((await as('post', '/api/admin/service-areas', zone({ name: 'x' }))).body.field).toBe('name');
      expect((await as('post', '/api/admin/service-areas', zone({ name: 'ZZ <b>' }))).body.field).toBe('name');
      expect((await as('post', '/api/admin/service-areas', { ...zone(), extra: 1 })).status).toBe(400);
      const edited = await as('patch', `/api/admin/service-areas/${id}`, { radiusKm: 30, isActive: false });
      expect(edited.body.data).toMatchObject({ radiusKm: 30, isActive: false });
      expect((await as('patch', `/api/admin/service-areas/${id}`, {})).status).toBe(400);
      expect((await as('patch', '/api/admin/service-areas/nope', { radiusKm: 3 })).status).toBe(404);
      expect((await as('delete', `/api/admin/service-areas/${id}`)).status).toBe(200);
      expect((await as('delete', `/api/admin/service-areas/${id}`)).status).toBe(404);
      const audit = await as('get', `/api/admin/modules/audit-log?module=${MODULE}&pageSize=50`);
      expect(audit.body.data.map((e: any) => e.action)).toEqual(expect.arrayContaining(['CREATE_SERVICE_AREA', 'UPDATE_SERVICE_AREA', 'DELETE_SERVICE_AREA']));
    });

    it('tells whether a point would be served, for a restaurant and for a customer', async () => {
      await as('post', '/api/admin/service-areas', zone());
      await setting('mode', 'AREAS');
      const mbour = (await as('post', '/api/admin/service-areas/check', MBOUR)).body.data;
      expect(mbour).toMatchObject({ restricted: true, inCountry: true, vendor: { served: false, reason: 'OUTSIDE_SERVICE_AREA' }, customer: { served: false } });
      const dakar = (await as('post', '/api/admin/service-areas/check', DAKAR)).body.data;
      expect(dakar).toMatchObject({ vendor: { served: true, area: { name: 'ZZ Dakar' } }, customer: { served: true } });
      expect((await as('post', '/api/admin/service-areas/check', PARIS)).body.data).toMatchObject({ inCountry: false, customer: { served: false, reason: 'OUTSIDE_COUNTRY' } });
      expect((await as('post', '/api/admin/service-areas/check', { lat: 'x', lng: 1 })).status).toBe(400);
    });
  });

  describe('limiting the app on purpose', () => {
    beforeEach(async () => { expect((await setting('mode', 'AREAS')).status).toBe(200); });

    it('refuses restaurants and delivery addresses outside the zones, with the message of the back-office, and serves the inside', async () => {
      expect((await setting('outside_message', 'Bientôt chez vous !')).status).toBe(200);
      const campus = (await as('get', '/api/campus')).body.data.service;
      expect(campus).toMatchObject({ mode: 'AREAS', appliesToCustomers: true, appliesToVendors: true, message: 'Bientôt chez vous !' });
      expect(campus.areas.map((a: any) => a.name)).toEqual(['Thiès']);

      const vendorOut = await setVendorPin(MBOUR);
      expect([vendorOut.status, vendorOut.body.field, vendorOut.body.message]).toEqual([400, 'location', 'Bientôt chez vous !']);
      expect((await setVendorPin(THIES)).status).toBe(200);

      const out = await placeAt(MBOUR);
      expect([out.status, out.body.code, out.body.field, out.body.message]).toEqual([400, 'OUTSIDE_SERVICE_AREA', 'lat', 'Bientôt chez vous !']);
      expect((await placeAt(THIES)).status).toBe(201);
      expect((await placeAt()).status).toBe(201); // no pin: allowed unless the rule asks for one
      expect(await prisma.order.count({ where: { customerId: W.customers[0].id, dropoffLat: MBOUR.lat } })).toBe(0);
    });

    it('also refuses a saved address whose pin is outside, and a combined order follows the same rule', async () => {
      const outside = await as('post', '/api/auth/addresses', { label: 'Maison', address: 'Mbour centre', ...MBOUR }, `Bearer ${W.customers[0].token}`);
      expect([outside.status, outside.body.code]).toEqual([400, 'OUTSIDE_SERVICE_AREA']);
      expect((await as('post', '/api/auth/addresses', { label: 'Bureau', address: 'Thiès Escale', ...THIES }, `Bearer ${W.customers[0].token}`)).status).toBe(201);
      const group = (pin: { lat: number; lng: number }) => as('post', '/api/order-groups', { restaurants: W.vendors.map((v) => ({ vendorId: v.vendorId, items: [{ itemId: v.items[0].id, quantity: 1 }] })), dropoffHostel: 'Cité Lamy', clientRequestId: randomUUID(), ...pin }, `Bearer ${W.customers[0].token}`);
      const groupOut = await group(MBOUR);
      expect([groupOut.status, groupOut.body.code]).toEqual([400, 'OUTSIDE_SERVICE_AREA']);
      expect((await group(THIES)).status).toBe(201);
    });

    it('can require a map pin from customers', async () => {
      expect((await setting('require_pin', true)).status).toBe(200);
      const none = await placeAt();
      expect([none.status, none.body.code, none.body.field]).toEqual([400, 'PIN_REQUIRED', 'lat']);
      expect((await placeAt(THIES)).status).toBe(201);
      expect((await as('get', '/api/campus')).body.data.service.pinRequired).toBe(true);
    });

    it('can limit only the restaurants, or only the customers', async () => {
      await setting('apply_to_customers', false);
      expect((await placeAt(MBOUR)).status).toBe(201);
      expect((await setVendorPin(MBOUR)).status).toBe(400);
      await setting('apply_to_customers', true);
      await setting('apply_to_vendors', false);
      expect((await setVendorPin(MBOUR)).status).toBe(200);
      expect((await placeAt(MBOUR)).status).toBe(400);
    });

    it('lets a second zone widen the app, and a deactivated zone stops counting', async () => {
      const dakar = await as('post', '/api/admin/service-areas', { name: 'ZZ Dakar', ...DAKAR, radiusKm: 25 });
      expect((await placeAt(DAKAR)).status).toBe(201);
      await as('patch', `/api/admin/service-areas/${dakar.body.data.id}`, { isActive: false });
      expect((await placeAt(DAKAR)).status).toBe(400);
    });

    it('switching the module off opens the whole country again, and on narrows it back down', async () => {
      expect((await placeAt(MBOUR)).status).toBe(400);
      expect((await as('patch', `/api/admin/modules/${MODULE}/toggle`, { enabled: false })).status).toBe(200);
      expect((await placeAt(MBOUR)).status).toBe(201);
      expect((await as('get', '/api/campus')).body.data.service.mode).toBe('COUNTRY');
      expect((await as('patch', `/api/admin/modules/${MODULE}/toggle`, { enabled: true })).status).toBe(200);
      expect((await placeAt(MBOUR)).status).toBe(400);
    });
  });

  describe('guard rails', () => {
    it('never leaves a limited app with no active zone', async () => {
      await setting('mode', 'AREAS');
      const only = await thies();
      const off = await as('patch', `/api/admin/service-areas/${only.id}`, { isActive: false });
      expect([off.status, off.body.code]).toEqual([409, 'LAST_ACTIVE_AREA']);
      const del = await as('delete', `/api/admin/service-areas/${only.id}`);
      expect([del.status, del.body.code]).toEqual([409, 'LAST_ACTIVE_AREA']);
      const dakar = await as('post', '/api/admin/service-areas', { name: 'ZZ Dakar', ...DAKAR, radiusKm: 25 });
      expect((await as('patch', `/api/admin/service-areas/${only.id}`, { isActive: false })).status).toBe(200); // another one is active: fine
      const lastOne = await as('delete', `/api/admin/service-areas/${dakar.body.data.id}`);
      expect(lastOne.body.code).toBe('LAST_ACTIVE_AREA');
    });

    it('refuses to limit the app while no zone is active', async () => {
      await prisma.serviceArea.updateMany({ data: { isActive: false } });
      const refused = await setting('mode', 'AREAS');
      expect([refused.status, refused.body.code]).toEqual([409, 'NO_ACTIVE_AREA']);
      expect((await as('get', '/api/campus')).body.data.service.mode).toBe('COUNTRY');
    });

    it('validates the settings', async () => {
      expect((await setting('mode', 'EVERYWHERE')).status).toBe(400);
      expect((await setting('apply_to_vendors', 'yes')).status).toBe(400);
      expect((await setting('outside_message', '')).status).toBe(400);
      expect((await setting('outside_message', 'x'.repeat(201))).status).toBe(400);
    });

    it('is reserved to team roles that can change marketing settings; others read at most', async () => {
      const member = async (id: string, role: string) => {
        await prisma.user.create({ data: { id, name: `Sa ${role}`, phone: `+221 77360${id.slice(-4)}`, role: Role.ADMIN, adminRole: role } });
        return `Bearer ${generateTestToken({ id, phone: `+221 77360${id.slice(-4)}`, role: Role.ADMIN })}`;
      };
      const support = await member('sa-sup-0001', 'SUPPORT');
      const marketing = await member('sa-mkt-0002', 'MARKETING');
      const viewer = await member('sa-vie-0003', 'VIEWER');
      invalidateAdminRole();
      expect((await as('get', '/api/admin/service-areas', undefined, support)).body.code).toBe('PERMISSION_DENIED');
      expect((await as('get', '/api/admin/service-areas', undefined, viewer)).status).toBe(200);
      expect((await as('post', '/api/admin/service-areas', { name: 'ZZ No', ...DAKAR, radiusKm: 5 }, viewer)).body.code).toBe('READ_ONLY');
      expect((await as('post', '/api/admin/service-areas/check', DAKAR, viewer)).status).toBe(200); // a check only computes
      expect((await as('post', '/api/admin/service-areas', { name: 'ZZ Yes', ...DAKAR, radiusKm: 5 }, marketing)).status).toBe(201);
      expect((await as('get', '/api/admin/service-areas', undefined, `Bearer ${W.customers[0].token}`)).status).toBe(403);
    });
  });
});
