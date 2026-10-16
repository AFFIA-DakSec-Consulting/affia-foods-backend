/**
 * Back-office team: roles, what each role may open (read or write), personal passcodes, two-step sign-in, sessions, and the guard that
 * enforces all of it on every /api/admin/* route.
 *
 * - An ADMIN user with `adminRole = null` is the owner who signs in with the general ADMIN_PASSCODE: full access (nothing changes for existing setups).
 * - A team member has a role and a personal passcode (scrypt hash). The role is looked up on every request (short cache), so a change
 *   or a suspension applies within seconds, and a suspension also revokes the member's tokens.
 * - A role gives each group of routes an access level: `read` (GET) or `write` (everything). The guard decides by the first path segment after /admin.
 * - Tokens issued at sign-in carry a session id (`sid`). Closing a session from the list refuses its token at once.
 */
import { createHash, createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { NextFunction, Request, Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest, requireAuth } from '../middleware/auth';
import { clientIp } from '../middleware/rateLimit';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export const ADMIN_ROLES = ['SUPER_ADMIN', 'OPERATIONS', 'FINANCE', 'SUPPORT', 'MARKETING', 'VIEWER'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const GROUPS = ['ops', 'finance', 'marketing', 'support', 'content', 'prospecting', 'stats', 'team'] as const;
export type Group = (typeof GROUPS)[number];
export type Access = 'read' | 'write';

const all = (level: Access): Partial<Record<Group, Access>> => Object.fromEntries(GROUPS.filter((g) => g !== 'team').map((g) => [g, level]));

/** What each role may do in each group. A group that is not listed is closed. Only SUPER_ADMIN reaches `team`. */
export const ROLE_ACCESS: Record<AdminRole, Partial<Record<Group, Access>>> = {
  SUPER_ADMIN: Object.fromEntries(GROUPS.map((g) => [g, 'write'])),
  OPERATIONS: { ops: 'write', support: 'write', content: 'write', prospecting: 'write', stats: 'write', finance: 'read', marketing: 'read' },
  FINANCE: { finance: 'write', stats: 'write', ops: 'read' },
  SUPPORT: { support: 'write', ops: 'write', content: 'write', stats: 'write' },
  MARKETING: { marketing: 'write', content: 'write', prospecting: 'write', stats: 'write', ops: 'read' },
  VIEWER: all('read'),
};

const GROUP_OF: Record<string, Group> = {
  team: 'team',
  settlements: 'finance', finance: 'finance', 'rider-payouts': 'finance', 'payout-providers': 'finance', settings: 'finance', payments: 'finance',
  support: 'support', reviews: 'support',
  'legal-documents': 'content', 'help-articles': 'content',
  modules: 'marketing', 'delivery-zones': 'marketing', 'service-areas': 'marketing', 'courier-bonuses': 'marketing', promotions: 'marketing', 'subscription-plans': 'marketing',
  campaigns: 'marketing', 'loyalty-rules': 'marketing', referrals: 'marketing', pricing: 'marketing',
  prospects: 'prospecting', stats: 'stats',
};

/** The group a path under /admin belongs to ('self' = what every team member may always open). Anything not listed is operations. */
export const groupOfPath = (path: string): Group | 'self' => {
  const parts = path.split('?')[0].split('/').filter(Boolean);
  if (parts[0] === 'team' && parts[1] === 'me') return 'self';
  if (parts[0] === 'partners' && parts.includes('payout-account')) return 'finance';
  return GROUP_OF[parts[0] ?? ''] ?? 'ops';
};

/** Reading never changes anything: GET/HEAD, and the POSTs that only compute (price simulation, catalog price preview, "is this point served?"). */
export const isReadRequest = (method: string, path: string): boolean => {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return true;
  const clean = path.split('?')[0].replace(/\/+$/, '');
  return m === 'POST' && (clean === '/pricing/simulate' || clean === '/catalog/preview' || clean === '/service-areas/check');
};

export const asAdminRole = (v: unknown): AdminRole | null => (ADMIN_ROLES as readonly string[]).includes(v as string) ? (v as AdminRole) : null;
/** The level a role has on a group (the owner, with no role, has everything). */
export const accessOf = (role: AdminRole | null, group: Group): Access | null => ROLE_ACCESS[role ?? 'SUPER_ADMIN'][group] ?? null;
export type Decision = 'allowed' | 'denied' | 'read_only';
export const decide = (role: AdminRole | null, group: Group | 'self', method: string, path: string): Decision => {
  if (group === 'self') return 'allowed';
  const level = accessOf(role, group);
  if (level === null) return 'denied';
  return level === 'write' || isReadRequest(method, path) ? 'allowed' : 'read_only';
};
export const permissionsOf = (role: AdminRole | null): Group[] => GROUPS.filter((g) => accessOf(role, g) !== null);
export const accessMapOf = (role: AdminRole | null): Partial<Record<Group, Access>> => Object.fromEntries(GROUPS.flatMap((g) => { const a = accessOf(role, g); return a ? [[g, a]] : []; }));

// ----------------------------------------------------------------------------------------------- passcodes
const PASSCODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // no look-alikes (0/O, 1/l/I)
export const newPasscode = (): string => Array.from({ length: 12 }, () => PASSCODE_ALPHABET[randomInt(PASSCODE_ALPHABET.length)]).join('');

export const hashPasscode = async (passcode: string): Promise<string> => {
  const salt = randomBytes(16);
  const hash = await scrypt(passcode, salt, 32);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
};

export const verifyPasscode = async (passcode: string, stored: string | null | undefined): Promise<boolean> => {
  const [scheme, saltB64, hashB64] = (stored ?? '').split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(passcode, Buffer.from(saltB64, 'base64'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};

// ----------------------------------------------------------------------------------------------- two-step sign-in (TOTP, RFC 6238)
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const base32Encode = (buf: Buffer): string => {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
};
export const base32Decode = (text: string): Buffer => {
  let bits = 0, value = 0;
  const bytes: number[] = [];
  for (const ch of text.replace(/[\s=-]/g, '').toUpperCase()) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error('bad base32');
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(bytes);
};

export const newTotpSecret = (): string => base32Encode(randomBytes(20));
const STEP_SECONDS = 30;
export const totpStep = (now: number = Date.now()): number => Math.floor(now / 1000 / STEP_SECONDS);
export const totpCode = (secretB32: string, step: number): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const offset = h[19] & 0xf;
  const n = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(n).padStart(6, '0');
};
/** The step a code belongs to (the current one or a neighbour, for clock drift), or null. `after` refuses a step that was already used. */
export const matchTotp = (secretB32: string, code: string, after: number | null, now: number = Date.now()): number | null => {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(now);
  for (const step of [current, current - 1, current + 1]) {
    if (after !== null && step <= after) continue;
    const expected = Buffer.from(totpCode(secretB32, step));
    if (timingSafeEqual(expected, Buffer.from(code))) return step;
  }
  return null;
};
export const otpauthUrl = (secretB32: string, account: string): string =>
  `otpauth://totp/${encodeURIComponent(`Affia Foods:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent('Affia Foods')}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const newBackupCodes = (count = 8): string[] => Array.from({ length: count }, () => {
  const part = () => Array.from({ length: 4 }, () => BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)]).join('');
  return `${part()}-${part()}`;
});
export const hashBackupCode = (code: string): string => createHash('sha256').update(code.trim().toLowerCase()).digest('hex');

