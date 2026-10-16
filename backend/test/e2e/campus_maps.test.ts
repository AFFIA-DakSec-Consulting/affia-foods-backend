/**
 * Delivery quartiers, maps and live rider tracking (Docs/19_campus_maps_contract.md sections 1 and 2):
 * normalisation table, order create / replay, profile update, OrderView dropoff + vendor.hasLocation, GET /api/campus,
 * the data migration SQL against the test database, the admin vendor location endpoint, rider locations, and who
 * gets to see a rider's position. Real PostgreSQL, real socket.io clients.
 */
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import supertest from 'supertest';
import { Socket } from 'socket.io-client';
import { Role } from '@prisma/client';
import { startTestServer, stopTestServer, TestServerInstance } from '../harness/app';
import { prisma, seedTestDatabase, cleanTestOrders, cleanTestUsers } from '../harness/db';
import { getClientToken, getVendorToken, getDriverToken, getAdminToken, getAuthHeader } from '../harness/auth';
import { connectTestSocket, disconnectTestSocket } from '../harness/socket';
import {
  DROP_POINTS, CAMPUS_CENTER, normalizeDropPoint, dropPointCoords, validPin, dropoffView, inSenegal, vendorHasLocation, distanceKm, checkVendorLocation,
} from '../../src/config/campus';

jest.setTimeout(30_000);

const CLIENT = { id: 'usr-1', phone: '+221 776543210' };
const CAMPUS_CLIENT = { id: 'usr-campus-stu', phone: '+221 779877001' };
const VENDOR = { id: 'usr-3', phone: '+221 776543212' };
const RIDER = { id: 'usr-4', phone: '+221 776543213' };
const ADMIN = { id: 'usr-5', phone: '+221 776543214' };
const tClient = getClientToken(CLIENT.id, CLIENT.phone);
const tCampusClient = getClientToken(CAMPUS_CLIENT.id, CAMPUS_CLIENT.phone);
const tVendor = getVendorToken(VENDOR.id, VENDOR.phone);
const tRider = getDriverToken(RIDER.id, RIDER.phone);
const tAdmin = getAdminToken(ADMIN.id, ADMIN.phone);
const H = getAuthHeader;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CANON = ['Escale', 'Médina Fall', 'Grand Thiès', 'Cité Ndiaye', 'Dixième', 'Randoulène', 'Thiès Nord', 'Parcelles Assainies', 'Keur Mame El Hadji', 'Cité Lamy', 'Thiès Sud', 'Nguinth', 'Mbour 1', 'Diakhao'];

