import { Router, Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest, bumpTokenVersion, requireAuth, requireRole } from '../middleware/auth';
import { AppError } from '../utils/appError';
import { fail, validParams } from '../utils/http';
import { canonicalPhone } from '../utils/phone';
import { writeAudit } from '../services/audit';
import { decryptSecret, encryptSecret } from '../services/payoutCrypto';
import {
  ADMIN_ROLES, accessMapOf, adminRoleOf, asAdminRole, checkSecondFactor, forgetSession, hashBackupCode, hashPasscode, invalidateAdminRole, matchTotp, newBackupCodes,
  newPasscode, newTotpSecret, otpauthUrl, permissionsOf,
} from '../services/adminTeam';
import { disconnectAdminSockets } from '../realtime';
import { bad, isObj, oneOf, onlyKeys, str } from '../core/modules/validate-kit';

/**
 * Team members of the back-office (/api/admin/team). The list and every change are limited to SUPER_ADMIN by the permission guard
 * (services/adminTeam.ts); /admin/team/me/* is open to every member for their own security (two-step sign-in, sessions).
 * A passcode or a backup code is shown once, when it is created, and never stored in clear.
 */
export const teamRouter = Router();
const adminOnly = [requireAuth, requireRole('ADMIN')] as const;
const actor = (req: AuthenticatedRequest) => req.user!.id;
const wrap = (what: string, fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) => async (req: AuthenticatedRequest, res: Response) => {
  try { await fn(req, res); } catch (err) { fail(res, err, what); }
};

const SELECT = {
  id: true, name: true, phone: true, adminRole: true, adminPasscodeHash: true, adminDisabledAt: true, adminLastLoginAt: true, createdAt: true,
  adminTotpEnabledAt: true, adminBackupCodes: true,
} as const;
type Row = { id: string; name: string; phone: string | null; adminRole: string | null; adminPasscodeHash: string | null; adminDisabledAt: Date | null; adminLastLoginAt: Date | null; createdAt: Date; adminTotpEnabledAt: Date | null; adminBackupCodes: string[] };

/** The one account that signs in with the general code: the oldest admin without a personal code. Any other admin without a code is dormant. */
const primaryOwnerId = async (): Promise<string | null> =>
  (await prisma.user.findFirst({ where: { role: 'ADMIN', deletedAt: null, adminPasscodeHash: null, adminRole: null, adminDisabledAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true } }))?.id ?? null;

const memberView = (u: Row, ownerId: string | null) => ({
  id: u.id, name: u.name, phone: u.phone,
  role: asAdminRole(u.adminRole) ?? 'SUPER_ADMIN',
  isOwner: u.id === ownerId,
  // An old admin account that has no personal code and is not the owner: it cannot sign in until it is given a code.
  dormant: u.adminPasscodeHash === null && u.id !== ownerId,
  disabled: u.adminDisabledAt !== null,
  twoFactor: u.adminTotpEnabledAt !== null,
  lastLoginAt: u.adminLastLoginAt?.toISOString() ?? null,
  createdAt: u.createdAt.toISOString(),
});

/** Active super admins that can really sign in, other than `exceptId`: the team must always keep one. */
const otherUsableSupers = async (exceptId: string, ownerId: string | null): Promise<number> => {
  const members = await prisma.user.count({ where: { role: 'ADMIN', deletedAt: null, adminDisabledAt: null, adminRole: 'SUPER_ADMIN', adminPasscodeHash: { not: null }, id: { not: exceptId } } });
  return members + (ownerId && ownerId !== exceptId ? 1 : 0);
};

const closeAllSessions = async (userId: string) => {
  await prisma.adminSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  forgetSession();
  await disconnectAdminSockets({ userId });
};

const twoFactorUnavailable = (err: unknown): never => {
  if (err instanceof AppError && err.code === 'PAYOUT_ENCRYPTION_NOT_CONFIGURED') throw new AppError(503, 'TWO_FACTOR_UNAVAILABLE', 'Two-step sign-in needs the server encryption key (PAYOUT_ENC_KEY), which is not configured.');
  throw err;
};

// ----------------------------------------------------------------------------------------------- my own account
teamRouter.get('/admin/team/me', ...adminOnly, wrap('team me', async (req, res) => {
  const role = await adminRoleOf(actor(req));
  const u = await prisma.user.findUnique({ where: { id: actor(req) }, select: SELECT });
  if (!u) throw new AppError(404, 'NOT_FOUND', 'Unknown account.');
  res.json({ success: true, data: { ...memberView(u, await primaryOwnerId()), role: role ?? 'SUPER_ADMIN', permissions: permissionsOf(role), access: accessMapOf(role), backupCodesLeft: u.adminBackupCodes.length } });
}));

