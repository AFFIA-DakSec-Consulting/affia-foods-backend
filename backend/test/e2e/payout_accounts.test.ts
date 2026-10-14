/**
 * Payout details (Docs/21 phase 2): partner and admin endpoints, masking, role isolation, encryption at rest, audit, rate limits.
 * Real PostgreSQL, real HTTP endpoints.
 */
import { randomBytes } from 'crypto';
import supertest from 'supertest';
import { Role } from '@prisma/client';
import { startTestServer, stopTestServer, TestServerInstance } from '../harness/app';
import { prisma, seedTestDatabase, cleanTestOrders, cleanTestUsers } from '../harness/db';
import { getStudentToken, getVendorToken, getDriverToken, getAdminToken, getAuthHeader } from '../harness/auth';
import { __resetRateLimits } from '../../src/middleware/rateLimit';
import { decryptSecret } from '../../src/services/payoutCrypto';

jest.setTimeout(60_000);

const KEY = randomBytes(32).toString('base64');
const STUDENT = { id: 'usr-1', phone: '+221 776543210' };
const ADMIN = { id: 'usr-5', phone: '+221 776543214' };
const V1 = { id: 'usr-pa-v1', phone: '+221 779871111', vendorId: 'pa-ven-1' };
const V2 = { id: 'usr-pa-v2', phone: '+221 779872222', vendorId: 'pa-ven-2' };
const D1 = { id: 'usr-pa-d1', phone: '+221 779873333' };
const H = (t: string) => getAuthHeader(t);
const tStudent = getStudentToken(STUDENT.id, STUDENT.phone);
const tAdmin = getAdminToken(ADMIN.id, ADMIN.phone);
const tV1 = getVendorToken(V1.id, V1.phone);
const tV2 = getVendorToken(V2.id, V2.phone);
const tD1 = getDriverToken(D1.id, D1.phone);

const IBAN = 'SN08SN0100152000048500003035';
const BANK = { method: 'BANK', accountHolder: 'Ram Singh', accountNumber: 'sn08 sn01 0015 2000 0485 0000 3035', bankName: 'CBAO' };
const PARTNER_KEYS = ['accountHolder', 'accountLast4', 'bankName', 'method', 'phone', 'updatedAt', 'verifiedAt'];

