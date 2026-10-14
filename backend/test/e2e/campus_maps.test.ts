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
import { getStudentToken, getVendorToken, getDriverToken, getAdminToken, getAuthHeader } from '../harness/auth';
import { connectTestSocket, disconnectTestSocket } from '../harness/socket';
import {
  DROP_POINTS, CAMPUS_CENTER, normalizeDropPoint, dropPointCoords, isNearCampus, vendorHasLocation, distanceKm, checkVendorLocation,
} from '../../src/config/campus';

jest.setTimeout(30_000);

const STUDENT = { id: 'usr-1', phone: '+221 776543210' };
const CAMPUS_STUDENT = { id: 'usr-campus-stu', phone: '+221 779877001' };
const VENDOR = { id: 'usr-3', phone: '+221 776543212' };
const RIDER = { id: 'usr-4', phone: '+221 776543213' };
const ADMIN = { id: 'usr-5', phone: '+221 776543214' };
const tStudent = getStudentToken(STUDENT.id, STUDENT.phone);
const tCampusStudent = getStudentToken(CAMPUS_STUDENT.id, CAMPUS_STUDENT.phone);
const tVendor = getVendorToken(VENDOR.id, VENDOR.phone);
const tRider = getDriverToken(RIDER.id, RIDER.phone);
const tAdmin = getAdminToken(ADMIN.id, ADMIN.phone);
const H = getAuthHeader;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const CANON = ['Escale', 'Médina Fall', 'Grand Thiès', 'Cité Ndiaye', 'Dixième', 'Randoulène', 'Thiès Nord', 'Parcelles Assainies', 'Keur Mame El Hadji', 'Cité Lamy', 'Thiès Sud', 'Nguinth', 'Mbour 1', 'Diakhao'];