/** Step 1: a fresh secret, not active yet. The person adds it to their authenticator app, then confirms with a code (step 2). */
teamRouter.post('/admin/team/me/2fa/setup', ...adminOnly, wrap('2fa setup', async (req, res) => {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor(req) }, select: { name: true, phone: true, adminTotpEnabledAt: true } });
  if (u.adminTotpEnabledAt) throw new AppError(409, 'TWO_FACTOR_ON', 'Two-step sign-in is already on. Turn it off first to set it up again.');
  const secret = newTotpSecret();
  try { await prisma.user.update({ where: { id: actor(req) }, data: { adminTotpSecret: encryptSecret(secret, `totp:${actor(req)}`), adminTotpLastStep: null } }); } catch (e) { twoFactorUnavailable(e); }
  res.json({ success: true, data: { secret, otpauthUrl: otpauthUrl(secret, u.phone ?? u.name) } });
}));

/** Step 2: the first valid code turns it on and returns the backup codes, once. */
teamRouter.post('/admin/team/me/2fa/enable', ...adminOnly, wrap('2fa enable', async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  onlyKeys(b, ['code']);
  const code = str(b, 'code', 6, 6);
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor(req) }, select: { adminTotpSecret: true, adminTotpEnabledAt: true } });
  if (u.adminTotpEnabledAt) throw new AppError(409, 'TWO_FACTOR_ON', 'Two-step sign-in is already on.');
  if (!u.adminTotpSecret) throw new AppError(409, 'TWO_FACTOR_NOT_STARTED', 'Start the setup first.');
  const step = matchTotp(decryptSecret(u.adminTotpSecret, `totp:${actor(req)}`), code, null);
  if (step === null) throw bad('code', 'This code is not valid. Check the time on your phone and try the next code.');
  const codes = newBackupCodes();
  await prisma.user.update({ where: { id: actor(req) }, data: { adminTotpEnabledAt: new Date(), adminTotpLastStep: step, adminBackupCodes: codes.map(hashBackupCode) } });
  await writeAudit('TWO_FACTOR_ENABLED', 'ADMIN_USER', actor(req), 'authenticator app');
  res.json({ success: true, backupCodes: codes });
}));

teamRouter.post('/admin/team/me/2fa/disable', ...adminOnly, wrap('2fa disable', async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  onlyKeys(b, ['code']);
  const code = str(b, 'code', 6, 9);
  if (!(await checkSecondFactor(actor(req), code, (stored) => decryptSecret(stored, `totp:${actor(req)}`)))) throw bad('code', 'This code is not valid.');
  await prisma.user.update({ where: { id: actor(req) }, data: { adminTotpSecret: null, adminTotpEnabledAt: null, adminTotpLastStep: null, adminBackupCodes: [] } });
  await writeAudit('TWO_FACTOR_DISABLED', 'ADMIN_USER', actor(req), 'by the person');
  res.json({ success: true });
}));

teamRouter.get('/admin/team/me/sessions', ...adminOnly, wrap('my sessions', async (req, res) => {
  const rows = await prisma.adminSession.findMany({ where: { userId: actor(req), revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: 'desc' }, take: 50 });
  res.json({ success: true, data: rows.map((s) => ({ id: s.id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString(), current: s.id === req.user!.sid })) });
}));

teamRouter.post('/admin/team/me/sessions/revoke-others', ...adminOnly, wrap('revoke other sessions', async (req, res) => {
  const done = await prisma.adminSession.updateMany({ where: { userId: actor(req), revokedAt: null, ...(req.user!.sid ? { id: { not: req.user!.sid } } : {}) }, data: { revokedAt: new Date() } });
  forgetSession();
  await disconnectAdminSockets({ userId: actor(req), exceptSid: req.user!.sid });
  await writeAudit('SESSIONS_REVOKED', 'ADMIN_USER', actor(req), `${done.count} other sessions closed`);
  res.json({ success: true, closed: done.count });
}));

teamRouter.delete('/admin/team/me/sessions/:id', ...adminOnly, validParams('id'), wrap('revoke session', async (req, res) => {
  const done = await prisma.adminSession.updateMany({ where: { id: req.params.id, userId: actor(req), revokedAt: null }, data: { revokedAt: new Date() } });
  if (done.count === 0) throw new AppError(404, 'NOT_FOUND', 'Unknown session.');
  forgetSession(req.params.id);
  await disconnectAdminSockets({ sid: req.params.id });
  res.json({ success: true });
}));

// ----------------------------------------------------------------------------------------------- the team (super admin)
teamRouter.get('/admin/team', ...adminOnly, wrap('list team', async (_req, res) => {
  const ownerId = await primaryOwnerId();
  const rows = await prisma.user.findMany({ where: { role: 'ADMIN', deletedAt: null }, select: SELECT, orderBy: { createdAt: 'asc' } });
  res.json({ success: true, data: rows.map((r) => memberView(r, ownerId)) });
}));

teamRouter.post('/admin/team', ...adminOnly, wrap('create team member', async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  onlyKeys(b, ['name', 'phone', 'role']);
  const name = str(b, 'name', 2, 80);
  const phone = canonicalPhone(b.phone);
  if (!phone) throw bad('phone', 'Enter a Senegalese mobile number (for example 77 123 45 67).');
  const role = oneOf(b, 'role', ADMIN_ROLES);
  if (await prisma.user.findUnique({ where: { phone }, select: { id: true } })) throw new AppError(409, 'PHONE_TAKEN', 'This phone number already has an account.', 'phone');
  const passcode = newPasscode();
  const user = await prisma.user.create({ data: { name, phone, role: 'ADMIN', adminRole: role, adminPasscodeHash: await hashPasscode(passcode), hostelBlock: 'Escale' }, select: SELECT });
  await writeAudit('TEAM_MEMBER_CREATED', 'ADMIN_USER', user.id, `${role} by ${actor(req)}`);
  res.status(201).json({ success: true, data: memberView(user, await primaryOwnerId()), passcode });
}));