// ---------------------------------------------------------------------------------------------------------------
describe('campus.ts (pure)', () => {
  test('there is no default list of drop points: the customer saves, reuses or types an address', () => {
    expect(DROP_POINTS).toHaveLength(0);
    expect(dropPointCoords('Escale')).toBeNull();
    expect(dropPointCoords('anything')).toBeNull();
    expect(CAMPUS_CENTER).toEqual({ lat: 14.7886, lng: -16.926 }); // the centre of Thiès still frames the map
  });

  const accepted: [unknown, string][] = [
    ['Escale', 'Escale'], ['  Escale  ', 'Escale'], ['Cité   Lamy', 'Cité Lamy'], ['Cité\tLamy', 'Cité Lamy'],
    ['123 Rue Custom, Thiès', '123 Rue Custom, Thiès'], ['Près de la gare, Thiès Nord', 'Près de la gare, Thiès Nord'], ['ab', 'ab'], ['x'.repeat(200), 'x'.repeat(200)],
  ];
  test.each(accepted)('accepts %j -> %j', (raw, clean) => {
    expect(normalizeDropPoint(raw)).toBe(clean);
    expect(normalizeDropPoint(clean)).toBe(clean); // idempotent
  });

  const rejected: unknown[] = ['', '   ', 'x', 'Escale\nCité Lamy', 'a\u0000b', '<script>alert(1)</script>', 'a>b', 'x'.repeat(201), 'x'.repeat(500), null, undefined, 2, true, {}, ['Escale']];
  test.each(rejected.map((r) => [typeof r === 'string' ? r.slice(0, 30) : r, r]))('rejects %j', (_label, raw) => {
    expect(normalizeDropPoint(raw)).toBeNull();
  });

  test('validPin and dropoffView: a pin is complete and real, and travels with the address', () => {
    expect(validPin(14.79, -16.93)).toBe(true);
    for (const [la, ln] of [[14.79, undefined], ['14.79', -16.93], [NaN, 1], [91, 0], [0, 181], [null, null]] as [unknown, unknown][]) expect(validPin(la, ln)).toBe(false);
    expect(dropoffView('12 Rue X', 14.79, -16.93)).toEqual({ name: '12 Rue X', lat: 14.79, lng: -16.93 });
    expect(dropoffView('12 Rue X')).toBeNull();
    expect(dropoffView('12 Rue X', 14.79, undefined)).toBeNull();
    expect(dropoffView('', 14.79, -16.93)).toBeNull();
  });

  test('inSenegal: the whole country is served; only real numbers inside the box of Senegal count', () => {
    expect(inSenegal(14.79, -16.93)).toBe(true); // Thiès
    expect(inSenegal(CAMPUS_CENTER.lat, CAMPUS_CENTER.lng)).toBe(true);
    expect(inSenegal(14.6937, -17.4441)).toBe(true); // Dakar
    expect(inSenegal(14.4167, -16.9667)).toBe(true); // Mbour
    expect(inSenegal(16.0179, -16.4896)).toBe(true); // Saint-Louis
    expect(inSenegal(12.5681, -16.2719)).toBe(true); // Ziguinchor
    expect(inSenegal(48.8566, 2.3522)).toBe(false); // Paris
    expect(inSenegal(23.0768, 76.8524)).toBe(false); // the old campus
    expect(inSenegal(0, 0)).toBe(false);
    expect(distanceKm(CAMPUS_CENTER, { lat: CAMPUS_CENTER.lat + 1 / 111.19, lng: CAMPUS_CENTER.lng })).toBeCloseTo(1, 1);
    for (const bad of [NaN, Infinity, '14.79', null, undefined, 91, -91]) expect(inSenegal(bad, -16.93)).toBe(false);
    expect(inSenegal(14.79, 181)).toBe(false);
  });

  test('vendorHasLocation: the schema placeholder and non-numbers are not a real pin', () => {
    expect(vendorHasLocation(14.7886, -16.926)).toBe(false);
    expect(vendorHasLocation(0, 0)).toBe(false);
    expect(vendorHasLocation(NaN, -16.93)).toBe(false);
    expect(vendorHasLocation(null, null)).toBe(false);
    expect(vendorHasLocation(14.79, -16.93)).toBe(true);
    expect(vendorHasLocation(14.7886, -16.9261)).toBe(true);
  });

  test('checkVendorLocation reports the failing field', () => {
    expect(checkVendorLocation(14.79, -16.93)).toEqual({ ok: true, lat: 14.79, lng: -16.93 });
    expect(checkVendorLocation('14.79', -16.93)).toMatchObject({ ok: false, field: 'lat' });
    expect(checkVendorLocation(91, -16.93)).toMatchObject({ ok: false, field: 'lat' });
    expect(checkVendorLocation(14.79, 'x')).toMatchObject({ ok: false, field: 'lng' });
    expect(checkVendorLocation(14.79, 181)).toMatchObject({ ok: false, field: 'lng' });
    expect(checkVendorLocation(14.6937, -17.4441)).toEqual({ ok: true, lat: 14.6937, lng: -17.4441 }); // Dakar: the whole country is served
    expect(checkVendorLocation(48.8566, 2.3522)).toMatchObject({ ok: false, field: 'location', message: 'The location must be inside Senegal.' });
    expect(checkVendorLocation(undefined, undefined)).toMatchObject({ ok: false, field: 'lat' });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('Campus maps API', () => {
  let server: TestServerInstance;
  let request: ReturnType<typeof supertest>;
  const sockets: Socket[] = [];
  const connect = async (token: string) => {
    const s = await connectTestSocket(server.baseUrl, { auth: { token } });
    sockets.push(s);
    return s;
  };

  const place = (extra: Record<string, unknown> = {}, token = tClient) =>
    request.post('/api/orders').set(H(token)).send({ vendorId: 'ven-1', items: [{ itemId: 'item-1', quantity: 1 }], clientRequestId: randomUUID(), ...extra });
  const setPin = (lat: number, lng: number) => prisma.vendor.update({ where: { id: 'ven-1' }, data: { lat, lng } });
  const PLACEHOLDER = { lat: 14.7886, lng: -16.926 };

  beforeAll(async () => {
    await cleanTestOrders();
    await cleanTestUsers();
    await seedTestDatabase();
    await prisma.adminAuditLog.deleteMany({});
    await prisma.user.update({ where: { id: CLIENT.id }, data: { hostelBlock: 'Randoulène', isStudent: true } });
    await prisma.user.upsert({
      where: { id: CAMPUS_CLIENT.id },
      update: { hostelBlock: 'cite lamy', isStudent: true },
      create: { id: CAMPUS_CLIENT.id, name: 'Meera Campus', phone: CAMPUS_CLIENT.phone, role: Role.CLIENT, isStudent: true, avatarId: 3, hostelBlock: 'cite lamy' },
    });
    server = await startTestServer(0);
    request = supertest(server.app);
  });

  beforeEach(async () => {
    await prisma.order.updateMany({ where: { status: 'PLACED', paymentStatus: { in: ['PENDING', 'FAILED'] } }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    await setPin(PLACEHOLDER.lat, PLACEHOLDER.lng);
    await prisma.driverPartner.updateMany({ where: { userId: RIDER.id }, data: { dutyStatus: 'ONLINE', approvalStatus: 'APPROVED' } });
  });

  afterEach(() => {
    while (sockets.length) disconnectTestSocket(sockets.pop()!);
  });

  afterAll(async () => {
    await setPin(PLACEHOLDER.lat, PLACEHOLDER.lng);
    await prisma.user.update({ where: { id: CLIENT.id }, data: { hostelBlock: 'Randoulène' } });
    await stopTestServer(server);
  });

  // ------------------------------------------------------------------------------------------ GET /api/campus
  describe('GET /api/campus', () => {
    test('needs a login', async () => {
      expect((await request.get('/api/campus')).status).toBe(401);
    });

    test.each([['client', tClient], ['vendor', tVendor], ['rider', tRider], ['admin', tAdmin]])('%s gets no default drop points, the city and the centre', async (_r, token) => {
      const res = await request.get('/api/campus').set(H(token));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.headers['cache-control']).toMatch(/max-age=60/);
      expect(res.body.data.center).toEqual({ lat: CAMPUS_CENTER.lat, lng: CAMPUS_CENTER.lng });
      expect(res.body.data.dropPoints).toEqual([]);
      expect(res.body.data.city).toBe('Thiès');
      expect(res.body.data.service).toMatchObject({ mode: 'COUNTRY', areas: [], pinRequired: false, country: { name: 'Sénégal' } }); // all of Senegal by default
    });
  });

  // ------------------------------------------------------------------------------------------ order create
  describe('order creation takes any readable address, with an optional GPS pin', () => {
    test.each([['  Cité   Lamy ', 'Cité Lamy'], ['123 Rue Custom, Thiès', '123 Rue Custom, Thiès'], ['Près de la gare', 'Près de la gare']])('%j is saved as %j', async (input, clean) => {
      const res = await place({ dropoffHostel: input });
      expect(res.status).toBe(201);
      expect(res.body.data.dropoffHostel).toBe(clean);
      expect(res.body.data.dropoff).toBeNull(); // no pin sent: the text alone
      expect((await prisma.order.findUniqueOrThrow({ where: { id: res.body.data.id } })).dropoffHostel).toBe(clean);
    });

    test('a GPS pin is stored and shown with the address in every view', async () => {
      const res = await place({ dropoffHostel: 'Chez moi', lat: 14.79, lng: -16.93 });
      expect(res.status).toBe(201);
      expect(res.body.data.dropoff).toEqual({ name: 'Chez moi', lat: 14.79, lng: -16.93 });
      const row = await prisma.order.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect([row.dropoffLat, row.dropoffLng]).toEqual([14.79, -16.93]);
    });

    test.each(['', 'x', '<b>x</b>', 'Escale\nCité', 'x'.repeat(201)])('%j is refused (field dropoffHostel)', async (input) => {
      const res = await place({ dropoffHostel: input });
      expect(res.status).toBe(400);
      expect(res.body.field).toBe('dropoffHostel');
      expect(res.body.message).toMatch(/delivery address/);
    });

    test('a non-string address and a broken pin are refused', async () => {
      for (const v of [5, {}, ['Escale'], true]) expect((await place({ dropoffHostel: v })).status).toBe(400);
      for (const pin of [{ lat: 14.79 }, { lng: -16.93 }, { lat: 91, lng: 0 }, { lat: 14.79, lng: 181 }, { lat: '14.79', lng: '-16.93' }]) {
        const r = await place({ dropoffHostel: 'Chez moi', ...pin });
        expect([r.status, r.body.field]).toEqual([400, 'lat']);
      }
    });

    test('no address in the request falls back to the profile one', async () => {
      const res = await place({}); // usr-1 profile: "Randoulène"
      expect(res.status).toBe(201);
      expect(res.body.data.dropoffHostel).toBe('Randoulène');
      const r2 = await place({}, tCampusClient); // "cite lamy"
      expect(r2.body.data.dropoffHostel).toBe('cite lamy');
    });

    test('a profile without an address cannot order without giving one', async () => {
      await prisma.user.update({ where: { id: CAMPUS_CLIENT.id }, data: { hostelBlock: null } });
      try {
        const res = await place({}, tCampusClient);
        expect(res.status).toBe(400);
        expect(res.body.field).toBe('dropoffHostel');
      } finally {
        await prisma.user.update({ where: { id: CAMPUS_CLIENT.id }, data: { hostelBlock: 'cite lamy' } });
      }
    });

    test('idempotent replay: the same address (spacing aside) is the same request', async () => {
      const clientRequestId = randomUUID();
      const first = await place({ dropoffHostel: 'Cité Lamy', clientRequestId });
      expect(first.status).toBe(201);
      const again = await place({ dropoffHostel: '  Cité   Lamy ', clientRequestId });
      expect(again.status).toBe(200);
      expect(again.body.idempotentReplay).toBe(true);
      expect(again.body.data.id).toBe(first.body.data.id);
    });

    test('the same request id with a DIFFERENT address is a mismatch', async () => {
      const clientRequestId = randomUUID();
      expect((await place({ dropoffHostel: 'Cité Lamy', clientRequestId })).status).toBe(201);
      const other = await place({ dropoffHostel: 'Randoulène', clientRequestId });
      expect(other.status).toBe(409);
      expect(other.body.code).toBe('CLIENT_REQUEST_MISMATCH');
    });
  });

  // ------------------------------------------------------------------------------------------ profile
  describe('profile address', () => {
    const put = (body: object, token = tCampusClient) => request.put('/api/auth/profile').set(H(token)).send(body);
    afterEach(async () => { await prisma.user.update({ where: { id: CAMPUS_CLIENT.id }, data: { hostelBlock: 'cite lamy', isStudent: true } }); });

    test.each([[' parcelles   assainies ', 'parcelles assainies'], ['Médina Fall', 'Médina Fall'], ['12 Rue Y, Thiès', '12 Rue Y, Thiès']])('%j is stored as %j', async (input, clean) => {
      const res = await put({ hostelBlock: input });
      expect(res.status).toBe(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: CAMPUS_CLIENT.id } })).hostelBlock).toBe(clean);
    });

    test.each(['', 'x', '<script>', 'a\nb', 'x'.repeat(201)])('%j is refused (field hostelBlock)', async (input) => {
      const res = await put({ hostelBlock: input });
      expect(res.status).toBe(400);
      expect(res.body.field).toBe('hostelBlock');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: CAMPUS_CLIENT.id } })).hostelBlock).toBe('cite lamy'); // untouched
    });

    test('being a student does not matter in Thiès', async () => {
      const res = await put({ isStudent: false, hostelBlock: 'Thiès Nord' });
      expect(res.status).toBe(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: CAMPUS_CLIENT.id } })).hostelBlock).toBe('Thiès Nord');
    });
  });

  // ------------------------------------------------------------------------------------------ OrderView
  describe('OrderView: dropoff and vendor.hasLocation', () => {
    test('every viewer sees the same dropoff; hasLocation follows the vendor pin', async () => {
      const placed = await place({ dropoffHostel: 'Cité Ndiaye', lat: 14.795, lng: -16.931 });
      const id = placed.body.data.id as string;
      const want = { name: 'Cité Ndiaye', lat: 14.795, lng: -16.931 };
      expect(placed.body.data.dropoff).toEqual(want);
      expect(placed.body.data.vendor.hasLocation).toBe(false); // placeholder pin
      expect(placed.body.data.vendor.lat).toBe(PLACEHOLDER.lat);

      // pay it so the vendor and the rider pool can see it (direct DB, the payment flow has its own tests)
      await prisma.order.update({ where: { id }, data: { paymentStatus: 'PAID', paidAt: new Date(), status: 'ACCEPTED' } });
      for (const t of [tAdmin, tVendor, tRider]) {
        const r = await request.get(`/api/orders/${id}`).set(H(t));
        expect(r.status).toBe(200);
        expect(r.body.data.dropoff).toEqual(want);
        expect(r.body.data.dropoffHostel).toBe('Cité Ndiaye');
        expect(r.body.data.vendor.hasLocation).toBe(false);
      }

      await setPin(14.7945, -16.959);
      for (const t of [tClient, tAdmin, tVendor, tRider]) {
        const r = await request.get(`/api/orders/${id}`).set(H(t));
        expect(r.body.data.vendor).toMatchObject({ lat: 14.7945, lng: -16.959, hasLocation: true });
      }
      const list = await request.get('/api/orders').set(H(tClient));
      const row = list.body.data.find((o: any) => o.id === id);
      expect(row.dropoff).toEqual(want);
      expect(row.vendor.hasLocation).toBe(true);
    });

    test('an address without a pin gives dropoff null (and the text is still shown)', async () => {
      const placed = await place({ dropoffHostel: 'Thiès Nord' });
      const r = await request.get(`/api/orders/${placed.body.data.id}`).set(H(tClient));
      expect(r.status).toBe(200);
      expect(r.body.data.dropoffHostel).toBe('Thiès Nord');
      expect(r.body.data.dropoff).toBeNull();
    });

    test('another customer still cannot see the order', async () => {
      const placed = await place({ dropoffHostel: 'Thiès Nord' });
      expect((await request.get(`/api/orders/${placed.body.data.id}`).set(H(tCampusClient))).status).toBe(404);
    });
  });

  // ------------------------------------------------------------------------------------------ migration
  describe('migration 20261006_campus_dropoints', () => {
    const file = path.resolve(__dirname, '../../prisma/migrations/20261006_campus_dropoints/migration.sql');
    const sql = fs.readFileSync(file, 'utf8');
    const statements = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean);

    test('is data-only, short and uses a lock timeout', () => {
      expect(statements[0]).toBe('BEGIN');
      expect(statements[statements.length - 1]).toBe('COMMIT');
      expect(sql).toMatch(/SET LOCAL lock_timeout/);
      expect(statements.join(";")).not.toMatch(/\b(ALTER|DROP|CREATE|TRUNCATE|DELETE|INSERT)\b/i);
      expect(statements.filter((s) => s.startsWith('UPDATE'))).toHaveLength(2);
    });

    test('rewrites legacy rows, leaves everything else (and updatedAt) alone, and can run twice', async () => {
      const marker = 'campus-mig-';
      const legacyUsers: [string, string | null, string | null][] = [
        ['a1', 'Block 3', 'BH3'], ['a2', 'Boys Hostel Block 1', 'BH1'], ['a3', 'Girls Gate 2', 'GH2'], ['a4', 'Girls Hostel Gate 1', 'GH1'],
        ['a5', 'VIT Main Gate', 'VIT Main Gate'], ['a6', 'BH5', 'BH5'], ['a7', '  boys   HOSTEL block  6 ', 'BH6'], ['a8', 'Block 7', 'Block 7'],
        ['a9', null, null], ['b1', 'Special Block', 'Special Block'], ['b2', 'Girls Gate 3', 'Girls Gate 3'], ['b3', 'GIRLS gate 1', 'GH1'],
        ['b4', 'Block 12', 'Block 12'], ['b5', 'block 2', 'BH2'], ['b6', 'Unknown', 'Unknown'],
      ];
      const old = new Date('2026-01-01T00:00:00Z');
      await prisma.user.createMany({ data: legacyUsers.map(([k, hb], i) => ({ id: marker + k, name: `Mig ${k}`, phone: `+221 7799${String(80000 + i).slice(-5)}`, role: Role.CLIENT, hostelBlock: hb })) });
      const orderRows = legacyUsers.filter(([, hb]) => hb !== null);
      await prisma.order.createMany({
        data: orderRows.map(([k, hb]) => ({ id: marker + 'o-' + k, customerId: CLIENT.id, vendorId: 'ven-1', dropoffHostel: hb as string, totalAmount: 100, status: 'CANCELLED' as const, createdAt: old, updatedAt: old })),
      });
      try {
        const run = () => prisma.$transaction(statements.filter((s) => s.startsWith('UPDATE')).map((s) => prisma.$executeRawUnsafe(s)));
        const [u1, o1] = await run();
        expect(u1).toBeGreaterThanOrEqual(7); // the 7 legacy users above that change (other rows in this DB may match too)
        expect(o1).toBeGreaterThanOrEqual(7);
        for (const [k, , want] of legacyUsers) {
          const u = await prisma.user.findUniqueOrThrow({ where: { id: marker + k } });
          expect([k, u.hostelBlock]).toEqual([k, want]);
        }
        for (const [k, , want] of orderRows) {
          const o = await prisma.order.findUniqueOrThrow({ where: { id: marker + 'o-' + k } });
          expect([k, o.dropoffHostel]).toEqual([k, want]);
          expect(o.updatedAt.toISOString()).toBe(old.toISOString());
        }
        const [u2, o2] = await run();
        expect([u2, o2]).toEqual([0, 0]); // second run changes nothing
      } finally {
        await prisma.order.deleteMany({ where: { id: { startsWith: marker } } });
        await prisma.user.deleteMany({ where: { id: { startsWith: marker } } });
      }
    });
  });

  // ------------------------------------------------------------------------------------------ vendor location
  describe('PATCH /api/admin/vendors/:id/location', () => {
    const patch = (body: unknown, id = 'ven-1', token = tAdmin) => request.patch(`/api/admin/vendors/${id}/location`).set(H(token)).send(body as object);

    test('needs an admin', async () => {
      expect((await request.patch('/api/admin/vendors/ven-1/location').send({ lat: 14.7945, lng: -16.959 })).status).toBe(401);
      for (const t of [tClient, tVendor, tRider]) expect((await patch({ lat: 14.7945, lng: -16.959 }, 'ven-1', t)).status).toBe(403);
      const v = await prisma.vendor.findUniqueOrThrow({ where: { id: 'ven-1' } });
      expect([v.lat, v.lng]).toEqual([PLACEHOLDER.lat, PLACEHOLDER.lng]);
    });

    test('sets the pin, answers hasLocation and writes an audit entry', async () => {
      const res = await patch({ lat: 14.7945, lng: -16.959 });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ success: true, data: { id: 'ven-1', lat: 14.7945, lng: -16.959, hasLocation: true } });
      const v = await prisma.vendor.findUniqueOrThrow({ where: { id: 'ven-1' } });
      expect([v.lat, v.lng]).toEqual([14.7945, -16.959]);
      const audit = await prisma.adminAuditLog.findFirst({ where: { action: 'VENDOR_LOCATION_SET', targetId: 'ven-1' }, orderBy: { createdAt: 'desc' } });
      expect(audit).not.toBeNull();
      expect(audit!.targetType).toBe('VENDOR');
      expect(audit!.summary).toContain('14.794500');
      // the admin vendor list carries hasLocation
      const list = await request.get('/api/vendors').set(H(tAdmin));
      expect(list.body.data.find((x: any) => x.id === 'ven-1')).toMatchObject({ lat: 14.7945, lng: -16.959, hasLocation: true });
    });

    test('setting the placeholder pin back reports hasLocation false', async () => {
      const res = await patch(PLACEHOLDER);
      expect(res.status).toBe(200);
      expect(res.body.data.hasLocation).toBe(false);
    });

    test.each([
      ['strings', { lat: '14.7945', lng: '-16.959' }, 'lat'],
      ['missing lat', { lng: -16.959 }, 'lat'],
      ['missing lng', { lat: 14.7945 }, 'lng'],
      ['null', { lat: null, lng: null }, 'lat'],
      ['lat too big', { lat: 91, lng: -16.959 }, 'lat'],
      ['lat too small', { lat: -91, lng: -16.959 }, 'lat'],
      ['lng too big', { lat: 14.7945, lng: 181 }, 'lng'],
      ['lng too small', { lat: 14.7945, lng: -181 }, 'lng'],
      ['Paris (outside Senegal)', { lat: 48.8566, lng: 2.3522 }, 'location'],
      ['Bamako (outside Senegal)', { lat: 12.6392, lng: -8.0029 }, 'location'],
      ['0,0', { lat: 0, lng: 0 }, 'location'],
      ['empty body', {}, 'lat'],
    ])('rejects %s', async (_n, body, field) => {
      const res = await patch(body);
      expect(res.status).toBe(400);
      expect(res.body.field).toBe(field);
      const v = await prisma.vendor.findUniqueOrThrow({ where: { id: 'ven-1' } });
      expect([v.lat, v.lng]).toEqual([PLACEHOLDER.lat, PLACEHOLDER.lng]);
    });

    test('an array / non-object body or unknown / malformed id is refused', async () => {
      expect((await patch([1, 2])).status).toBe(400);
      expect((await patch({ lat: 14.7945, lng: -16.959 }, 'no-such-vendor')).status).toBe(404);
      expect((await patch({ lat: 14.7945, lng: -16.959 }, 'bad%20id')).status).toBe(400);
    });

    test('creating a vendor validates the same way (POST /api/vendors and POST /api/admin/partners)', async () => {
      const bad = await request.post('/api/vendors').set(H(tAdmin)).send({ name: 'Far Cafe', lat: 48.8566, lng: 2.3522 });
      expect(bad.status).toBe(400);
      expect(bad.body.field).toBe('location');
      expect((await request.post('/api/vendors').set(H(tAdmin)).send({ name: 'Half Cafe', lat: 14.7945 })).status).toBe(400);
      expect((await request.post('/api/vendors').set(H(tAdmin)).send({ name: 'Str Cafe', lat: '14.7945', lng: '-16.959' })).status).toBe(400);
      const ok = await request.post('/api/vendors').set(H(tAdmin)).send({ name: 'Thies Cafe', lat: 14.7945, lng: -16.959 });
      expect(ok.status).toBe(201);
      expect(ok.body.data).toMatchObject({ lat: 14.7945, lng: -16.959 });
      const noPin = await request.post('/api/vendors').set(H(tAdmin)).send({ name: 'No Pin Cafe' });
      expect(noPin.status).toBe(201);
      expect(noPin.body.data).toMatchObject({ lat: PLACEHOLDER.lat, lng: PLACEHOLDER.lng });

      const partner = (extra: object, phone: string) => request.post('/api/admin/partners').set(H(tAdmin)).send({
        role: 'VENDOR', name: 'Owner Name', phone, password: 'Str0ng-Passw0rd!', restaurantName: 'Pin Kitchen', category: 'Rolls', address: 'Near Escale', ...extra,
      });
      const farPartner = await partner({ lat: 48.8566, lng: 2.3522 }, '779877101');
      expect(farPartner.status).toBe(400);
      expect(farPartner.body.field).toBe('location');
      const okPartner = await partner({ lat: 14.7945, lng: -16.959 }, '779877102');
      expect(okPartner.status).toBe(201);
      const created = await prisma.vendor.findUniqueOrThrow({ where: { id: okPartner.body.profileId } });
      expect([created.lat, created.lng]).toEqual([14.7945, -16.959]);
      const plain = await partner({}, '779877103');
      expect(plain.status).toBe(201);
      const plainV = await prisma.vendor.findUniqueOrThrow({ where: { id: plain.body.profileId } });
      expect([plainV.lat, plainV.lng]).toEqual([PLACEHOLDER.lat, PLACEHOLDER.lng]);

      await prisma.vendor.deleteMany({ where: { id: { in: [ok.body.data.id, noPin.body.data.id, okPartner.body.profileId, plain.body.profileId] } } });
    });
  });

  // ------------------------------------------------------------------------------------------ rider locations
  describe('rider locations', () => {
    const postLoc = (lat = 14.7935, lng = -16.959, token = tRider) => request.post('/api/drivers/location').set(H(token)).send({ lat, lng, heading: 45 });

    test('GET /api/drivers/locations (admin) returns duty status, approval status and lastUpdated', async () => {
      expect((await postLoc()).status).toBe(200);
      const res = await request.get('/api/drivers/locations').set(H(tAdmin));
      expect(res.status).toBe(200);
      const row = res.body.data.find((r: any) => r.driverId === RIDER.id);
      expect(row).toMatchObject({ driverId: RIDER.id, lat: 14.7935, lng: -16.959, heading: 45, dutyStatus: 'ONLINE', approvalStatus: 'APPROVED' });
      expect(typeof row.lastUpdated).toBe('string');
      expect(Number.isNaN(Date.parse(row.lastUpdated))).toBe(false);

      await prisma.driverPartner.updateMany({ where: { userId: RIDER.id }, data: { dutyStatus: 'OFFLINE' } });
      const off = await request.get('/api/drivers/locations').set(H(tAdmin));
      expect(off.body.data.find((r: any) => r.driverId === RIDER.id).dutyStatus).toBe('OFFLINE');
    });

    test('a rider only gets their own row; clients and vendors get none of anyone elses', async () => {
      await postLoc();
      const own = await request.get('/api/drivers/locations').set(H(tRider));
      expect(own.body.data.every((r: any) => r.driverId === RIDER.id)).toBe(true);
      const stu = await request.get('/api/drivers/locations').set(H(tClient));
      expect(stu.body.data).toEqual([]);
      expect((await request.get('/api/drivers/locations')).status).toBe(401);
    });

    test('admins see a position broadcast while the rider is on duty (event now also carries id + duty status)', async () => {
      const admin = await connect(tAdmin);
      expect((await admin.emitWithAck('join_room', 'admins')).ok).toBe(true);
      const got: any[] = [];
      admin.on('driver_location_update', (d: any) => got.push(d));
      expect((await postLoc(14.7936, -16.9591)).status).toBe(200);
      await sleep(300);
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ driverId: RIDER.id, id: RIDER.id, lat: 14.7936, lng: -16.9591, dutyStatus: 'ONLINE', approvalStatus: 'APPROVED' });

      await prisma.driverPartner.updateMany({ where: { userId: RIDER.id }, data: { dutyStatus: 'IN_TRANSIT' } });
      expect((await postLoc(14.7937, -16.9592)).status).toBe(200);
      await sleep(300);
      expect(got).toHaveLength(2);
      expect(got[1].dutyStatus).toBe('IN_TRANSIT');
    });

    test('a position that arrives after going OFFLINE is stored but not broadcast to admins', async () => {
      const admin = await connect(tAdmin);
      await admin.emitWithAck('join_room', 'admins');
      const got: any[] = [];
      admin.on('driver_location_update', (d: any) => got.push(d));
      await prisma.driverPartner.updateMany({ where: { userId: RIDER.id }, data: { dutyStatus: 'OFFLINE' } });
      const res = await postLoc(14.7931, -16.9581);
      expect(res.status).toBe(200);
      await sleep(400);
      expect(got).toHaveLength(0);
      const stored = await prisma.driverLocation.findUniqueOrThrow({ where: { driverId: RIDER.id } });
      expect([stored.lat, stored.lng]).toEqual([14.7931, -16.9581]);

      // the socket path behaves the same
      const riderSock = await connect(tRider);
      riderSock.emit('update_driver_location', { lat: 14.7932, lng: -16.9582, heading: 1 });
      await sleep(400);
      expect(got).toHaveLength(0);
      expect((await prisma.driverLocation.findUniqueOrThrow({ where: { driverId: RIDER.id } })).lat).toBe(14.7932);
    });

    test('tracking visibility is unchanged: the customer of an active order still gets rider_location, other customers and vendors never', async () => {
      const placed = await place({ dropoffHostel: 'Cité Lamy' });
      const id = placed.body.data.id as string;
      await prisma.order.update({ where: { id }, data: { paymentStatus: 'PAID', paidAt: new Date(), status: 'PICKED_UP', driverId: RIDER.id } });
      const owner = await connect(tClient);
      const other = await connect(tCampusClient);
      const vend = await connect(tVendor);
      const ownerGot: any[] = [];
      const otherGot: any[] = [];
      const vendGot: any[] = [];
      owner.on('rider_location', (d: any) => ownerGot.push(d));
      other.on('rider_location', (d: any) => otherGot.push(d));
      vend.on('rider_location', (d: any) => vendGot.push(d));
      expect((await owner.emitWithAck('join_room', `order_${id}`)).ok).toBe(true);
      expect((await other.emitWithAck('join_room', `order_${id}`)).ok).toBe(false);
      await vend.emitWithAck('join_room', `order_${id}`);
      expect((await postLoc(14.7934, -16.9590)).status).toBe(200);
      await sleep(400);
      expect(ownerGot).toHaveLength(1);
      expect(ownerGot[0]).toMatchObject({ orderId: id, driverId: RIDER.id, lat: 14.7934, lng: -16.959 });
      expect(otherGot).toHaveLength(0);
      expect(vendGot).toHaveLength(0);
    });
  });
});