/** Checks the second factor of a user: an authenticator code (once per 30 s step) or a backup code (once ever). Nothing is learned from a refusal. */
export const checkSecondFactor = async (userId: string, code: string, decryptSecret: (stored: string) => string): Promise<boolean> => {
  const clean = code.trim();
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { adminTotpSecret: true, adminTotpEnabledAt: true, adminTotpLastStep: true } });
  if (!u?.adminTotpSecret || !u.adminTotpEnabledAt) return false;
  if (/^\d{6}$/.test(clean)) {
    const step = matchTotp(decryptSecret(u.adminTotpSecret), clean, u.adminTotpLastStep);
    if (step === null) return false;
    // The step is recorded in the same statement that checks it, so the same code cannot be replayed by two parallel sign-ins.
    const done = await prisma.$executeRaw`UPDATE "User" SET "adminTotpLastStep" = ${step} WHERE "id" = ${userId} AND ("adminTotpLastStep" IS NULL OR "adminTotpLastStep" < ${step})`;
    return done === 1;
  }
  if (/^[a-z0-9]{4}-[a-z0-9]{4}$/i.test(clean)) {
    const hash = hashBackupCode(clean);
    const done = await prisma.$executeRaw`UPDATE "User" SET "adminBackupCodes" = array_remove("adminBackupCodes", ${hash}) WHERE "id" = ${userId} AND ${hash} = ANY("adminBackupCodes")`;
    return done === 1;
  }
  return false;
};