teamRouter.patch('/admin/team/:id', ...adminOnly, validParams('id'), wrap('update team member', async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  onlyKeys(b, ['role', 'disabled']);
  if (b.role === undefined && b.disabled === undefined) throw bad('body', 'Nothing to change.');
  if (b.disabled !== undefined && typeof b.disabled !== 'boolean') throw bad('disabled', 'disabled must be true or false.');
  const target = await prisma.user.findFirst({ where: { id: req.params.id, role: 'ADMIN', deletedAt: null }, select: SELECT });
  if (!target) throw new AppError(404, 'NOT_FOUND', 'Unknown team member.');
  const ownerId = await primaryOwnerId();
  const view = memberView(target, ownerId);
  if (view.isOwner) throw new AppError(409, 'TEAM_OWNER', 'The owner account signs in with the general access code and cannot be changed here.');
  if (target.id === actor(req)) throw new AppError(409, 'TEAM_SELF', 'You cannot change your own role or suspend yourself.');
  const nextRole = b.role === undefined ? undefined : oneOf(b, 'role', ADMIN_ROLES);
  const losesSuper = view.role === 'SUPER_ADMIN' && !view.disabled && !view.dormant && ((nextRole !== undefined && nextRole !== 'SUPER_ADMIN') || b.disabled === true);
  if (losesSuper && (await otherUsableSupers(target.id, ownerId)) === 0) throw new AppError(409, 'TEAM_LAST_SUPER', 'The team needs at least one active super admin.');
  const updated = await prisma.user.update({
    where: { id: target.id },
    data: { ...(nextRole ? { adminRole: nextRole } : {}), ...(b.disabled === undefined ? {} : { adminDisabledAt: b.disabled ? new Date() : null }) },
    select: SELECT,
  });
  invalidateAdminRole(target.id);
  if (b.disabled === true) { await bumpTokenVersion(target.id); await closeAllSessions(target.id); } // signs the member out everywhere, right now
  await writeAudit('TEAM_MEMBER_UPDATED', 'ADMIN_USER', target.id, `${nextRole ? `role ${nextRole}` : ''}${b.disabled === undefined ? '' : b.disabled ? ' suspended' : ' reactivated'} by ${actor(req)}`.trim());
  res.json({ success: true, data: memberView(updated, ownerId) });
}));

teamRouter.post('/admin/team/:id/reset-passcode', ...adminOnly, validParams('id'), wrap('reset team passcode', async (req, res) => {
  const target = await prisma.user.findFirst({ where: { id: req.params.id, role: 'ADMIN', deletedAt: null }, select: SELECT });
  if (!target) throw new AppError(404, 'NOT_FOUND', 'Unknown team member.');
  const ownerId = await primaryOwnerId();
  if (target.id === ownerId) throw new AppError(409, 'TEAM_OWNER', 'The owner account signs in with the general access code and cannot be changed here.');
  const passcode = newPasscode();
  // An old admin account without a code becomes a normal member the moment it gets one (with the role it was given, or SUPER_ADMIN by default).
  await prisma.user.update({ where: { id: target.id }, data: { adminPasscodeHash: await hashPasscode(passcode), ...(target.adminRole === null ? { adminRole: 'SUPER_ADMIN' } : {}) } });
  invalidateAdminRole(target.id);
  await bumpTokenVersion(target.id);
  await closeAllSessions(target.id);
  await writeAudit('TEAM_PASSCODE_RESET', 'ADMIN_USER', target.id, `by ${actor(req)}`);
  res.json({ success: true, passcode });
}));

/** Recovery: a person who lost their phone and their backup codes. Everything of the two-step sign-in is cleared and their sessions are closed. */
teamRouter.post('/admin/team/:id/reset-2fa', ...adminOnly, validParams('id'), wrap('reset team 2fa', async (req, res) => {
  const target = await prisma.user.findFirst({ where: { id: req.params.id, role: 'ADMIN', deletedAt: null }, select: { id: true } });
  if (!target) throw new AppError(404, 'NOT_FOUND', 'Unknown team member.');
  if (target.id === actor(req)) throw new AppError(409, 'TEAM_SELF', 'Turn off your own two-step sign-in from your security page.');
  await prisma.user.update({ where: { id: target.id }, data: { adminTotpSecret: null, adminTotpEnabledAt: null, adminTotpLastStep: null, adminBackupCodes: [] } });
  await bumpTokenVersion(target.id);
  await closeAllSessions(target.id);
  await writeAudit('TWO_FACTOR_RESET', 'ADMIN_USER', target.id, `by ${actor(req)}`);
  res.json({ success: true });
}));
