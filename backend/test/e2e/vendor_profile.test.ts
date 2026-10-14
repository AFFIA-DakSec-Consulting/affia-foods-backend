/**
 * Restaurant public profile (Docs/24_vendor_profile_contract.md): logo, banner, description, contact phone, opening hours.
 * PATCH /api/admin/vendors/:id/profile (admin) and PUT /api/partner/vendor/profile (the restaurant itself).
 * Runs against a real PostgreSQL.
 */
import supertest from 'supertest';
import { startTestServer, stopTestServer, TestServerInstance } from '../harness/app';
import { prisma, seedTestDatabase, cleanTestOrders, cleanTestUsers } from '../harness/db';
import { getAdminToken, getStudentToken, getVendorToken, getAuthHeader } from '../harness/auth';
import { checkOpeningHours, checkProfile } from '../../src/services/vendorProfile';
import { sniffImage, uploadRoot } from '../../src/services/imageUpload';
import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const H = (t: string) => getAuthHeader(t);
const HOURS = { mon: [{ open: '08:00', close: '14:00' }, { open: '18:00', close: '23:00' }], sat: [{ open: '10:00', close: '22:00' }] };

describe('Vendor profile', () => {
  let server: TestServerInstance;
  let request: ReturnType<typeof supertest>;
  const admin = (id: string, body: unknown) => request.patch(`/api/admin/vendors/${id}/profile`).set(H(getAdminToken())).send(body as object);
  const own = (token: string, body: unknown) => request.put('/api/partner/vendor/profile').set(H(token)).send(body as object);
  const reset = () => prisma.$executeRawUnsafe(`UPDATE "Vendor" SET "logoUrl" = NULL, "description" = NULL, "phone" = NULL, "openingHours" = NULL, "pickupNotes" = NULL, "eta" = '20-25 min' WHERE id = 'ven-1'`);

  beforeAll(async () => {
    await cleanTestOrders();
    await seedTestDatabase();
    await reset();
    server = await startTestServer(0);
    request = supertest(server.app);
  });
  afterAll(async () => {
    await reset();
    await prisma.adminAuditLog.deleteMany({});
    await cleanTestOrders();
    await cleanTestUsers();
    await stopTestServer(server);
    await prisma.$disconnect();
  });

  describe('validation (pure)', () => {
    it('needs at least one known field', () => {
      expect(checkProfile({}).ok).toBe(false);
      expect(checkProfile({ nothing: 1 }).ok).toBe(false);
    });
    it('canonicalises the phone and clears optional fields with null or ""', () => {
      const ok = checkProfile({ phone: '77 123 45 67', description: '  Cuisine du Sénégal  ', logoUrl: '' });
      expect(ok).toEqual({ ok: true, data: { phone: '+221 771234567', description: 'Cuisine du Sénégal', logoUrl: null } });
    });
    it('rejects a bad phone, a long description and bad links', () => {
      expect(checkProfile({ phone: '123' })).toMatchObject({ ok: false, field: 'phone' });
      expect(checkProfile({ description: 'x'.repeat(301) })).toMatchObject({ ok: false, field: 'description' });
      expect(checkProfile({ logoUrl: 'javascript:alert(1)' })).toMatchObject({ ok: false, field: 'logoUrl' });
      expect(checkProfile({ logoUrl: 'not a link' })).toMatchObject({ ok: false, field: 'logoUrl' });
      expect(checkProfile({ bannerImage: '' })).toMatchObject({ ok: false, field: 'bannerImage' });
    });
    it('opening hours: sorted, no overlap, open before close, at most 3 periods, known days only', () => {
      expect(checkOpeningHours({ mon: [{ open: '18:00', close: '23:00' }, { open: '08:00', close: '14:00' }] })).toEqual({ ok: true, value: { mon: [{ open: '08:00', close: '14:00' }, { open: '18:00', close: '23:00' }] } });
      expect(checkOpeningHours({ mon: [{ open: '10:00', close: '12:00' }, { open: '11:00', close: '13:00' }] }).ok).toBe(false);
      expect(checkOpeningHours({ mon: [{ open: '12:00', close: '08:00' }] }).ok).toBe(false);
      expect(checkOpeningHours({ mon: [{ open: '8:00', close: '12:00' }] }).ok).toBe(false);
      expect(checkOpeningHours({ funday: [] }).ok).toBe(false);
      expect(checkOpeningHours({ mon: [1, 2, 3, 4].map((h) => ({ open: `0${h}:00`, close: `0${h}:30` })) }).ok).toBe(false);
      expect(checkOpeningHours({ tue: [] })).toEqual({ ok: true, value: {} });
      expect(checkOpeningHours(null)).toEqual({ ok: true, value: null });
    });
  });

  describe('admin edits a restaurant on its behalf', () => {
    it('saves, returns the profile and writes an audit line', async () => {
      const res = await admin('ven-1', { logoUrl: 'https://example.com/logo.png', description: 'Les meilleurs thiéboudiennes', phone: '78 000 11 22', openingHours: HOURS });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: 'ven-1', logoUrl: 'https://example.com/logo.png', description: 'Les meilleurs thiéboudiennes', phone: '+221 780001122', openingHours: HOURS });
      const row = await prisma.vendor.findUniqueOrThrow({ where: { id: 'ven-1' } });
      expect(row.openingHours).toEqual(HOURS);
      const log = await prisma.adminAuditLog.findFirst({ where: { action: 'VENDOR_PROFILE_SET', targetId: 'ven-1' } });
      expect(log).not.toBeNull();
    });

    it('is a partial update: a field that is not sent is left alone, null clears', async () => {
      const res = await admin('ven-1', { description: null });
      expect(res.status).toBe(200);
      expect(res.body.data.description).toBeNull();
      expect(res.body.data.logoUrl).toBe('https://example.com/logo.png');
      const cleared = await admin('ven-1', { openingHours: null });
      expect(cleared.body.data.openingHours).toBeNull();
    });

    it('answers 400 with the field, 404 for an unknown restaurant, and refuses non-admins', async () => {
      const bad = await admin('ven-1', { phone: 'abc' });
      expect(bad.status).toBe(400);
      expect(bad.body.field).toBe('phone');
      expect((await admin('nope-123', { description: 'x' })).status).toBe(404);
      const asVendor = await request.patch('/api/admin/vendors/ven-1/profile').set(H(getVendorToken())).send({ description: 'x' });
      expect(asVendor.status).toBe(403);
      const asStudent = await request.patch('/api/admin/vendors/ven-1/profile').set(H(getStudentToken())).send({ description: 'x' });
      expect(asStudent.status).toBe(403);
    });
  });

  describe('the restaurant edits its own profile', () => {
    it('saves on its own restaurant only', async () => {
      const res = await own(getVendorToken(), { description: 'Chez nous', phone: '76 111 22 33', vendorId: 'ven-2', id: 'ven-2' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: 'ven-1', description: 'Chez nous', phone: '+221 761112233' });
      const others = await prisma.vendor.findMany({ where: { id: { not: 'ven-1' }, description: 'Chez nous' } });
      expect(others).toHaveLength(0);
    });
    it('validates, and refuses other roles', async () => {
      expect((await own(getVendorToken(), { openingHours: { mon: [{ open: '12:00', close: '08:00' }] } })).status).toBe(400);
      expect((await own(getVendorToken(), {})).status).toBe(400);
      expect((await own(getStudentToken(), { description: 'x' })).status).toBe(403);
      expect((await request.put('/api/partner/vendor/profile').send({ description: 'x' })).status).toBe(401);
    });
  });

  describe('who sees what', () => {
    it('customers see logo, description and hours but never the phone; admin and owner see the phone', async () => {
      await admin('ven-1', { logoUrl: 'https://example.com/logo.png', description: 'Visible', phone: '77 123 45 67', openingHours: HOURS });
      const asCustomer = await request.get('/api/vendors/ven-1').set(H(getStudentToken()));
      expect(asCustomer.body.data).toMatchObject({ logoUrl: 'https://example.com/logo.png', description: 'Visible', openingHours: HOURS });
      expect(asCustomer.body.data.phone).toBeUndefined();
      const asAdmin = await request.get('/api/vendors/ven-1').set(H(getAdminToken()));
      expect(asAdmin.body.data.phone).toBe('+221 771234567');
      const asOwner = await request.get('/api/vendors/ven-1').set(H(getVendorToken()));
      expect(asOwner.body.data.phone).toBe('+221 771234567');
      const session = await request.get('/api/partner/me').set(H(getVendorToken()));
      expect(session.body.vendor ?? session.body.data?.vendor).toMatchObject({ logoUrl: 'https://example.com/logo.png', phone: '+221 771234567' });
    });
  });

  describe('identity, address and preparation fields', () => {
    it('validates name, category, address, preparation time and pickup notes', () => {
      expect(checkProfile({ name: 'A' })).toMatchObject({ ok: false, field: 'name' });
      expect(checkProfile({ address: 'ab' })).toMatchObject({ ok: false, field: 'address' });
      expect(checkProfile({ eta: '25-20 min' })).toMatchObject({ ok: false, field: 'eta' });
      expect(checkProfile({ eta: '20-25' })).toMatchObject({ ok: false, field: 'eta' });
      expect(checkProfile({ pickupNotes: 'x'.repeat(201) })).toMatchObject({ ok: false, field: 'pickupNotes' });
      expect(checkProfile({ name: '  Chez   Awa ', category: 'Sénégalais', address: 'Rue 10, Randoulène', eta: '15-25 min', pickupNotes: '' }))
        .toEqual({ ok: true, data: { name: 'Chez Awa', category: 'Sénégalais', address: 'Rue 10, Randoulène', eta: '15-25 min', pickupNotes: null } });
    });
    it('the restaurant can enter its address, preparation time and rider notes', async () => {
      const res = await own(getVendorToken(), { address: 'Rue 10, Randoulène, Thiès', eta: '15-25 min', pickupNotes: 'Entrée par la porte bleue' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ address: 'Rue 10, Randoulène, Thiès', eta: '15-25 min', pickupNotes: 'Entrée par la porte bleue' });
    });
  });

  describe('image upload', () => {
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
    const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 2)]);
    const adminUpload = (kind: string, body: Buffer, type = 'image/png') => request.post(`/api/admin/vendors/ven-1/image?kind=${kind}`).set(H(getAdminToken())).set('Content-Type', type).send(body);
    let dir = '';
    beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'kraveo-uploads-')); process.env.UPLOAD_DIR = dir; });
    afterAll(() => { delete process.env.UPLOAD_DIR; rmSync(dir, { recursive: true, force: true }); });

    it('recognises the type from the first bytes, not from the name', () => {
      expect(sniffImage(PNG)).toBe('png');
      expect(sniffImage(JPG)).toBe('jpg');
      expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
      expect(uploadRoot()).toBe(dir);
    });
    it('stores a PNG and answers its public address; the file really exists', async () => {
      const res = await adminUpload('logo', PNG);
      expect(res.status).toBe(201);
      expect(res.body.data.url).toMatch(/\/static\/uploads\/vendors\/ven-1-logo-[0-9a-f]{12}\.png$/);
      const file = res.body.data.url.split('/').pop();
      expect(existsSync(join(dir, 'vendors', file))).toBe(true);
    });
    it('refuses a fake image, an SVG, a missing kind and a stranger', async () => {
      expect((await adminUpload('logo', Buffer.from('not an image at all, just text'))).status).toBe(415);
      expect((await adminUpload('logo', Buffer.from('<svg></svg>'), 'image/svg+xml')).status).toBe(415);
      expect((await adminUpload('cover', PNG)).status).toBe(400);
      const asStudent = await request.post('/api/admin/vendors/ven-1/image?kind=logo').set(H(getStudentToken())).set('Content-Type', 'image/png').send(PNG);
      expect(asStudent.status).toBe(403);
      const missing = await request.post('/api/admin/vendors/nope-123/image?kind=logo').set(H(getAdminToken())).set('Content-Type', 'image/png').send(PNG);
      expect(missing.status).toBe(404);
    });
    it('the restaurant uploads for itself only, and replacing a picture deletes the old file', async () => {
      const first = await request.post('/api/partner/vendor/image?kind=banner').set(H(getVendorToken())).set('Content-Type', 'image/jpeg').send(JPG);
      expect(first.status).toBe(201);
      const firstFile = first.body.data.url.split('/').pop();
      expect((await own(getVendorToken(), { bannerImage: first.body.data.url })).status).toBe(200);
      expect(existsSync(join(dir, 'vendors', firstFile))).toBe(true);
      const second = await request.post('/api/partner/vendor/image?kind=banner').set(H(getVendorToken())).set('Content-Type', 'image/png').send(PNG);
      expect((await own(getVendorToken(), { bannerImage: second.body.data.url })).status).toBe(200);
      expect(existsSync(join(dir, 'vendors', firstFile))).toBe(false);
      expect((await request.post('/api/partner/vendor/image?kind=banner').set(H(getStudentToken())).set('Content-Type', 'image/png').send(PNG)).status).toBe(403);
    });
  });
});
