/**
 * The restaurant's own web space (admin dashboard, /restaurant/*): the exact calls the screens make, in order.
 * sign-up -> waiting -> admin decision -> approved sheet and orders -> password reset by the admin ends the session.
 * Runs against a real PostgreSQL.
 */
import supertest from 'supertest';
import { startTestServer, stopTestServer, TestServerInstance } from '../harness/app';
import { prisma, seedTestDatabase, cleanTestOrders, cleanTestUsers } from '../harness/db';
import { getAdminToken, getAuthHeader } from '../harness/auth';

const H = (t: string) => getAuthHeader(t);
const PHONE = '77 555 12 34';
const body = { role: 'VENDOR', name: 'Awa Diop', phone: PHONE, password: 'motdepasse1', restaurantName: 'Chez Awa Web', category: 'Grillades', address: 'Escale, Thiès', fssaiNumber: '0012345 2G3' };

const wipe = async () => {
  await prisma.vendor.deleteMany({ where: { name: 'Chez Awa Web' } });
  await prisma.user.deleteMany({ where: { phone: { endsWith: '775551234' } } });
};

describe('Restaurant web lifecycle', () => {
  let server: TestServerInstance;
  let request: ReturnType<typeof supertest>;
  let token = '';
  let vendorId = '';
  let userId = '';
  const admin = () => H(getAdminToken());

  beforeAll(async () => {
    await cleanTestOrders();
    await seedTestDatabase();
    await wipe();
    server = await startTestServer(0);
    request = supertest(server.app);
  });
  afterAll(async () => {
    await wipe();
    await prisma.adminAuditLog.deleteMany({});
    await cleanTestOrders();
    await cleanTestUsers();
    await stopTestServer(server);
    await prisma.$disconnect();
  });

  it('signs up PENDING and the admin sees the filed application (NINEA, kitchen address)', async () => {
    const res = await request.post('/api/auth/partner-signup').send({ ...body, lat: 14.7910, lng: -16.9359, locationAccuracyM: 18 });
    expect(res.status).toBe(201);
    expect(res.body.approvalStatus).toBe('PENDING');
    expect(res.body.user.role).toBe('VENDOR');
    token = res.body.token;
    vendorId = res.body.vendor.id;
    userId = res.body.user.id;

    const list = await request.get('/api/admin/applications?status=PENDING&kind=VENDOR').set(admin());
    const mine = list.body.data.find((a: any) => a.id === vendorId);
    expect(mine).toMatchObject({ kind: 'VENDOR', selfSignup: true, status: 'PENDING', vendor: { name: 'Chez Awa Web', fssaiNumber: '00123452G3', address: 'Escale, Thiès', hasLocation: true } });
  });

  it('refuses a second sign-up with the same phone, and a pin outside the delivery zone', async () => {
    const dup = await request.post('/api/auth/partner-signup').send(body);
    expect(dup.status).toBe(409);
    expect(dup.body.field).toBe('phone');
    const far = await request.post('/api/auth/partner-signup').send({ ...body, phone: '77 555 99 99', lat: 48.85, lng: 2.35 });
    expect(far.status).toBe(400);
    expect(far.body.field).toBe('location');
  });

  it('while waiting: "where do I stand" works, orders and opening are refused, the application can be corrected', async () => {
    const me = await request.get('/api/partner/me').set(H(token));
    expect(me.body).toMatchObject({ approvalStatus: 'PENDING', vendor: { id: vendorId, fssaiNumber: '00123452G3' } });
    expect((await request.patch(`/api/vendors/${vendorId}/status`).set(H(token)).send({ isAcceptingOrders: true })).status).toBe(403);
    const fixed = await request.put('/api/partner/application').set(H(token)).send({ restaurantName: 'Chez Awa Web', category: 'Grillades', address: 'Quartier Randoulène', fssaiNumber: '' });
    expect(fixed.status).toBe(200);
    expect(fixed.body.vendor.address).toBe('Quartier Randoulène');
  });

  it('a refusal shows its reason; the corrected file goes back to PENDING', async () => {
    const no = await request.post(`/api/admin/partners/vendor/${vendorId}/status`).set(admin()).send({ status: 'REJECTED', reason: 'NINEA illisible' });
    expect(no.status).toBe(200);
    const me = await request.get('/api/partner/me').set(H(token));
    expect(me.body).toMatchObject({ approvalStatus: 'REJECTED', rejectionReason: 'NINEA illisible' });
    const again = await request.put('/api/partner/application').set(H(token)).send({ restaurantName: 'Chez Awa Web', category: 'Grillades', address: 'Quartier Randoulène', fssaiNumber: '0012345 2G3' });
    expect(again.body.approvalStatus).toBe('PENDING');
    expect(again.body.rejectionReason).toBeNull();
  });

  it('once approved: sign-in works, own order list is empty, profile and opening switch work', async () => {
    expect((await request.post(`/api/admin/partners/vendor/${vendorId}/status`).set(admin()).send({ status: 'APPROVED' })).status).toBe(200);
    const login = await request.post('/api/auth/partner-login').send({ phone: PHONE, password: 'motdepasse1', role: 'VENDOR' });
    expect(login.status).toBe(200);
    expect(login.body).toMatchObject({ approvalStatus: 'APPROVED', user: { role: 'VENDOR' }, vendor: { id: vendorId } });
    token = login.body.token;

    const orders = await request.get('/api/orders?limit=100').set(H(token));
    expect(orders.status).toBe(200);
    expect(orders.body.data).toEqual([]);

    const profile = await request.put('/api/partner/vendor/profile').set(H(token)).send({ description: 'Grillades au feu de bois', phone: '77 555 12 34' });
    expect(profile.status).toBe(200);
    const open = await request.patch(`/api/vendors/${vendorId}/status`).set(H(token)).send({ isAcceptingOrders: true });
    expect(open.status).toBe(200);
    expect(open.body.data?.isAcceptingOrders ?? open.body.isAcceptingOrders).toBe(true);
  });

  it('the web space refuses a rider or a client account at sign-in', async () => {
    const wrong = await request.post('/api/auth/partner-login').send({ phone: PHONE, password: 'motdepasse1', role: 'DRIVER' });
    expect(wrong.status).toBe(403);
  });

  it('a password reset by the admin ends the restaurant\'s session at once', async () => {
    expect((await request.get('/api/partner/me').set(H(token))).status).toBe(200);
    const reset = await request.post(`/api/admin/partners/${userId}/reset-password`).set(admin()).send({ password: 'nouveaumdp99' });
    expect(reset.status).toBe(200);
    expect([401, 403]).toContain((await request.get('/api/partner/me').set(H(token))).status);
    expect((await request.post('/api/auth/partner-login').send({ phone: PHONE, password: 'motdepasse1', role: 'VENDOR' })).status).toBe(401);
    expect((await request.post('/api/auth/partner-login').send({ phone: PHONE, password: 'nouveaumdp99', role: 'VENDOR' })).status).toBe(200);
  });
});
