import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { Role } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../utils/appError';
import { canonicalPhone, phoneKey } from '../utils/phone';
import { getOtpSender } from './otpSender';

/**
 * Customer sign-in by phone number + 6-digit code.
 *   POST /auth/otp/request {phone}        -> a code is sent (WhatsApp), valid 5 minutes
 *   POST /auth/otp/verify  {phone, code}  -> the account is found or created and the token is returned
 * A code can be tried 5 times, a new one can be asked every 45 s, at most 5 per hour per number. Only a keyed hash is stored.
 *
 * Test client: the number below always gets the code 123456 and nothing is sent. Allowed unless NODE_ENV=production
 * (OTP_TEST_CLIENT=true allows it there too, OTP_TEST_CLIENT=false forbids it everywhere).
 */
export const OTP_TTL_MS = 5 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_MS = 45_000;
export const OTP_MAX_PER_HOUR = 5;
export const TEST_CLIENT = Object.freeze({ phone: '+221 770000000', code: '123456', name: 'Client Test', quartier: 'Escale' });

const testClientAllowed = () => (process.env.OTP_TEST_CLIENT ? process.env.OTP_TEST_CLIENT === 'true' : process.env.NODE_ENV !== 'production');
const isTestClient = (phone: string) => testClientAllowed() && phone === TEST_CLIENT.phone;

const key = () => process.env.JWT_SECRET || (process.env.NODE_ENV === 'test' ? 'kraveo_vit_bhopal_super_secret_jwt_key_2026' : 'kraveo-otp');
const hash = (phone: string, code: string) => createHmac('sha256', key()).update(`${phone}|${code}`).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const badPhone = () => new AppError(400, 'BAD_REQUEST', 'Enter a valid Senegalese mobile number (for example 77 123 45 67).', 'phone');

export const requestOtp = async (rawPhone: unknown) => {
  const phone = canonicalPhone(rawPhone);
  if (!phone) throw badPhone();
  const owner = await prisma.user.findFirst({ where: { phone: { endsWith: phoneKey(phone) }, deletedAt: null }, select: { role: true } });
  if (owner && owner.role !== Role.STUDENT) throw new AppError(403, 'PARTNER_ACCOUNT', 'This number belongs to a Kraveo partner. Use the partner app.');

  const sender = isTestClient(phone) ? null : getOtpSender();
  if (!isTestClient(phone) && !sender) throw new AppError(503, 'OTP_NOT_CONFIGURED', 'Sign-in codes cannot be sent right now. Please try again later.');

  const now = Date.now();
  const recent = await prisma.phoneOtp.findMany({ where: { phone, createdAt: { gte: new Date(now - 3_600_000) } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
  if (recent.length > 0) {
    const wait = recent[0].createdAt.getTime() + OTP_RESEND_MS - now;
    if (wait > 0) throw new AppError(429, 'OTP_TOO_SOON', 'A code was just sent. Wait a moment before asking for another.', undefined, { retryAfterSeconds: Math.ceil(wait / 1000) });
  }
  if (recent.length >= OTP_MAX_PER_HOUR) {
    throw new AppError(429, 'RATE_LIMITED', 'Too many codes asked for this number. Try again in an hour.', undefined, { retryAfterSeconds: 3600 });
  }

  const code = isTestClient(phone) ? TEST_CLIENT.code : String(randomInt(0, 1_000_000)).padStart(6, '0');
  const row = await prisma.phoneOtp.create({ data: { phone, codeHash: hash(phone, code), expiresAt: new Date(now + OTP_TTL_MS) } });
  if (sender) {
    try {
      await sender.send(phone, code);
    } catch {
      await prisma.phoneOtp.delete({ where: { id: row.id } }).catch(() => undefined); // a code nobody received must not count against the hourly cap
      throw new AppError(503, 'OTP_SEND_FAILED', 'The code could not be sent. Please try again.');
    }
  }
  return {
    phone,
    channel: sender?.channel ?? 'test',
    expiresInSeconds: OTP_TTL_MS / 1000,
    resendAfterSeconds: OTP_RESEND_MS / 1000,
    // Only with the console sender outside production (local development without WhatsApp): the code is returned so the app can be tried.
    ...(sender?.channel === 'console' && process.env.NODE_ENV !== 'production' ? { debugCode: code } : {}),
  };
};

/** Checks the code and returns the customer (created on the first sign-in). */
export const verifyOtp = async (rawPhone: unknown, rawCode: unknown) => {
  const phone = canonicalPhone(rawPhone);
  if (!phone) throw badPhone();
  const code = typeof rawCode === 'string' ? rawCode.trim() : '';
  if (!/^\d{6}$/.test(code)) throw new AppError(400, 'BAD_REQUEST', 'Enter the 6-digit code.', 'code');

  const row = await prisma.phoneOtp.findFirst({ where: { phone, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  const invalid = () => new AppError(400, 'OTP_INVALID', 'This code is wrong or has expired. Ask for a new one.', 'code');
  if (!row) throw invalid();
  if (row.attempts >= OTP_MAX_ATTEMPTS) throw new AppError(429, 'OTP_LOCKED', 'Too many wrong codes. Ask for a new one.');

  // Count the try first so that parallel guesses cannot all slip under the limit.
  const counted = await prisma.phoneOtp.updateMany({ where: { id: row.id, attempts: { lt: OTP_MAX_ATTEMPTS }, consumedAt: null }, data: { attempts: { increment: 1 } } });
  if (counted.count === 0) throw new AppError(429, 'OTP_LOCKED', 'Too many wrong codes. Ask for a new one.');
  if (!sameHash(row.codeHash, hash(phone, code))) throw invalid();
  const used = await prisma.phoneOtp.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (used.count === 0) throw invalid(); // the same code used twice at once

  let user = await prisma.user.findFirst({ where: { phone: { endsWith: phoneKey(phone) }, deletedAt: null } });
  let isNewUser = false;
  if (user && user.role !== Role.STUDENT) throw new AppError(403, 'PARTNER_ACCOUNT', 'This number belongs to a Kraveo partner. Use the partner app.');
  if (!user) {
    try {
      user = await prisma.user.create({ data: { phone, name: 'Client', role: Role.STUDENT } });
      isNewUser = true;
    } catch (err: any) {
      if (err?.code !== 'P2002') throw err;
      user = await prisma.user.findFirstOrThrow({ where: { phone, deletedAt: null } }); // two first sign-ins at once
    }
  }
  return { user, isNewUser };
};

/** Creates (or refreshes) the test client with a complete profile, so it goes straight to the home screen. */
export const ensureTestClient = async () => {
  const data = { name: TEST_CLIENT.name, phone: TEST_CLIENT.phone, role: Role.STUDENT, avatarId: 1, hostelBlock: TEST_CLIENT.quartier, kraveoCoins: 100 };
  return prisma.user.upsert({ where: { phone: TEST_CLIENT.phone }, update: data, create: { id: 'demo-cus-test', ...data } });
};