// ----------------------------------------------------------------------------------------------- sessions
const SESSION_DAYS = 30;
const clip = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

export const startAdminSession = async (userId: string, req: Request) =>
  prisma.adminSession.create({ data: { userId, ip: clip(clientIp(req), 64), userAgent: clip(req.headers['user-agent'], 200), expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) } });

const sessionCache = new Map<string, number>(); // sid -> valid until (ms). Only "still open" is cached.
const lastTouch = new Map<string, number>();
const SESSION_TTL_MS = process.env.NODE_ENV === 'test' ? 0 : 10_000;
export const forgetSession = (sid?: string) => (sid ? sessionCache.delete(sid) : sessionCache.clear());

/** True while the session exists, is not closed and has not expired. A token without a session id (issued before sessions existed) is accepted. */
export const sessionIsOpen = async (sid: string | undefined, userId: string): Promise<boolean> => {
  if (!sid) return true;
  const now = Date.now();
  if ((sessionCache.get(sid) ?? 0) > now) return true;
  const row = await prisma.adminSession.findUnique({ where: { id: sid }, select: { userId: true, revokedAt: true, expiresAt: true, lastSeenAt: true } });
  if (!row || row.userId !== userId || row.revokedAt || row.expiresAt.getTime() <= now) { sessionCache.delete(sid); return false; }
  if (SESSION_TTL_MS > 0) sessionCache.set(sid, now + SESSION_TTL_MS);
  if (now - (lastTouch.get(sid) ?? 0) > 60_000 && now - row.lastSeenAt.getTime() > 60_000) {
    lastTouch.set(sid, now);
    prisma.adminSession.update({ where: { id: sid }, data: { lastSeenAt: new Date(now) } }).catch(() => { /* a missed "last seen" is harmless */ });
  }
  return true;
};

// ----------------------------------------------------------------------------------------------- role lookup + guard
const roleCache = new Map<string, { role: AdminRole | null; until: number }>();
const ROLE_TTL_MS = process.env.NODE_ENV === 'test' ? 0 : 10_000;
export const invalidateAdminRole = (userId?: string) => (userId ? roleCache.delete(userId) : roleCache.clear());

export const adminRoleOf = async (userId: string): Promise<AdminRole | null> => {
  const hit = roleCache.get(userId);
  if (hit && hit.until > Date.now()) return hit.role;
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { adminRole: true } });
  const role = asAdminRole(row?.adminRole);
  if (ROLE_TTL_MS > 0) roleCache.set(userId, { role, until: Date.now() + ROLE_TTL_MS });
  return role;
};

/** Mounted on /api/admin before every admin route. Non-admin tokens pass through: the route's own role check answers them. */
export const adminPermissionGuard = (req: AuthenticatedRequest, res: Response, next: NextFunction) =>
  requireAuth(req, res, async () => {
    try {
      if (req.user?.role !== 'ADMIN') return next();
      if (!(await sessionIsOpen(req.user.sid, req.user.id))) {
        return res.status(401).json({ success: false, code: 'TOKEN_REVOKED', message: 'This session was closed. Please sign in again.' });
      }
      const verdict = decide(await adminRoleOf(req.user.id), groupOfPath(req.path), req.method, req.path);
      if (verdict === 'allowed') return next();
      if (verdict === 'read_only') return res.status(403).json({ success: false, code: 'READ_ONLY', message: 'Your team role can read this section but not change it.' });
      return res.status(403).json({ success: false, code: 'PERMISSION_DENIED', message: 'Your team role does not give access to this section.' });
    } catch (err) {
      console.error('admin permission check failed:', (err as Error).message);
      return res.status(503).json({ success: false, message: 'Service temporarily unavailable. Please try again.' });
    }
  });
