/**
 * Back-office team and its content: roles (read / write per section), personal codes, two-step sign-in, sessions, and the screens that
 * rely on them (prospecting, legal documents, help articles, referrals). Real PostgreSQL: run it against a throw-away database, never the demo one.
 */
import supertest from 'supertest';
import { startTestServer, stopTestServer, TestServerInstance } from '../harness/app';
import { prisma } from '../harness/db';
import { World, createWorld, purgeWorld } from '../harness/journey';
import { __resetAdminLoginLimiter } from '../../src/routes/api';
import { __resetRateLimits } from '../../src/middleware/rateLimit';
import { invalidateAuthCache } from '../../src/middleware/auth';
import { invalidateAdminRole, totpCode, totpStep, base32Decode } from '../../src/services/adminTeam';
import { connectTestSocket } from '../harness/socket';
import { findAccountToReset, resetTwoFactor } from '../../src/utils/adminReset2fa';

jest.setTimeout(60_000);

const OWNER_CODE = 'tm-owner-passcode-9';
const NAME = 'ZZ Team';

describe('admin team, security and content', () => {
  let server: TestServerInstance;
  let request: ReturnType<typeof supertest>;
  let W: World;
  let otherAdmins: string[] = [];
  const owner = () => `Bearer ${W.admin.token}`; // a token without a session id: how admin tokens looked before sessions existed
  const call = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, token: string | null, body?: unknown) => {
    const r = (request as any)[method](url);
    if (token) r.set('Authorization', token.startsWith('Bearer ') ? token : `Bearer ${token}`);
    return body === undefined ? r : r.send(body);
  };
  const login = (body: object) => request.post('/api/auth/admin-login').send(body);
  const reset = () => { __resetRateLimits(); __resetAdminLoginLimiter(); invalidateAuthCache(); invalidateAdminRole(); };

  /** A team member: created by the owner, then signed in. */
  const member = async (role: string, phone: string) => {
    const created = await call('post', '/api/admin/team', owner(), { name: `${NAME} ${role}`, phone, role });
    expect(created.status).toBe(201);
    const signed = await login({ identifier: phone, passcode: created.body.passcode });
    expect(signed.status).toBe(200);
    return { id: created.body.data.id as string, phone, passcode: created.body.passcode as string, token: signed.body.token as string, admin: signed.body.admin };
  };

  const cleanup = async () => {
    const users = await prisma.user.findMany({ where: { name: { startsWith: NAME } }, select: { id: true } });
    await prisma.adminSession.deleteMany({ where: { userId: { in: [...users.map((u) => u.id), 'tm-admin-0'] } } });
    await prisma.user.deleteMany({ where: { name: { startsWith: NAME } } });
    await prisma.prospect.deleteMany({ where: { businessName: { startsWith: 'ZZ Test' } } });
    await prisma.legalDocument.deleteMany({});
    await prisma.helpArticle.deleteMany({ where: { slug: { startsWith: 'zz-' } } });
    await prisma.referral.deleteMany({ where: { code: { startsWith: 'ZZ' } } });
    await prisma.adminAuditLog.deleteMany({});
  };

  beforeAll(async () => {
    process.env.ADMIN_PASSCODE = OWNER_CODE;
    W = await createWorld('tm', '6', { customers: 3, vendors: 1, riders: 0 });
    await cleanup();
    // This world's admin must be the one the general code signs in: park every other admin of the throw-away database.
    otherAdmins = (await prisma.user.findMany({ where: { role: 'ADMIN', id: { not: W.admin.id }, adminDisabledAt: null }, select: { id: true } })).map((u) => u.id);
    await prisma.user.updateMany({ where: { id: { in: otherAdmins } }, data: { adminDisabledAt: new Date() } });
    server = await startTestServer(0);
    request = supertest(server.app);
  });
  afterAll(async () => {
    await cleanup();
    // Leave the throw-away database as found: the other admins signed in again, with no two-step sign-in this suite may have touched.
    await prisma.user.updateMany({ where: { id: { in: otherAdmins } }, data: { adminDisabledAt: null, adminTotpSecret: null, adminTotpEnabledAt: null, adminTotpLastStep: null, adminBackupCodes: [] } });
    await purgeWorld('tm');
    await stopTestServer(server);
  });
  beforeEach(reset);

  describe('owner and members sign in', () => {
    it('the owner signs in with the general code and keeps full access; a wrong code is refused', async () => {
      const bad = await login({ passcode: 'wrong-wrong-wrong' });
      expect(bad.status).toBe(401);
      const ok = await login({ username: 'Owner', passcode: OWNER_CODE });
      expect(ok.status).toBe(200);
      expect(ok.body.admin).toMatchObject({ adminRole: 'SUPER_ADMIN' });
      expect(ok.body.admin.access.team).toBe('write');
      expect(ok.body.admin.permissions).toContain('finance');
      const me = await call('get', '/api/admin/team/me', ok.body.token);
      expect(me.status).toBe(200);
      expect(me.body.data).toMatchObject({ isOwner: true, role: 'SUPER_ADMIN', twoFactor: false });
    });

    it('a member signs in with phone + personal code; the code never opens the owner account, nor the general code a member', async () => {
      const m = await member('SUPPORT', '77 555 00 01');
      expect(m.passcode).toHaveLength(12);
      expect(m.admin).toMatchObject({ adminRole: 'SUPPORT', phone: '+221 775550001' });
      expect((await login({ identifier: '77 555 00 01', passcode: 'not-the-code-1' })).status).toBe(401);
      expect((await login({ identifier: '77 999 99 99', passcode: m.passcode })).status).toBe(401);
      // the general code with a member's phone: refused (it is only for the owner)
      expect((await login({ identifier: '77 555 00 01', passcode: OWNER_CODE })).status).toBe(401);
      // the stored value is a hash, never the code
      const row = await prisma.user.findUniqueOrThrow({ where: { id: m.id } });
      expect(row.adminPasscodeHash).toMatch(/^scrypt\$/);
      expect(row.adminPasscodeHash).not.toContain(m.passcode);
    });

    it('refuses a duplicate phone, a bad phone and an unknown role', async () => {
      await member('SUPPORT', '77 555 00 02');
      expect((await call('post', '/api/admin/team', owner(), { name: `${NAME} dup`, phone: '77 555 00 02', role: 'SUPPORT' })).body.code).toBe('PHONE_TAKEN');
      expect((await call('post', '/api/admin/team', owner(), { name: `${NAME} bad`, phone: '12345', role: 'SUPPORT' })).body.field).toBe('phone');
      expect((await call('post', '/api/admin/team', owner(), { name: `${NAME} role`, phone: '77 555 00 03', role: 'GOD' })).body.field).toBe('role');
    });
  });

  describe('what a role may read and change', () => {
    it('FINANCE writes finance, only reads operations, and cannot see marketing or the team', async () => {
      const m = await member('FINANCE', '77 555 01 01');
      expect((await call('get', '/api/admin/settlements?pageSize=1', m.token)).status).toBe(200);
      expect((await call('get', '/api/admin/customers', m.token)).status).toBe(200); // ops: read
      const write = await call('post', '/api/admin/orders/none/cancel', m.token, { reason: 'test test' });
      expect(write.status).toBe(403);
      expect(write.body.code).toBe('READ_ONLY');
      const closed = await call('get', '/api/admin/campaigns', m.token);
      expect(closed.status).toBe(403);
      expect(closed.body.code).toBe('PERMISSION_DENIED');
      expect((await call('get', '/api/admin/team', m.token)).body.code).toBe('PERMISSION_DENIED');
      expect((await call('get', '/api/admin/team/me', m.token)).status).toBe(200); // everyone may open their own page
    });

    it('MARKETING can read customers (for segments) and simulate prices, but not change an order', async () => {
      const m = await member('MARKETING', '77 555 01 02');
      expect((await call('get', '/api/admin/customers', m.token)).status).toBe(200);
      expect((await call('post', '/api/admin/pricing/simulate', m.token, { distance_km: 2, cart_amount: 5000 })).status).toBe(200); // a POST that only computes
      expect((await call('post', '/api/admin/orders/none/cancel', m.token, { reason: 'test test' })).body.code).toBe('READ_ONLY');
      expect((await call('get', '/api/admin/campaigns', m.token)).status).toBe(200);
      expect((await call('get', '/api/admin/settlements', m.token)).body.code).toBe('PERMISSION_DENIED');
    });

    it('VIEWER reads everything except the team and changes nothing', async () => {
      const m = await member('VIEWER', '77 555 01 03');
      expect((await call('get', '/api/admin/campaigns', m.token)).status).toBe(200);
      expect((await call('get', '/api/admin/settlements', m.token)).status).toBe(200);
      const write = await call('post', '/api/admin/campaigns', m.token, { name: 'ZZ nope', description: 'ne doit pas exister', segment: {} });
      expect(write.status).toBe(403);
      expect(write.body.code).toBe('READ_ONLY');
      expect((await call('get', '/api/admin/team', m.token)).body.code).toBe('PERMISSION_DENIED');
      expect((await prisma.campaign.count({ where: { name: 'ZZ nope' } }))).toBe(0);
    });

    it('a role change applies on the next request', async () => {
      const m = await member('SUPPORT', '77 555 01 04');
      expect((await call('get', '/api/admin/settlements', m.token)).body.code).toBe('PERMISSION_DENIED');
      expect((await call('patch', `/api/admin/team/${m.id}`, owner(), { role: 'FINANCE' })).status).toBe(200);
      expect((await call('get', '/api/admin/settlements', m.token)).status).toBe(200);
    });

    it('a non-admin token is never given admin data by the guard', async () => {
      expect((await call('get', '/api/admin/customers', W.customers[0].token)).status).toBe(403);
      expect((await call('get', '/api/admin/customers', null)).status).toBe(401);
    });
  });

  describe('suspension, passcodes and protected accounts', () => {
    it('suspending signs the member out at once and blocks sign-in; reactivating restores it; a new code kills the old one', async () => {
      const m = await member('SUPPORT', '77 555 02 01');
      expect((await call('patch', `/api/admin/team/${m.id}`, owner(), { disabled: true })).status).toBe(200);
      expect((await call('get', '/api/admin/team/me', m.token)).status).toBe(401);
      expect((await login({ identifier: m.phone, passcode: m.passcode })).status).toBe(401);
      expect((await call('patch', `/api/admin/team/${m.id}`, owner(), { disabled: false })).status).toBe(200);
      expect((await login({ identifier: m.phone, passcode: m.passcode })).status).toBe(200);
      const fresh = await call('post', `/api/admin/team/${m.id}/reset-passcode`, owner(), {});
      expect(fresh.body.passcode).toHaveLength(12);
      expect((await login({ identifier: m.phone, passcode: m.passcode })).status).toBe(401);
      expect((await login({ identifier: m.phone, passcode: fresh.body.passcode })).status).toBe(200);
    });

    it('protects the owner, yourself and the last super admin', async () => {
      const list = await call('get', '/api/admin/team', owner());
      const ownerRow = list.body.data.find((r: any) => r.isOwner);
      expect(ownerRow.id).toBe(W.admin.id);
      expect((await call('patch', `/api/admin/team/${ownerRow.id}`, owner(), { role: 'SUPPORT' })).body.code).toBe('TEAM_OWNER');
      expect((await call('post', `/api/admin/team/${ownerRow.id}/reset-passcode`, owner(), {})).body.code).toBe('TEAM_OWNER');

      const superA = await member('SUPER_ADMIN', '77 555 02 02');
      expect((await call('patch', `/api/admin/team/${superA.id}`, superA.token, { role: 'SUPPORT' })).body.code).toBe('TEAM_SELF');
      // the owner can still sign in, so demoting this super admin is allowed...
      expect((await call('patch', `/api/admin/team/${superA.id}`, owner(), { role: 'SUPPORT' })).status).toBe(200);
      await prisma.user.update({ where: { id: superA.id }, data: { adminRole: 'SUPER_ADMIN' } });
      // ...but if the owner could no longer sign in, this member would be the last way in: neither demoting nor suspending is allowed
      await prisma.user.update({ where: { id: W.admin.id }, data: { adminDisabledAt: new Date() } });
      invalidateAdminRole();
      expect((await call('patch', `/api/admin/team/${superA.id}`, owner(), { role: 'SUPPORT' })).body.code).toBe('TEAM_LAST_SUPER');
      expect((await call('patch', `/api/admin/team/${superA.id}`, owner(), { disabled: true })).body.code).toBe('TEAM_LAST_SUPER');
      await prisma.user.update({ where: { id: W.admin.id }, data: { adminDisabledAt: null } });
    });

    it('a dormant old admin account can be given a code and becomes a normal member', async () => {
      const dormantId = 'tm-admin-old';
      await prisma.user.deleteMany({ where: { id: dormantId } });
      await prisma.user.create({ data: { id: dormantId, name: `${NAME} Old`, phone: '+221 775559999', role: 'ADMIN', createdAt: new Date(Date.now() + 1000) } });
      const list = await call('get', '/api/admin/team', owner());
      expect(list.body.data.find((r: any) => r.id === dormantId)).toMatchObject({ isOwner: false, dormant: true });
      const given = await call('post', `/api/admin/team/${dormantId}/reset-passcode`, owner(), {});
      expect(given.status).toBe(200);
      expect((await login({ identifier: '77 555 99 99', passcode: given.body.passcode })).status).toBe(200);
    });
  });

  describe('two-step sign-in', () => {
    it('set up, require a code at sign-in, refuse a replay, accept a backup code once, then turn off', async () => {
      const m = await member('SUPPORT', '77 555 03 01');
      const setup = await call('post', '/api/admin/team/me/2fa/setup', m.token);
      expect(setup.status).toBe(200);
      const secret: string = setup.body.data.secret;
      expect(setup.body.data.otpauthUrl).toContain('otpauth://totp/');
      expect(base32Decode(secret)).toHaveLength(20);
      // the secret is stored encrypted, not in clear
      expect((await prisma.user.findUniqueOrThrow({ where: { id: m.id } })).adminTotpSecret).not.toContain(secret);

      expect((await call('post', '/api/admin/team/me/2fa/enable', m.token, { code: '000000' })).status).toBe(400);
      const step = totpStep();
      const enabled = await call('post', '/api/admin/team/me/2fa/enable', m.token, { code: totpCode(secret, step) });
      expect(enabled.status).toBe(200);
      const backup: string[] = enabled.body.backupCodes;
      expect(backup).toHaveLength(8);
      expect(await prisma.user.findUniqueOrThrow({ where: { id: m.id } }).then((u) => u.adminBackupCodes.join(','))).not.toContain(backup[0]);

      // password alone is no longer enough
      const needOtp = await login({ identifier: m.phone, passcode: m.passcode });
      expect(needOtp.status).toBe(401);
      expect(needOtp.body.code).toBe('OTP_REQUIRED');
      expect((await login({ identifier: m.phone, passcode: m.passcode, otp: '123456' })).body.code).toBe('OTP_INVALID');
      // the code used to enable (this step) cannot be replayed; the next step is accepted once
      expect((await login({ identifier: m.phone, passcode: m.passcode, otp: totpCode(secret, step) })).body.code).toBe('OTP_INVALID');
      const good = await login({ identifier: m.phone, passcode: m.passcode, otp: totpCode(secret, step + 1) });
      expect(good.status).toBe(200);
      expect((await login({ identifier: m.phone, passcode: m.passcode, otp: totpCode(secret, step + 1) })).body.code).toBe('OTP_INVALID');

      // a backup code works once
      expect((await login({ identifier: m.phone, passcode: m.passcode, otp: backup[0] })).status).toBe(200);
      expect((await login({ identifier: m.phone, passcode: m.passcode, otp: backup[0] })).body.code).toBe('OTP_INVALID');
      expect((await call('get', '/api/admin/team/me', good.body.token)).body.data).toMatchObject({ twoFactor: true, backupCodesLeft: 7 });

      // turning it off needs a valid code
      expect((await call('post', '/api/admin/team/me/2fa/disable', good.body.token, { code: '111111' })).status).toBe(400);
      expect((await call('post', '/api/admin/team/me/2fa/disable', good.body.token, { code: backup[1] })).status).toBe(200);
      expect((await login({ identifier: m.phone, passcode: m.passcode })).status).toBe(200);
    });

    it('a super admin can clear a member who lost their phone, and it signs them out', async () => {
      const m = await member('SUPPORT', '77 555 03 02');
      const secret = (await call('post', '/api/admin/team/me/2fa/setup', m.token)).body.data.secret;
      await call('post', '/api/admin/team/me/2fa/enable', m.token, { code: totpCode(secret, totpStep()) });
      const cleared = await call('post', `/api/admin/team/${m.id}/reset-2fa`, owner(), {});
      expect(cleared.status).toBe(200);
      expect((await call('get', '/api/admin/team/me', m.token)).status).toBe(401);
      expect((await login({ identifier: m.phone, passcode: m.passcode })).status).toBe(200);
    });

    it('the owner can turn it on too: the general code then asks for the code', async () => {
      const first = await login({ passcode: OWNER_CODE });
      const secret = (await call('post', '/api/admin/team/me/2fa/setup', first.body.token)).body.data.secret;
      const step = totpStep();
      expect((await call('post', '/api/admin/team/me/2fa/enable', first.body.token, { code: totpCode(secret, step) })).status).toBe(200);
      expect((await login({ passcode: OWNER_CODE })).body.code).toBe('OTP_REQUIRED');
      const ok = await login({ passcode: OWNER_CODE, otp: totpCode(secret, step + 1) });
      expect(ok.status).toBe(200);
      // clean up so the other tests keep a one-step owner
      const off = await prisma.user.update({ where: { id: W.admin.id }, data: { adminTotpSecret: null, adminTotpEnabledAt: null, adminTotpLastStep: null, adminBackupCodes: [] } });
      expect(off.adminTotpEnabledAt).toBeNull();
    });

    it('refuses a second setup while it is on', async () => {
      const m = await member('SUPPORT', '77 555 03 03');
      const secret = (await call('post', '/api/admin/team/me/2fa/setup', m.token)).body.data.secret;
      await call('post', '/api/admin/team/me/2fa/enable', m.token, { code: totpCode(secret, totpStep()) });
      expect((await call('post', '/api/admin/team/me/2fa/setup', m.token)).body.code).toBe('TWO_FACTOR_ON');
    });
  });

  describe('sessions', () => {
    it('lists where I am signed in and closes a session so its token stops working', async () => {
      const m = await member('SUPPORT', '77 555 04 01');
      const second = await login({ identifier: m.phone, passcode: m.passcode });
      const third = await login({ identifier: m.phone, passcode: m.passcode });
      const list = await call('get', '/api/admin/team/me/sessions', second.body.token);
      expect(list.status).toBe(200);
      expect(list.body.data.length).toBeGreaterThanOrEqual(3);
      expect(list.body.data.filter((s: any) => s.current)).toHaveLength(1);
      const mine = list.body.data.find((s: any) => s.current);
      const theirs = list.body.data.find((s: any) => !s.current);

      // close another session by id
      const sids = await prisma.adminSession.findMany({ where: { userId: m.id }, orderBy: { createdAt: 'asc' } });
      const victimToken = [m.token, second.body.token, third.body.token].find((t) => JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()).sid === theirs.id)!;
      expect(sids.length).toBeGreaterThanOrEqual(3);
      expect((await call('delete', `/api/admin/team/me/sessions/${theirs.id}`, second.body.token)).status).toBe(200);
      const refused = await call('get', '/api/admin/team/me', victimToken);
      expect(refused.status).toBe(401);
      expect(refused.body.code).toBe('TOKEN_REVOKED');
      expect((await call('delete', `/api/admin/team/me/sessions/${theirs.id}`, second.body.token)).status).toBe(404);
      // somebody else's session id is not reachable
      const other = await member('SUPPORT', '77 555 04 02');
      expect((await call('delete', `/api/admin/team/me/sessions/${mine.id}`, other.token)).status).toBe(404);

      // close all the others
      const closed = await call('post', '/api/admin/team/me/sessions/revoke-others', second.body.token, {});
      expect(closed.status).toBe(200);
      expect((await call('get', '/api/admin/team/me', second.body.token)).status).toBe(200);
      expect((await call('get', '/api/admin/team/me', third.body.token)).status).toBe(401);
    });

    it('suspending a member closes all of their sessions', async () => {
      const m = await member('SUPPORT', '77 555 04 03');
      await call('patch', `/api/admin/team/${m.id}`, owner(), { disabled: true });
      expect(await prisma.adminSession.count({ where: { userId: m.id, revokedAt: null } })).toBe(0);
    });
  });

  describe('live connections follow the session', () => {
    it('refuses a closed session, and cuts the live connection of a session that is closed', async () => {
      const m = await member('SUPPORT', '77 555 07 01');
      const second = await login({ identifier: m.phone, passcode: m.passcode });
      const live = await connectTestSocket(server.baseUrl, { auth: { token: second.body.token } });
      expect(live.connected).toBe(true);
      const dropped = new Promise<string>((resolve) => live.on('disconnect', (reason) => resolve(reason)));
      const sid = JSON.parse(Buffer.from(second.body.token.split('.')[1], 'base64').toString()).sid as string;
      // the first session closes the second one from its own list
      expect((await call('delete', `/api/admin/team/me/sessions/${sid}`, m.token)).status).toBe(200);
      expect(await dropped).toBe('io server disconnect');
      await expect(connectTestSocket(server.baseUrl, { auth: { token: second.body.token } })).rejects.toThrow();
      // the first session still gets in
      const still = await connectTestSocket(server.baseUrl, { auth: { token: m.token } });
      expect(still.connected).toBe(true);
      still.disconnect();
    });

    it('closing the others keeps this device connected; suspending a member cuts every connection', async () => {
      const m = await member('SUPPORT', '77 555 07 02');
      const other = await login({ identifier: m.phone, passcode: m.passcode });
      const mine = await connectTestSocket(server.baseUrl, { auth: { token: m.token } });
      const theirs = await connectTestSocket(server.baseUrl, { auth: { token: other.body.token } });
      const theirsDropped = new Promise<string>((resolve) => theirs.on('disconnect', (r) => resolve(r)));
      expect((await call('post', '/api/admin/team/me/sessions/revoke-others', m.token, {})).status).toBe(200);
      expect(await theirsDropped).toBe('io server disconnect');
      expect(mine.connected).toBe(true);
      const mineDropped = new Promise<string>((resolve) => mine.on('disconnect', (r) => resolve(r)));
      expect((await call('patch', `/api/admin/team/${m.id}`, owner(), { disabled: true })).status).toBe(200);
      expect(await mineDropped).toBe('io server disconnect');
    });
  });

  describe('server recovery of a lost two-step sign-in', () => {
    it('finds the owner or a member by phone, clears the two-step sign-in, closes sessions and logs it', async () => {
      const m = await member('SUPPORT', '77 555 08 01');
      const secret = (await call('post', '/api/admin/team/me/2fa/setup', m.token)).body.data.secret;
      await call('post', '/api/admin/team/me/2fa/enable', m.token, { code: totpCode(secret, totpStep()) });
      expect((await login({ identifier: m.phone, passcode: m.passcode })).body.code).toBe('OTP_REQUIRED');

      expect((await findAccountToReset('owner'))?.id).toBe(W.admin.id);
      expect(await findAccountToReset('12345')).toBeNull();
      expect(await findAccountToReset('77 999 00 00')).toBeNull();
      const found = await findAccountToReset(m.phone);
      expect(found?.id).toBe(m.id);

      await resetTwoFactor(found!.id);
      expect((await call('get', '/api/admin/team/me', m.token)).status).toBe(401); // sessions closed, tokens revoked
      expect((await login({ identifier: m.phone, passcode: m.passcode })).status).toBe(200); // the code alone works again
      const row = await prisma.user.findUniqueOrThrow({ where: { id: m.id } });
      expect(row).toMatchObject({ adminTotpSecret: null, adminTotpEnabledAt: null, adminBackupCodes: [] });
      expect(await prisma.adminAuditLog.count({ where: { action: 'TWO_FACTOR_RESET', targetId: m.id } })).toBe(1);
    });
  });

  describe('prospecting', () => {
    it('tracks a lead from first contact to signature, with its history and follow-ups', async () => {
      const bad = await call('post', '/api/admin/prospects', owner(), { businessName: 'ZZ Test X', phone: 'abc' });
      expect(bad.body.field).toBe('phone');
      const created = await call('post', '/api/admin/prospects', owner(), { businessName: 'ZZ Test Chez Mama', kind: 'RESTAURANT', phone: '77 456 12 30', district: 'Randoulène', fit: 'A', nextFollowUpAt: new Date(Date.now() - 86_400_000).toISOString() });
      expect(created.status).toBe(201);
      const id = created.body.data.id;
      expect((await call('get', '/api/admin/prospects/stats', owner())).body.data).toMatchObject({ overdue: 1, counts: { TO_CONTACT: 1 } });
      expect((await call('get', '/api/admin/prospects?overdue=true', owner())).body.data.map((p: any) => p.id)).toContain(id);

      expect((await call('patch', `/api/admin/prospects/${id}`, owner(), { stage: 'CONTACTED' })).body.data.lastContactedAt).not.toBeNull();
      const note = await call('post', `/api/admin/prospects/${id}/events`, owner(), { type: 'CALL', body: 'Très intéressé.', nextFollowUpAt: new Date(Date.now() + 86_400_000).toISOString() });
      expect(note.status).toBe(201);
      expect((await call('post', `/api/admin/prospects/${id}/events`, owner(), { type: 'NOTE', body: 'x<script>' })).status).toBe(400);
      expect((await call('post', `/api/admin/prospects/${id}/events`, owner(), { type: 'STAGE', body: 'forged' })).status).toBe(400); // history of stages is written by the server only
      const signed = await call('patch', `/api/admin/prospects/${id}`, owner(), { stage: 'SIGNED' });
      expect(signed.body.data).toMatchObject({ stage: 'SIGNED', nextFollowUpAt: null });
      const detail = await call('get', `/api/admin/prospects/${id}`, owner());
      expect(detail.body.data.events.map((e: any) => e.type)).toEqual(expect.arrayContaining(['STAGE', 'CALL']));
      expect(detail.body.data.events.filter((e: any) => e.type === 'STAGE')).toHaveLength(3); // added, to contacted, to signed
      const stats = (await call('get', '/api/admin/prospects/stats', owner())).body.data;
      expect(stats.overdue).toBe(0);
      expect(stats.conversionRate).toBe(100);
      expect((await call('get', '/api/admin/prospects?q=mama', owner())).body.total).toBe(1);
      expect((await call('delete', `/api/admin/prospects/${id}`, owner())).status).toBe(200);
      expect(await prisma.prospectEvent.count({ where: { prospectId: id } })).toBe(0);
    });

    it('is closed to a role without the prospecting section', async () => {
      const m = await member('FINANCE', '77 555 05 01');
      expect((await call('get', '/api/admin/prospects', m.token)).body.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('legal documents', () => {
    const body = (extra: object = {}) => ({ type: 'TERMS', locale: 'fr', title: 'Conditions', content: 'Article 1 – Objet du service et règles générales.', ...extra });

    it('versions, publishes and activates; a published text never changes; the apps read the active one', async () => {
      const v1 = await call('post', '/api/admin/legal-documents', owner(), body());
      expect(v1.body.data.version).toBe(1);
      const v2 = await call('post', '/api/admin/legal-documents', owner(), body({ content: 'Article 1 – Nouvelle version du texte complet.' }));
      expect(v2.body.data.version).toBe(2);
      expect((await call('get', '/api/legal/terms', null)).status).toBe(404); // nothing active yet

      expect((await call('patch', `/api/admin/legal-documents/${v1.body.data.id}`, owner(), { title: 'Conditions générales' })).status).toBe(200);
      expect((await call('post', `/api/admin/legal-documents/${v1.body.data.id}/activate`, owner(), {})).body.code).toBe('LEGAL_NOT_PUBLISHED');
      expect((await call('post', `/api/admin/legal-documents/${v1.body.data.id}/publish`, owner(), {})).status).toBe(200);
      expect((await call('post', `/api/admin/legal-documents/${v1.body.data.id}/publish`, owner(), {})).body.code).toBe('LEGAL_NOT_DRAFT');
      expect((await call('patch', `/api/admin/legal-documents/${v1.body.data.id}`, owner(), { title: 'Changé après coup' })).body.code).toBe('LEGAL_NOT_DRAFT');
      expect((await call('delete', `/api/admin/legal-documents/${v1.body.data.id}`, owner())).body.code).toBe('LEGAL_NOT_DRAFT');
      expect((await call('post', `/api/admin/legal-documents/${v1.body.data.id}/activate`, owner(), {})).status).toBe(200);

      const pub = await call('get', '/api/legal/terms', null);
      expect(pub.status).toBe(200);
      expect(pub.body.data).toMatchObject({ version: 1, title: 'Conditions générales' });

      // activating v2 retires v1: one active version per type and language
      await call('post', `/api/admin/legal-documents/${v2.body.data.id}/publish`, owner(), {});
      expect((await call('post', `/api/admin/legal-documents/${v1.body.data.id}/unpublish`, owner(), {})).body.code).toBe('LEGAL_ACTIVE');
      await call('post', `/api/admin/legal-documents/${v2.body.data.id}/activate`, owner(), {});
      expect(await prisma.legalDocument.count({ where: { type: 'TERMS', locale: 'fr', isActive: true } })).toBe(1);
      expect((await call('get', '/api/legal/terms', null)).body.data.version).toBe(2);
      expect((await call('post', `/api/admin/legal-documents/${v1.body.data.id}/unpublish`, owner(), {})).status).toBe(200);
      expect((await call('delete', `/api/admin/legal-documents/${v1.body.data.id}`, owner())).status).toBe(200);
    });

    it('validates the text and the type, falls back to French, and is closed to roles without content access', async () => {
      expect((await call('post', '/api/admin/legal-documents', owner(), body({ content: 'court' }))).body.field).toBe('content');
      expect((await call('post', '/api/admin/legal-documents', owner(), body({ content: 'Un texte <b>avec</b> du HTML interdit ici.' }))).body.field).toBe('content');
      expect((await call('post', '/api/admin/legal-documents', owner(), body({ type: 'NOPE' }))).body.field).toBe('type');
      expect((await call('post', '/api/admin/legal-documents', owner(), { ...body(), extra: 1 })).status).toBe(400);
      const fr = await call('post', '/api/admin/legal-documents', owner(), body({ type: 'PRIVACY' }));
      await call('post', `/api/admin/legal-documents/${fr.body.data.id}/publish`, owner(), {});
      await call('post', `/api/admin/legal-documents/${fr.body.data.id}/activate`, owner(), {});
      expect((await call('get', '/api/legal/privacy?locale=en', null)).body.data.locale).toBe('fr');
      expect((await call('get', '/api/legal/contract-vendor', null)).status).toBe(404);
      const m = await member('FINANCE', '77 555 06 01');
      expect((await call('get', '/api/admin/legal-documents', m.token)).body.code).toBe('PERMISSION_DENIED');
    });
  });

  describe('help articles', () => {
    const article = (extra: object = {}) => ({ slug: 'zz-commander', theme: 'Commander', audience: 'CLIENT', title: 'Comment commander', content: 'Choisissez un restaurant puis payez dans l’application.', isPublished: true, sortOrder: 1, ...extra });

    it('creates, refuses a duplicate address, and shows the apps only the published ones for their audience', async () => {
      const created = await call('post', '/api/admin/help-articles', owner(), article());
      expect(created.status).toBe(201);
      expect((await call('post', '/api/admin/help-articles', owner(), article())).body.code).toBe('SLUG_TAKEN');
      expect((await call('post', '/api/admin/help-articles', owner(), article({ slug: 'Bad Slug' }))).body.field).toBe('slug');
      await call('post', '/api/admin/help-articles', owner(), article({ slug: 'zz-draft', title: 'Brouillon', isPublished: false }));
      await call('post', '/api/admin/help-articles', owner(), article({ slug: 'zz-vendor', audience: 'VENDOR', title: 'Pour les restaurants' }));
      await call('post', '/api/admin/help-articles', owner(), article({ slug: 'zz-all', audience: 'ALL', title: 'Pour tout le monde' }));

      const forClient = (await call('get', '/api/help/articles?audience=CLIENT', null)).body.data.map((a: any) => a.slug).filter((s: string) => s.startsWith('zz-')).sort();
      expect(forClient).toEqual(['zz-all', 'zz-commander']);
      const patched = await call('patch', `/api/admin/help-articles/${created.body.data.id}`, owner(), { isPublished: false });
      expect(patched.body.data.isPublished).toBe(false);
      expect((await call('get', '/api/help/articles?audience=CLIENT', null)).body.data.map((a: any) => a.slug)).not.toContain('zz-commander');
      expect((await call('delete', `/api/admin/help-articles/${created.body.data.id}`, owner())).status).toBe(200);
    });
  });

  describe('referrals (admin view)', () => {
    it('lists, counts and cancels only a pending sponsorship', async () => {
      const [a, b, c] = W.customers;
      await prisma.referral.createMany({ data: [
        { referrerId: a.id, refereeId: b.id, code: 'ZZA', status: 'PENDING' },
        { referrerId: a.id, refereeId: c.id, code: 'ZZA', status: 'REWARDED', rewardedAt: new Date() },
      ] });
      const stats = (await call('get', '/api/admin/referrals/stats', owner())).body.data;
      expect(stats).toMatchObject({ total: 2, pending: 1, rewarded: 1, conversionRate: 50 });
      expect(stats.topReferrers[0]).toMatchObject({ id: a.id, referrals: 2, rewarded: 1 });
      const pending = await call('get', '/api/admin/referrals?status=PENDING', owner());
      expect(pending.body.total).toBe(1);
      expect(pending.body.data[0].referee.id).toBe(b.id);
      expect((await call('get', '/api/admin/referrals?status=NOPE', owner())).status).toBe(400);
      const rewarded = await prisma.referral.findFirstOrThrow({ where: { status: 'REWARDED', code: 'ZZA' } });
      expect((await call('post', `/api/admin/referrals/${rewarded.id}/cancel`, owner(), {})).body.code).toBe('REFERRAL_NOT_PENDING');
      expect((await call('post', `/api/admin/referrals/${pending.body.data[0].id}/cancel`, owner(), {})).status).toBe(200);
      expect((await call('get', '/api/admin/referrals/stats', owner())).body.data).toMatchObject({ pending: 0, cancelled: 1 });
    });
  });
});