// ---------------------------------------------------------------------------------------------------------------
describe('campus.ts (pure)', () => {
  test('the drop point list is exactly the table of quartiers, in order', () => {
    expect(DROP_POINTS.map((p) => p.name)).toEqual(CANON);
    expect(DROP_POINTS.every((p) => p.id === p.name)).toBe(true);
    expect(DROP_POINTS.filter((p) => p.group === 'centre').map((p) => p.name)).toEqual(['Escale', 'Médina Fall', 'Grand Thiès', 'Cité Ndiaye', 'Dixième']);
    expect(DROP_POINTS.filter((p) => p.group === 'nord')).toHaveLength(4);
    expect(DROP_POINTS.filter((p) => p.group === 'sud')).toHaveLength(5);
    expect(dropPointCoords('Escale')).toEqual({ lat: 14.7886, lng: -16.926 });
    expect(dropPointCoords('Thiès Nord')).toEqual({ lat: 14.8066, lng: -16.928 });
    expect(dropPointCoords('thies nord')).toEqual(dropPointCoords('Thiès Nord'));
    expect(dropPointCoords('Gare de Dakar')).toBeNull();
  });

  test('every quartier has its own pin and the centre is the mean of the pins, close to Escale', () => {
    expect(new Set(DROP_POINTS.map((p) => `${p.lat},${p.lng}`)).size).toBe(DROP_POINTS.length);
    expect(CAMPUS_CENTER.lat).toBeCloseTo(DROP_POINTS.reduce((s, p) => s + p.lat, 0) / DROP_POINTS.length, 9);
    expect(CAMPUS_CENTER.lng).toBeCloseTo(DROP_POINTS.reduce((s, p) => s + p.lng, 0) / DROP_POINTS.length, 9);
    expect(distanceKm(CAMPUS_CENTER, { lat: 14.7886, lng: -16.926 })).toBeLessThan(1.5);
  });

  const accepted: [unknown, string][] = [
    ...CANON.map((n) => [n, n] as [unknown, string]),
    ['escale', 'Escale'], ['ESCALE', 'Escale'], ['  Escale  ', 'Escale'],
    // accents, case, hyphens and extra spaces are ignored
    ['thies nord', 'Thiès Nord'], ['THIES NORD', 'Thiès Nord'], ['Thiès-Nord', 'Thiès Nord'], ['thies   sud', 'Thiès Sud'],
    ['randoulene', 'Randoulène'], ['RANDOULÈNE', 'Randoulène'], ['cite lamy', 'Cité Lamy'], ['Cité-Lamy', 'Cité Lamy'], ['cite_ndiaye', 'Cité Ndiaye'],
    ['medina fall', 'Médina Fall'], ['grand thies', 'Grand Thiès'], ['dixieme', 'Dixième'], ['keur mame el hadji', 'Keur Mame El Hadji'],
    ['parcelles  assainies', 'Parcelles Assainies'], ['mbour 1', 'Mbour 1'], ['DIAKHAO', 'Diakhao'], ['Block\t3'.replace('Block\t3', 'Mbour\t1'), 'Mbour 1'],
  ];
  test.each(accepted)('accepts %j -> %j', (raw, canonical) => {
    expect(normalizeDropPoint(raw)).toBe(canonical);
    expect(normalizeDropPoint(canonical)).toBe(canonical); // idempotent
  });

  const rejected: unknown[] = [
    'Gare de Dakar', 'gare de dakar', 'Dakar', 'Mbour 0', 'Mbour 2', 'Mbour', 'Thiès', 'Thies Est', 'Randoulene Sud', 'Escale2', 'Esc ale',
    'BH1', 'Block 1', 'Boys Hostel Block 3', 'Girls Gate 1', '', '   ', 'Library', 'Escale; DROP TABLE', 'Escale\nCité Lamy',
    'x'.repeat(500), null, undefined, 2, true, {}, ['Escale'],
  ];
  test.each(rejected.map((r) => [typeof r === 'string' ? r.slice(0, 30) : r, r]))('rejects %j', (_label, raw) => {
    expect(normalizeDropPoint(raw)).toBeNull();
    expect(dropPointCoords(raw)).toBeNull();
  });

  test('isNearCampus: 8 km around the centre of Thies, only real numbers', () => {
    expect(isNearCampus(14.79, -16.93)).toBe(true);
    expect(isNearCampus(CAMPUS_CENTER.lat, CAMPUS_CENTER.lng)).toBe(true);
    for (const p of DROP_POINTS) expect(isNearCampus(p.lat, p.lng)).toBe(true);
    expect(isNearCampus(14.7886, -16.926)).toBe(true); // the placeholder pin is in the zone (it is just not "real")
    expect(isNearCampus(14.6937, -17.4441)).toBe(false); // Dakar
    expect(isNearCampus(14.4167, -16.9667)).toBe(false); // Mbour
    expect(isNearCampus(23.0768, 76.8524)).toBe(false); // the old campus
    expect(isNearCampus(0, 0)).toBe(false);
    // ~7.9 km north is in, ~8.1 km north is out (1 deg lat ~ 111.19 km)
    expect(isNearCampus(CAMPUS_CENTER.lat + 7.9 / 111.19, CAMPUS_CENTER.lng)).toBe(true);
    expect(isNearCampus(CAMPUS_CENTER.lat + 8.1 / 111.19, CAMPUS_CENTER.lng)).toBe(false);
    expect(distanceKm(CAMPUS_CENTER, { lat: CAMPUS_CENTER.lat + 1 / 111.19, lng: CAMPUS_CENTER.lng })).toBeCloseTo(1, 1);
    for (const bad of [NaN, Infinity, '14.79', null, undefined, 91, -91]) expect(isNearCampus(bad, -16.93)).toBe(false);
    expect(isNearCampus(14.79, 181)).toBe(false);
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
    expect(checkVendorLocation(14.6937, -17.4441)).toMatchObject({ ok: false, field: 'location' });
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

  const place = (extra: Record<string, unknown> = {}, token = tStudent) =>
    request.post('/api/orders').set(H(token)).send({ vendorId: 'ven-1', items: [{ itemId: 'item-1', quantity: 1 }], clientRequestId: randomUUID(), ...extra });
  const setPin = (lat: number, lng: number) => prisma.vendor.update({ where: { id: 'ven-1' }, data: { lat, lng } });
  const PLACEHOLDER = { lat: 14.7886, lng: -16.926 };

  beforeAll(async () => {
    await cleanTestOrders();
    await cleanTestUsers();
    await seedTestDatabase();
    await prisma.adminAuditLog.deleteMany({});
    await prisma.user.update({ where: { id: STUDENT.id }, data: { hostelBlock: 'Randoulène', isStudent: true } });
    await prisma.user.upsert({
      where: { id: CAMPUS_STUDENT.id },
      update: { hostelBlock: 'cite lamy', isStudent: true },
      create: { id: CAMPUS_STUDENT.id, name: 'Meera Campus', phone: CAMPUS_STUDENT.phone, role: Role.STUDENT, isStudent: true, avatarId: 3, hostelBlock: 'cite lamy' },
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
    await prisma.user.update({ where: { id: STUDENT.id }, data: { hostelBlock: 'Randoulène' } });
    await stopTestServer(server);
  });

  // ------------------------------------------------------------------------------------------ GET /api/campus
  describe('GET /api/campus', () => {
    test('needs a login', async () => {
      expect((await request.get('/api/campus')).status).toBe(401);
    });

    test.each([['student', tStudent], ['vendor', tVendor], ['rider', tRider], ['admin', tAdmin]])('%s gets the 14 quartiers and the centre', async (_r, token) => {
      const res = await request.get('/api/campus').set(H(token));
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.headers['cache-control']).toMatch(/max-age=300/);
      expect(res.body.data.center).toEqual({ lat: CAMPUS_CENTER.lat, lng: CAMPUS_CENTER.lng });
      expect(res.body.data.dropPoints).toHaveLength(14);
      expect(res.body.data.city).toBe('Thiès');
      expect(res.body.data.dropPoints.map((p: any) => p.name)).toEqual(CANON);
      expect(res.body.data.dropPoints[0]).toEqual({ id: 'Escale', name: 'Escale', group: 'centre', lat: 14.7886, lng: -16.926 });
      expect(res.body.data.dropPoints[13]).toEqual({ id: 'Diakhao', name: 'Diakhao', group: 'sud', lat: 14.7726, lng: -16.938 });
    });
  });

  // ------------------------------------------------------------------------------------------ order create
  describe('order creation stores the canonical drop point', () => {
    test.each([
      ['cite lamy', 'Cité Lamy'], ['  thies   nord ', 'Thiès Nord'], ['RANDOULENE', 'Randoulène'], ['Médina Fall', 'Médina Fall'],
      ['keur-mame-el-hadji', 'Keur Mame El Hadji'], ['Mbour 1', 'Mbour 1'], ['grand thies', 'Grand Thiès'], ['diakhao', 'Diakhao'],
    ])('%j is saved as %j', async (input, canonical) => {
      const res = await place({ dropoffHostel: input });
      expect(res.status).toBe(201);
      expect(res.body.data.dropoffHostel).toBe(canonical);
      expect(res.body.data.dropoff).toEqual({ name: canonical, ...dropPointCoords(canonical)! });
      const row = await prisma.order.findUniqueOrThrow({ where: { id: res.body.data.id } });
      expect(row.dropoffHostel).toBe(canonical);
    });

    test.each(['Gare de Dakar', 'Mbour 9', 'Block 2', 'Library', '', 'BH9'])('%j is refused with the same message and field as before', async (input) => {
      const res = await place({ dropoffHostel: input });
      expect(res.status).toBe(400);
      expect(res.body.field).toBe('dropoffHostel');
      expect(res.body.message).toBe('Choose one of the delivery quartiers.');
    });

    test('a non-string drop point is refused', async () => {
      for (const v of [5, {}, ['Escale'], true]) expect((await place({ dropoffHostel: v })).status).toBe(400);
    });

    test('no drop point in the request falls back to the profile one (legacy text normalised)', async () => {
      const res = await place({}); // usr-1 profile: "Randoulène"
      expect(res.status).toBe(201);
      expect(res.body.data.dropoffHostel).toBe('Randoulène');
      const r2 = await place({}, tCampusStudent); // "cite lamy"
      expect(r2.body.data.dropoffHostel).toBe('Cité Lamy');
    });

    test('a profile without a usable drop point cannot order without choosing one', async () => {
      await prisma.user.update({ where: { id: CAMPUS_STUDENT.id }, data: { hostelBlock: 'Gare de Dakar' } });
      try {
        const res = await place({}, tCampusStudent);
        expect(res.status).toBe(400);
        expect(res.body.field).toBe('dropoffHostel');
      } finally {
        await prisma.user.update({ where: { id: CAMPUS_STUDENT.id }, data: { hostelBlock: 'cite lamy' } });
      }
    });

    test('idempotent replay compares canonical names (any spelling of a quartier is the same place)', async () => {
      const clientRequestId = randomUUID();
      const first = await place({ dropoffHostel: 'cite lamy', clientRequestId });
      expect(first.status).toBe(201);
      const again = await place({ dropoffHostel: 'Cité Lamy', clientRequestId });
      expect(again.status).toBe(200);
      expect(again.body.idempotentReplay).toBe(true);
      expect(again.body.data.id).toBe(first.body.data.id);
      const third = await place({ dropoffHostel: 'CITÉ-LAMY', clientRequestId });
      expect(third.status).toBe(200);
      expect(third.body.data.id).toBe(first.body.data.id);
    });

    test('replay of an order whose stored text is another spelling of the quartier still matches', async () => {
      const clientRequestId = randomUUID();
      const first = await place({ dropoffHostel: 'Cité Lamy', clientRequestId });
      await prisma.order.update({ where: { id: first.body.data.id }, data: { dropoffHostel: 'cite lamy' } });
      const again = await place({ dropoffHostel: 'Cité Lamy', clientRequestId });
      expect(again.status).toBe(200);
      expect(again.body.data.id).toBe(first.body.data.id);
      const legacy = await place({ dropoffHostel: 'cite lamy', clientRequestId });
      expect(legacy.status).toBe(200);
      expect(legacy.body.data.id).toBe(first.body.data.id);
    });

    test('the same request id with a DIFFERENT drop point is still a mismatch', async () => {
      const clientRequestId = randomUUID();
      expect((await place({ dropoffHostel: 'Cité Lamy', clientRequestId })).status).toBe(201);
      const other = await place({ dropoffHostel: 'Randoulène', clientRequestId });
      expect(other.status).toBe(409);
      expect(other.body.code).toBe('CLIENT_REQUEST_MISMATCH');
    });
  });

  // ------------------------------------------------------------------------------------------ profile
  describe('profile update stores the canonical drop point', () => {
    const put = (body: object, token = tCampusStudent) => request.put('/api/auth/profile').set(H(token)).send(body);
    afterEach(async () => { await prisma.user.update({ where: { id: CAMPUS_STUDENT.id }, data: { hostelBlock: 'cite lamy', isStudent: true } }); });

    test.each([['randoulene', 'Randoulène'], ['Médina Fall', 'Médina Fall'], ['thies sud', 'Thiès Sud'], [' parcelles   assainies ', 'Parcelles Assainies'], ['Mbour 1', 'Mbour 1']])('%j -> %j', async (input, canonical) => {
      const res = await put({ hostelBlock: input });
      expect(res.status).toBe(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: CAMPUS_STUDENT.id } })).hostelBlock).toBe(canonical);
    });

    test.each(['Gare de Dakar', 'Mbour 9', 'Nowhere', ''])('%j is refused (field hostelBlock)', async (input) => {
      const res = await put({ hostelBlock: input });
      expect(res.status).toBe(400);
      expect(res.body.field).toBe('hostelBlock');
      expect(res.body.message).toBe('Choose one of the delivery quartiers.');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: CAMPUS_STUDENT.id } })).hostelBlock).toBe('cite lamy'); // untouched
    });

    test('any customer chooses a quartier: being a student does not matter in Thiès', async () => {
      const res = await put({ isStudent: false, hostelBlock: 'Thiès Nord' });
      expect(res.status).toBe(200);
      expect((await prisma.user.findUniqueOrThrow({ where: { id: CAMPUS_STUDENT.id } })).hostelBlock).toBe('Thiès Nord');
    });
  });

  // ------------------------------------------------------------------------------------------ OrderView
  describe('OrderView: dropoff and vendor.hasLocation', () => {
    test('every viewer sees dropoff exactly where they see dropoffHostel; hasLocation follows the vendor pin', async () => {
      const placed = await place({ dropoffHostel: 'Cité Ndiaye' });
      const id = placed.body.data.id as string;
      const want = { name: 'Cité Ndiaye', ...dropPointCoords('Cité Ndiaye')! };
      expect(placed.body.data.dropoff).toEqual(want);
      expect(placed.body.data.vendor.hasLocation).toBe(false); // placeholder pin
      expect(placed.body.data.vendor.lat).toBe(PLACEHOLDER.lat);

      // pay it so the vendor and the rider pool can see it (direct DB, the payment flow has its own tests)
      await prisma.order.update({ where: { id }, data: { paymentStatus: 'PAID', paidAt: new Date(), status: 'ACCEPTED' } });
      const asAdmin = await request.get(`/api/orders/${id}`).set(H(tAdmin));
      const asVendor = await request.get(`/api/orders/${id}`).set(H(tVendor));
      const asPoolRider = await request.get(`/api/orders/${id}`).set(H(tRider));
      for (const r of [asAdmin, asVendor, asPoolRider]) {
        expect(r.status).toBe(200);
        expect(r.body.data.dropoff).toEqual(want);
        expect(r.body.data.dropoffHostel).toBe('Cité Ndiaye');
        expect(r.body.data.vendor.hasLocation).toBe(false);
      }
      expect(asAdmin.body.data.vendor).toHaveProperty('hasLocation', false);

      await setPin(14.7945, -16.959);
      for (const t of [tStudent, tAdmin, tVendor, tRider]) {
        const r = await request.get(`/api/orders/${id}`).set(H(t));
        expect(r.body.data.vendor).toMatchObject({ lat: 14.7945, lng: -16.959, hasLocation: true });
      }
      // the list endpoint uses the same view
      const list = await request.get('/api/orders').set(H(tStudent));
      const row = list.body.data.find((o: any) => o.id === id);
      expect(row.dropoff).toEqual(want);
      expect(row.vendor.hasLocation).toBe(true);
    });

    test('a stored value that cannot be normalised gives dropoff null (and the text is still shown)', async () => {
      const placed = await place({ dropoffHostel: 'Thiès Nord' });
      const id = placed.body.data.id as string;
      await prisma.order.update({ where: { id }, data: { dropoffHostel: 'Gare de Dakar' } });
      const r = await request.get(`/api/orders/${id}`).set(H(tStudent));
      expect(r.status).toBe(200);
      expect(r.body.data.dropoffHostel).toBe('Gare de Dakar');
      expect(r.body.data.dropoff).toBeNull();
    });

    test('another spelling stored in the row is normalised in dropoff (not rewritten in dropoffHostel)', async () => {
      const placed = await place({ dropoffHostel: 'Dixième' });
      const id = placed.body.data.id as string;
      await prisma.order.update({ where: { id }, data: { dropoffHostel: 'dixieme' } });
      const r = await request.get(`/api/orders/${id}`).set(H(tStudent));
      expect(r.body.data.dropoffHostel).toBe('dixieme');
      expect(r.body.data.dropoff).toEqual({ name: 'Dixième', ...dropPointCoords('Dixième')! });
    });

    test('another customer still cannot see the order', async () => {
      const placed = await place({ dropoffHostel: 'Thiès Nord' });
      expect((await request.get(`/api/orders/${placed.body.data.id}`).set(H(tCampusStudent))).status).toBe(404);
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
      await prisma.user.createMany({ data: legacyUsers.map(([k, hb], i) => ({ id: marker + k, name: `Mig ${k}`, phone: `+221 7799${String(80000 + i).slice(-5)}`, role: Role.STUDENT, hostelBlock: hb })) });
      const orderRows = legacyUsers.filter(([, hb]) => hb !== null);
      await prisma.order.createMany({
        data: orderRows.map(([k, hb]) => ({ id: marker + 'o-' + k, customerId: STUDENT.id, vendorId: 'ven-1', dropoffHostel: hb as string, totalAmount: 100, status: 'CANCELLED' as const, createdAt: old, updatedAt: old })),
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
      for (const t of [tStudent, tVendor, tRider]) expect((await patch({ lat: 14.7945, lng: -16.959 }, 'ven-1', t)).status).toBe(403);
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
      ['Dakar (not in the delivery zone)', { lat: 14.6937, lng: -17.4441 }, 'location'],
      ['Mbour (about 60 km)', { lat: 14.4167, lng: -16.9667 }, 'location'],
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
      const bad = await request.post('/api/vendors').set(H(tAdmin)).send({ name: 'Far Cafe', lat: 14.69, lng: -17.44 });
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
      const farPartner = await partner({ lat: 14.69, lng: -17.44 }, '779877101');
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

    test('a rider only gets their own row; students and vendors get none of anyone elses', async () => {
      await postLoc();
      const own = await request.get('/api/drivers/locations').set(H(tRider));
      expect(own.body.data.every((r: any) => r.driverId === RIDER.id)).toBe(true);
      const stu = await request.get('/api/drivers/locations').set(H(tStudent));
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
      const owner = await connect(tStudent);
      const other = await connect(tCampusStudent);
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