describe('Payout accounts (phase 2)', () => {
  let server: TestServerInstance;
  let request: ReturnType<typeof supertest>;
  const put = (path: string, token: string, body: unknown) => request.put(path).set(H(token)).send(body as any);
  const get = (path: string, token: string) => request.get(path).set(H(token));

  beforeAll(async () => {
    process.env.PAYOUT_ENC_KEY = KEY;
    await cleanTestOrders();
    await cleanTestUsers();
    await seedTestDatabase();
    for (const u of [
      { id: V1.id, name: 'PA Owner One', phone: V1.phone, role: Role.VENDOR },
      { id: V2.id, name: 'PA Owner Two', phone: V2.phone, role: Role.VENDOR },
      { id: D1.id, name: 'PA Rider One', phone: D1.phone, role: Role.DRIVER },
    ]) await prisma.user.upsert({ where: { id: u.id }, update: u, create: u });
    for (const v of [V1, V2]) {
      await prisma.vendor.upsert({
        where: { id: v.vendorId },
        update: { userId: v.id, approvalStatus: 'APPROVED' },
        create: { id: v.vendorId, userId: v.id, name: `PA Kitchen ${v.vendorId.slice(-1)}`, category: 'Test', address: 'Gate', bannerImage: '', approvalStatus: 'APPROVED' },
      });
    }
    server = await startTestServer(0);
    request = supertest(server.app);
  });

  beforeEach(async () => {
    process.env.PAYOUT_ENC_KEY = KEY;
    for (const k of Object.keys(process.env)) if (k.startsWith('RL_')) delete process.env[k];
    __resetRateLimits();
    await prisma.payoutAccount.deleteMany({ where: { userId: { in: [V1.id, V2.id, D1.id] } } });
    await prisma.adminAuditLog.deleteMany({});
  });

  afterAll(async () => {
    for (const k of Object.keys(process.env)) if (k.startsWith('RL_')) delete process.env[k];
    delete process.env.PAYOUT_ENC_KEY;
    await prisma.payoutAccount.deleteMany({ where: { userId: { in: [V1.id, V2.id, D1.id] } } });
    await prisma.vendor.deleteMany({ where: { id: { in: [V1.vendorId, V2.vendorId] } } });
    await cleanTestUsers();
    await stopTestServer(server);
    await prisma.$disconnect();
  });

  test('partner starts with no account; a Wave save answers the exact shape', async () => {
    const empty = await get('/api/partner/payout-account', tV1);
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual({ success: true, data: null });
    const saved = await put('/api/partner/payout-account', tV1, { method: 'WAVE', phone: ' 77 123 45 67 ', accountHolder: 'Ram Singh' });
    expect(saved.status).toBe(200);
    expect(saved.body.success).toBe(true);
    expect(saved.body.changed).toBe(true);
    expect(Object.keys(saved.body.data).sort()).toEqual(PARTNER_KEYS);
    expect(saved.body.data).toMatchObject({ method: 'WAVE', phone: '+221 771234567', accountHolder: 'Ram Singh', accountLast4: null, bankName: null, verifiedAt: null });
    expect(typeof saved.body.data.updatedAt).toBe('string');
    const again = await get('/api/partner/payout-account', tV1);
    expect(again.body.data).toEqual(saved.body.data);
    expect(again.headers['cache-control']).toBe('no-store');
    const row = await prisma.payoutAccount.findUniqueOrThrow({ where: { userId: V1.id } });
    expect(row.partnerType).toBe('VENDOR');
    expect(row.accountNumberEnc).toBeNull();
  });

  test('a bank account is stored encrypted, answered masked, and the full number is nowhere in any partner response', async () => {
    const saved = await put('/api/partner/payout-account', tV1, BANK);
    expect(saved.status).toBe(200);
    expect(Object.keys(saved.body.data).sort()).toEqual(PARTNER_KEYS);
    expect(saved.body.data).toMatchObject({ method: 'BANK', phone: null, accountHolder: 'Ram Singh', accountLast4: '3035', bankName: 'CBAO', verifiedAt: null });
    const read = await get('/api/partner/payout-account', tV1);
    for (const res of [saved, read]) {
      expect(JSON.stringify(res.body)).not.toContain(IBAN);
      expect(JSON.stringify(res.body)).not.toMatch(/accountNumber|Enc/);
    }
    const row = await prisma.payoutAccount.findUniqueOrThrow({ where: { userId: V1.id } });
    expect(row.accountNumberEnc).toMatch(/^v1\./);
    expect(row.accountNumberEnc).not.toContain(IBAN);
    expect(row.accountLast4).toBe('3035');
    expect(decryptSecret(row.accountNumberEnc!, V1.id)).toBe(IBAN);
    // the whole row, serialised, never holds the number in clear
    expect(JSON.stringify(row)).not.toContain(IBAN);
    // not even the audit log
    const audits = await prisma.adminAuditLog.findMany({});
    expect(audits.length).toBeGreaterThan(0);
    expect(JSON.stringify(audits)).not.toContain(IBAN);
    expect(audits.map((a) => a.action)).toContain('PAYOUT_ACCOUNT_CHANGED');
  });

  test('without PAYOUT_ENC_KEY a bank account is refused with a clear 503, Wave still works, nothing is stored', async () => {
    delete process.env.PAYOUT_ENC_KEY;
    const bank = await put('/api/partner/payout-account', tV1, BANK);
    expect(bank.status).toBe(503);
    expect(bank.body).toMatchObject({ success: false, code: 'PAYOUT_ENCRYPTION_NOT_CONFIGURED' });
    expect(bank.body.message).toMatch(/not configured/i);
    expect(JSON.stringify(bank.body)).not.toContain(IBAN);
    expect(await prisma.payoutAccount.count({ where: { userId: V1.id } })).toBe(0);
    const wave = await put('/api/partner/payout-account', tV1, { method: 'WAVE', phone: '771234567' });
    expect(wave.status).toBe(200);
  });

  test('validation: every bad input is a 400 naming the field', async () => {
    const cases: [unknown, string][] = [
      [{ method: 'WAVE', phone: 'not a number' }, 'phone'],
      [{ method: 'ORANGE_MONEY', phone: '+91 9876543210' }, 'phone'],
      [{ method: 'WAVE' }, 'phone'],
      [{ method: 'BANK', accountHolder: 'Ram', accountNumber: '12345', bankName: 'CBAO' }, 'accountNumber'],
      [{ ...BANK, accountNumber: '1'.repeat(35) }, 'accountNumber'],
      [{ ...BANK, accountNumber: 'abc-defgh*ij' }, 'accountNumber'],
      [{ ...BANK, bankName: undefined }, 'bankName'],
      [{ ...BANK, accountHolder: 'R' }, 'accountHolder'],
      [{ ...BANK, accountHolder: 'R'.repeat(81) }, 'accountHolder'],
      [{ method: 'WIRE' }, 'method'],
      [{ ...BANK, accountLast4: '0000' }, 'accountLast4'],
      [{ ...BANK, phone: '771234567' }, 'phone'],
      [{ method: 'UPI', upiId: 'ram@upi' }, 'upiId'], // the old field is an unknown field now
      [{ method: 'UPI', phone: '771234567' }, 'method'],
    ];
    for (const [body, field] of cases) {
      const r = await put('/api/partner/payout-account', tV1, body);
      expect([r.status, r.body.code, r.body.field]).toEqual([400, 'BAD_REQUEST', field]);
    }
    expect((await request.put('/api/partner/payout-account').set(H(tV1)).send([1, 2])).status).toBe(400);
    expect(await prisma.payoutAccount.count({ where: { userId: V1.id } })).toBe(0);
  });

  test('role isolation: only restaurants and riders use the partner routes, only admins the admin routes, nobody sees another account', async () => {
    await put('/api/partner/payout-account', tV1, { method: 'WAVE', phone: '771110001' });
    for (const [m, path] of [['get', '/api/partner/payout-account'], ['put', '/api/partner/payout-account']] as const) {
      expect((await (request as any)[m](path).set(H(tStudent)).send({})).status).toBe(403);
      expect((await (request as any)[m](path).set(H(tAdmin)).send({})).status).toBe(403);
      expect((await (request as any)[m](path)).status).toBe(401);
    }
    // a second restaurant has its own (empty) account: V1's details never leak, and there is no id parameter to abuse
    expect((await get('/api/partner/payout-account', tV2)).body.data).toBeNull();
    await put('/api/partner/payout-account', tV2, { method: 'ORANGE_MONEY', phone: '771110002' });
    expect((await get('/api/partner/payout-account', tV1)).body.data.phone).toBe('+221 771110001');
    expect((await get('/api/partner/payout-account', tV2)).body.data.phone).toBe('+221 771110002');
    // a rider can save one too
    const rider = await put('/api/partner/payout-account', tD1, { method: 'WAVE', phone: '771110003' });
    expect(rider.status).toBe(200);
    expect((await prisma.payoutAccount.findUniqueOrThrow({ where: { userId: D1.id } })).partnerType).toBe('DRIVER');
    // admin routes
    const base = `/api/admin/partners/${V1.id}/payout-account`;
    for (const t of [tStudent, tV1, tV2, tD1]) {
      expect((await get(base, t)).status).toBe(403);
      expect((await put(base, t, { method: 'WAVE', phone: '771119999' })).status).toBe(403);
      expect((await request.patch(`${base}/verify`).set(H(t)).send({ verified: true })).status).toBe(403);
      expect((await request.post(`${base}/reveal`).set(H(t)).send({})).status).toBe(403);
    }
    expect((await request.get(base)).status).toBe(401);
    expect((await prisma.payoutAccount.findUniqueOrThrow({ where: { userId: V1.id } })).upiId).toBe('+221 771110001'); // the column keeps its old name
  });

  test('changing details clears verification; saving the same details again keeps it', async () => {
    await put('/api/partner/payout-account', tV1, BANK);
    const v = await request.patch(`/api/admin/partners/${V1.id}/payout-account/verify`).set(H(tAdmin)).send({ verified: true });
    expect(v.body.data.verifiedAt).toEqual(expect.any(String));
    const same = await put('/api/partner/payout-account', tV1, { ...BANK });
    expect(same.body.changed).toBe(false);
    expect(same.body.data.verifiedAt).toEqual(v.body.data.verifiedAt);
    const changed = await put('/api/partner/payout-account', tV1, { ...BANK, accountNumber: 'SN08SN0100152000048500003036' });
    expect(changed.body.changed).toBe(true);
    expect(changed.body.data.verifiedAt).toBeNull();
    expect(changed.body.data.accountLast4).toBe('3036');
    await request.patch(`/api/admin/partners/${V1.id}/payout-account/verify`).set(H(tAdmin)).send({ verified: true });
    const switched = await put('/api/partner/payout-account', tV1, { method: 'WAVE', phone: '771234567' });
    expect(switched.body.data).toMatchObject({ method: 'WAVE', accountLast4: null, verifiedAt: null });
    const row = await prisma.payoutAccount.findUniqueOrThrow({ where: { userId: V1.id } });
    expect(row.accountNumberEnc).toBeNull();
    expect(row.verifiedBy).toBeNull();
  });

  test('admin: masked read, save for a partner, idempotent verify, audited reveal of the full number', async () => {
    const base = `/api/admin/partners/${V1.id}/payout-account`;
    const none = await get(base, tAdmin);
    expect(none.body).toEqual({ success: true, partner: { userId: V1.id, name: 'PA Owner One', role: 'VENDOR' }, data: null });
    expect((await request.post(`${base}/reveal`).set(H(tAdmin)).send({})).status).toBe(404);
    expect((await request.patch(`${base}/verify`).set(H(tAdmin)).send({ verified: true })).body.code).toBe('NO_PAYOUT_ACCOUNT');

    const saved = await put(base, tAdmin, BANK);
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject({ userId: V1.id, partnerType: 'VENDOR', method: 'BANK', accountLast4: '3035', accountMasked: 'XXXXXX3035', bankName: 'CBAO', verifiedAt: null, verifiedBy: null });
    expect(JSON.stringify(saved.body)).not.toContain(IBAN);
    expect(JSON.stringify((await get(base, tAdmin)).body)).not.toContain(IBAN);

    const bad = await request.patch(`${base}/verify`).set(H(tAdmin)).send({ verified: 'yes' });
    expect([bad.status, bad.body.field]).toEqual([400, 'verified']);
    const v1 = await request.patch(`${base}/verify`).set(H(tAdmin)).send({ verified: true });
    const v2 = await request.patch(`${base}/verify`).set(H(tAdmin)).send({ verified: true });
    expect([v1.body.changed, v2.body.changed]).toEqual([true, false]);
    expect(v2.body.data.verifiedAt).toBe(v1.body.data.verifiedAt);
    expect(v1.body.data.verifiedBy).toBe(ADMIN.id);
    expect(await prisma.adminAuditLog.count({ where: { action: 'PAYOUT_ACCOUNT_VERIFIED' } })).toBe(1);
    const un = await request.patch(`${base}/verify`).set(H(tAdmin)).send({ verified: false });
    expect([un.body.changed, un.body.data.verifiedAt]).toEqual([true, null]);

    expect(await prisma.adminAuditLog.count({ where: { action: 'PAYOUT_ACCOUNT_REVEALED' } })).toBe(0);
    const rev = await request.post(`${base}/reveal`).set(H(tAdmin)).send({});
    expect(rev.status).toBe(200);
    expect(rev.headers['cache-control']).toBe('no-store');
    expect(rev.body).toEqual({ success: true, data: { userId: V1.id, partnerType: 'VENDOR', method: 'BANK', phone: null, accountHolder: 'Ram Singh', accountNumber: IBAN, bankName: 'CBAO' } });
    const logged = await prisma.adminAuditLog.findMany({ where: { action: 'PAYOUT_ACCOUNT_REVEALED' } });
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ targetType: 'USER', targetId: V1.id });
    expect(logged[0].summary).toContain(ADMIN.id);
    expect(logged[0].summary).toContain('3035');
    expect(logged[0].summary).not.toContain(IBAN);
    await request.post(`${base}/reveal`).set(H(tAdmin)).send({});
    expect(await prisma.adminAuditLog.count({ where: { action: 'PAYOUT_ACCOUNT_REVEALED' } })).toBe(2); // every reveal is logged
    expect(JSON.stringify(await prisma.adminAuditLog.findMany({}))).not.toContain(IBAN);
  });

  test('reveal of a Wave account returns no account number; a wrong key fails closed without an audit row or any value', async () => {
    const base = `/api/admin/partners/${V1.id}/payout-account`;
    await put('/api/partner/payout-account', tV1, { method: 'WAVE', phone: '771234567' });
    const rev = await request.post(`${base}/reveal`).set(H(tAdmin)).send({});
    expect(rev.body.data).toMatchObject({ method: 'WAVE', phone: '+221 771234567', accountNumber: null });
    await put('/api/partner/payout-account', tV1, BANK);
    await prisma.adminAuditLog.deleteMany({});
    process.env.PAYOUT_ENC_KEY = randomBytes(32).toString('base64'); // rotated by mistake
    const failed = await request.post(`${base}/reveal`).set(H(tAdmin)).send({});
    expect(failed.status).toBe(500);
    expect(failed.body.code).toBe('PAYOUT_DECRYPT_FAILED');
    expect(await prisma.adminAuditLog.count({ where: { action: 'PAYOUT_ACCOUNT_REVEALED' } })).toBe(0);
    delete process.env.PAYOUT_ENC_KEY;
    expect((await request.post(`${base}/reveal`).set(H(tAdmin)).send({})).status).toBe(503);
  });

  test('admin routes only accept restaurant owners and riders', async () => {
    for (const id of [STUDENT.id, ADMIN.id, 'no-such-user']) {
      const r = await get(`/api/admin/partners/${id}/payout-account`, tAdmin);
      expect([r.status, r.body.code]).toEqual([404, 'NOT_FOUND']);
    }
    expect((await get('/api/admin/partners/bad%20id/payout-account', tAdmin)).status).toBe(400);
    expect((await put(`/api/admin/partners/${STUDENT.id}/payout-account`, tAdmin, { method: 'WAVE', phone: '771119998' })).status).toBe(404);
  });

  test('five parallel first saves leave exactly one row and no error', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => put('/api/partner/payout-account', tV1, BANK)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await prisma.payoutAccount.count({ where: { userId: V1.id } })).toBe(1);
    expect(results.filter((r) => r.body.changed).length).toBeGreaterThanOrEqual(1);
  });

  test('rate limits: partner saves, admin saves and reveals', async () => {
    process.env.RL_PARTNER_PAYOUT_WRITE_MAX = '2';
    process.env.RL_ADMIN_PAYOUT_REVEAL_MAX = '1';
    process.env.RL_ADMIN_PAYOUT_WRITE_MAX = '2';
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await put('/api/partner/payout-account', tV1, { method: 'WAVE', phone: `77111100${i}` })).status);
    expect(codes).toEqual([200, 200, 429]);
    const base = `/api/admin/partners/${V2.id}/payout-account`;
    const ad: number[] = [];
    for (let i = 0; i < 3; i++) ad.push((await put(base, tAdmin, { method: 'WAVE', phone: `77111200${i}` })).status);
    expect(ad).toEqual([200, 200, 429]);
    const rv1 = await request.post(`${base}/reveal`).set(H(tAdmin)).send({});
    const rv2 = await request.post(`${base}/reveal`).set(H(tAdmin)).send({});
    expect([rv1.status, rv2.status]).toEqual([200, 429]);
    expect(rv2.body.code).toBe('RATE_LIMITED');
  });
});
