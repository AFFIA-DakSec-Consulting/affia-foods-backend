/** Customer sign-in by phone number + one-time code (services/phoneOtp.ts). Real PostgreSQL; the sender is a fake. */
import supertest from 'supertest';
import { startTestServer, stopTestServer, TestServerInstance } from '../harness/app';
import { prisma } from '../harness/db';
import { setOtpSender, OtpSender } from '../../src/services/otpSender';
import { TEST_CLIENT, OTP_MAX_ATTEMPTS } from '../../src/services/phoneOtp';

jest.setTimeout(30_000);
const PHONE = '+221 779990001';

describe('Phone + code sign-in', () => {
  let server: TestServerInstance;
  let request: ReturnType<typeof supertest>;
  const sent: { phone: string; code: string }[] = [];
  const sender: OtpSender = { channel: 'whatsapp', send: async (phone, code) => { sent.push({ phone, code }); } };
  const ask = (phone: unknown = PHONE) => request.post('/api/auth/otp/request').send({ phone });
  const verify = (code: unknown, phone: unknown = PHONE) => request.post('/api/auth/otp/verify').send({ phone, code });
  const clean = async () => { await prisma.phoneOtp.deleteMany({}); await prisma.user.deleteMany({ where: { phone: { in: [PHONE, '+221 779990002', '+221 779990003'] } } }); sent.length = 0; };

  beforeAll(async () => { server = await startTestServer(0); request = supertest(server.app); setOtpSender(sender); });
  beforeEach(clean);
  afterAll(async () => { setOtpSender(null); await clean(); await stopTestServer(server); });

  test('the code is sent by the sender and signs a new customer in; the same code cannot be used twice', async () => {
    const r = await ask('77 999 00 01');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ success: true, phone: PHONE, channel: 'whatsapp', expiresInSeconds: 300, resendAfterSeconds: 45 });
    expect(r.body).not.toHaveProperty('debugCode');
    expect(sent).toHaveLength(1);
    expect(sent[0].code).toMatch(/^\d{6}$/);
    const row = await prisma.phoneOtp.findFirstOrThrow({ where: { phone: PHONE } });
    expect(row.codeHash).not.toContain(sent[0].code);
    const v = await verify(sent[0].code);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ success: true, isNewUser: true, needsProfile: true, user: { phone: PHONE, role: 'STUDENT' } });
    expect(typeof v.body.token).toBe('string');
    expect((await request.get('/api/auth/profile').set('Authorization', `Bearer ${v.body.token}`)).status).toBe(200);
    expect([(await verify(sent[0].code)).status, (await verify(sent[0].code)).body.code]).toEqual([400, 'OTP_INVALID']);
  });

  test('a returning customer is not new', async () => {
    await ask(); await verify(sent[0].code);
    await prisma.phoneOtp.deleteMany({});
    await ask();
    const v = await verify(sent[1].code);
    expect([v.status, v.body.isNewUser]).toEqual([200, false]);
  });

  test('wrong codes: 5 tries, then the code is locked even with the right digits', async () => {
    await ask();
    const wrong = sent[0].code === '000000' ? '111111' : '000000';
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) expect([(await verify(wrong)).status, i]).toEqual([400, i]);
    const locked = await verify(sent[0].code);
    expect([locked.status, locked.body.code]).toEqual([429, 'OTP_LOCKED']);
  });

  test('an expired code and a code never asked for are refused', async () => {
    expect((await verify('123456')).body.code).toBe('OTP_INVALID');
    await ask();
    await prisma.phoneOtp.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await verify(sent[0].code)).body.code).toBe('OTP_INVALID');
  });

  test('a new code can only be asked after 45 seconds, and at most 5 per hour', async () => {
    expect((await ask()).status).toBe(200);
    const soon = await ask();
    expect([soon.status, soon.body.code]).toEqual([429, 'OTP_TOO_SOON']);
    expect(soon.body.retryAfterSeconds).toBeGreaterThan(0);
    await prisma.phoneOtp.updateMany({ data: { createdAt: new Date(Date.now() - 60_000) } });
    expect((await ask()).status).toBe(200);
    await prisma.phoneOtp.updateMany({ data: { createdAt: new Date(Date.now() - 600_000) } });
    for (let i = 0; i < 3; i++) { await prisma.phoneOtp.create({ data: { phone: PHONE, codeHash: 'x', expiresAt: new Date(Date.now() + 1000), createdAt: new Date(Date.now() - 300_000 - i) } }); }
    const capped = await ask();
    expect([capped.status, capped.body.code]).toEqual([429, 'RATE_LIMITED']);
  });

  test('bad input is a 400 with the field', async () => {
    for (const phone of [null, '', '12345', '+91 9876543210', '33 123 45 67', 5]) expect([(await ask(phone)).status, (await ask(phone)).body.field]).toEqual([400, 'phone']);
    for (const code of [undefined, '12345', '1234567', 'abcdef', 123456]) expect([(await verify(code)).status, (await verify(code)).body.field]).toEqual([400, 'code']);
  });

  test('a partner number is sent to the partner app', async () => {
    const r = await ask('+221 776543212'); // the seeded restaurant owner
    expect([r.status, r.body.code]).toEqual([403, 'PARTNER_ACCOUNT']);
    expect(sent).toHaveLength(0);
  });

  test('a failed send gives 503 and does not use up the hourly allowance', async () => {
    setOtpSender({ channel: 'whatsapp', send: async () => { throw new Error('provider down'); } });
    const r = await ask();
    expect([r.status, r.body.code]).toEqual([503, 'OTP_SEND_FAILED']);
    expect(await prisma.phoneOtp.count({ where: { phone: PHONE } })).toBe(0);
    setOtpSender(sender);
  });

  test('the test client always gets 123456 and nothing is sent; not in production', async () => {
    const r = await ask(TEST_CLIENT.phone);
    expect([r.status, r.body.channel]).toEqual([200, 'test']);
    expect(sent).toHaveLength(0);
    const v = await verify(TEST_CLIENT.code, TEST_CLIENT.phone);
    expect([v.status, v.body.success]).toEqual([200, true]);
    await prisma.phoneOtp.deleteMany({});
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await ask(TEST_CLIENT.phone); // now a real number: goes through the (fake) sender with a random code
      expect(sent).toHaveLength(1);
      expect((await verify(TEST_CLIENT.code, TEST_CLIENT.phone)).status).toBe(400);
    } finally { process.env.NODE_ENV = before; await prisma.phoneOtp.deleteMany({}); await prisma.user.deleteMany({ where: { phone: TEST_CLIENT.phone } }); }
  });
});
