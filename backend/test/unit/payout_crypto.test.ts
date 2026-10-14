/**
 * Payout encryption, masking, payout-detail validation and CSV / money helpers (Docs/21 phase 2). Pure: no database access.
 */
import { randomBytes } from 'crypto';
import { AppError } from '../../src/utils/appError';
import { decryptSecret, encryptSecret, last4, maskAccount, payoutEncryptionConfigured } from '../../src/services/payoutCrypto';
import { parsePayoutInput } from '../../src/services/payoutAccount';
import { csvNum, csvText } from '../../src/services/settlement';
import { fromPaise, toPaise } from '../../src/services/pricing';
import { parseLocalRange } from '../../src/utils/range';
import { addLocalDays, isLocalDateString, localDateString, localDayStartOf, localInstant } from '../../src/utils/time';

const KEY = randomBytes(32).toString('base64');
const saved = process.env.PAYOUT_ENC_KEY;
beforeEach(() => { process.env.PAYOUT_ENC_KEY = KEY; });
afterAll(() => { if (saved === undefined) delete process.env.PAYOUT_ENC_KEY; else process.env.PAYOUT_ENC_KEY = saved; });

const thrown = (fn: () => unknown): AppError => {
  try { fn(); } catch (e) { return e as AppError; }
  throw new Error('expected a throw');
};

describe('AES-256-GCM account number encryption', () => {
  test('round trip, the ciphertext hides the number and never repeats (fresh IV)', () => {
    const a = encryptSecret('123456789012', 'user-1');
    const b = encryptSecret('123456789012', 'user-1');
    expect(decryptSecret(a, 'user-1')).toBe('123456789012');
    expect(decryptSecret(b, 'user-1')).toBe('123456789012');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(a).not.toContain('123456789012');
    expect(Buffer.from(a.split('.')[3], 'base64url').toString('utf8')).not.toContain('1234');
  });

  test('a ciphertext copied to another user, a flipped byte, or another key does not decrypt (and the error carries no value)', () => {
    const c = encryptSecret('998877665544', 'user-1');
    for (const bad of [() => decryptSecret(c, 'user-2'), () => decryptSecret(c.slice(0, -2) + (c.endsWith('AA') ? 'BB' : 'AA'), 'user-1'), () => decryptSecret('garbage', 'user-1')]) {
      const e = thrown(bad);
      expect(e).toBeInstanceOf(AppError);
      expect(e.code).toBe('PAYOUT_DECRYPT_FAILED');
      expect(e.message).not.toContain('9988');
    }
    process.env.PAYOUT_ENC_KEY = randomBytes(32).toString('base64');
    expect(thrown(() => decryptSecret(c, 'user-1')).code).toBe('PAYOUT_DECRYPT_FAILED');
  });

  test('a missing or malformed key is a clear 503, UPI never needs it', () => {
    delete process.env.PAYOUT_ENC_KEY;
    expect(payoutEncryptionConfigured()).toBe(false);
    const e = thrown(() => encryptSecret('123456', 'u'));
    expect(e.status).toBe(503);
    expect(e.code).toBe('PAYOUT_ENCRYPTION_NOT_CONFIGURED');
    expect(e.message).toMatch(/not configured/i);
    process.env.PAYOUT_ENC_KEY = randomBytes(16).toString('base64'); // 16 bytes: wrong size
    expect(payoutEncryptionConfigured()).toBe(false);
    expect(thrown(() => encryptSecret('123456', 'u')).status).toBe(503);
    process.env.PAYOUT_ENC_KEY = KEY;
    expect(payoutEncryptionConfigured()).toBe(true);
  });
});

describe('masking', () => {
  test('last4 and the XXXXXX mask', () => {
    expect(last4('123456789012')).toBe('9012');
    expect(maskAccount('9012')).toBe('XXXXXX9012');
    expect(maskAccount(null)).toBeNull();
    expect(maskAccount('')).toBeNull();
  });
});

describe('payout detail validation', () => {
  const field = (raw: unknown) => thrown(() => parsePayoutInput(raw)).field;
  test('WAVE / ORANGE_MONEY: a Senegalese mobile number, bank fields refused', () => {
    expect(parsePayoutInput({ method: 'WAVE', phone: ' 77 123 45 67 ' })).toEqual({ method: 'WAVE', phone: '+221 771234567', accountHolder: null });
    expect(parsePayoutInput({ method: 'ORANGE_MONEY', phone: '+221 78 000 11 22', accountHolder: 'Awa Diop' })).toEqual({ method: 'ORANGE_MONEY', phone: '+221 780001122', accountHolder: 'Awa Diop' });
    for (const bad of ['', 'nobody', '12345', '+91 9876543210', '33 123 45 67', '77 123 45 6']) expect(field({ method: 'WAVE', phone: bad })).toBe('phone');
    expect(field({ method: 'WAVE', phone: '771234567', accountNumber: 'SN08SN0100152000048500003035' })).toBe('accountNumber');
    expect(field({ method: 'WAVE' })).toBe('phone');
  });
  test('BANK: holder 2-80, IBAN/RIB 10-34 letters and digits, bank name required, strings only', () => {
    const ok = { method: 'BANK', accountHolder: 'Fatou Diop', accountNumber: 'sn08 sn01 0015 2000 0485 0000 3035', bankName: 'CBAO' };
    expect(parsePayoutInput(ok)).toEqual({ method: 'BANK', accountHolder: 'Fatou Diop', accountNumber: 'SN08SN0100152000048500003035', bankName: 'CBAO' });
    expect(parsePayoutInput({ ...ok, accountNumber: '1'.repeat(34) })).toMatchObject({ accountNumber: '1'.repeat(34) });
    expect(field({ ...ok, accountNumber: '123456789' })).toBe('accountNumber');
    expect(field({ ...ok, accountNumber: '1'.repeat(35) })).toBe('accountNumber');
    expect(field({ ...ok, accountNumber: 'SN08*SN0100152000' })).toBe('accountNumber');
    expect(field({ ...ok, accountNumber: 1234567890123 })).toBe('accountNumber'); // a JSON number would lose leading zeros
    expect(field({ ...ok, bankName: undefined })).toBe('bankName');
    expect(field({ ...ok, accountHolder: 'R' })).toBe('accountHolder');
    expect(field({ ...ok, accountHolder: 'R'.repeat(81) })).toBe('accountHolder');
    expect(field({ ...ok, accountHolder: '<script>' })).toBe('accountHolder');
    expect(field({ ...ok, accountHolder: undefined })).toBe('accountHolder');
    expect(field({ ...ok, phone: '771234567' })).toBe('phone');
  });
  test('unknown fields, wrong method and non-objects are refused', () => {
    expect(field({ method: 'WAVE', phone: '771234567', accountLast4: '1234' })).toBe('accountLast4');
    expect(field({ method: 'UPI', upiId: 'ram@upi' })).toBe('upiId');
    expect(field({ method: 'CASH' })).toBe('method');
    expect(field(null)).toBe('body');
    expect(field([])).toBe('body');
    expect(field('WAVE')).toBe('body');
  });
});

describe('money and CSV helpers', () => {
  test('paise sums of float-hostile amounts are exact', () => {
    const amounts = [33.33, 33.33, 33.34, 0.1, 0.2, 19.99, 0.07];
    expect(fromPaise(amounts.reduce((a, x) => a + toPaise(x), 0))).toBe(120.36);
    expect(amounts.reduce((a, x) => a + x, 0)).not.toBe(120.36); // plain float addition drifts: that is why paise are used
  });
  test('csvNum always has 2 decimals; csvText escapes and guards formulas', () => {
    expect(csvNum(12)).toBe('12.00');
    expect(csvNum(-0.5)).toBe('-0.50');
    expect(csvNum(null)).toBe('');
    expect(csvText('plain')).toBe('plain');
    expect(csvText('a,b')).toBe('"a,b"');
    expect(csvText('say "hi"')).toBe('"say ""hi"""');
    expect(csvText('line1\nline2')).toBe('"line1\nline2"');
    for (const f of ['=1+1', '+SUM(A1)', '-2+3', '@cmd', '\tx', '\rx']) expect(csvText(f).replace(/"/g, '').startsWith("'")).toBe(true);
    expect(csvText('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
    expect(csvText(null)).toBe('');
    expect(csvText('safe=ok')).toBe('safe=ok');
  });
});

describe('Local day helpers (Africa/Dakar, UTC+0)', () => {
  test('dates, instants and ranges use the Dakar calendar', () => {
    expect(isLocalDateString('2026-10-10')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '26-10-10', '2026-10-1', '', 'today', 20261010, null]) expect(isLocalDateString(bad)).toBe(false);
    expect(localDayStartOf('2026-10-10').toISOString()).toBe('2026-10-10T00:00:00.000Z');
    expect(localInstant('2026-10-10', '22:00').toISOString()).toBe('2026-10-10T22:00:00.000Z');
    expect(localDateString(new Date('2026-10-10T23:59:59.999Z'))).toBe('2026-10-10');
    expect(localDateString(new Date('2026-10-11T00:00:00.000Z'))).toBe('2026-10-11');
    expect(addLocalDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addLocalDays('2026-01-01', -1)).toBe('2025-12-31');
    const r = parseLocalRange(undefined, undefined, { defaultDays: 7, maxDays: 366, now: new Date('2026-10-10T20:00:00Z') }); // 10 Oct 20:00 in Dakar
    expect([r.from, r.to, r.days]).toEqual(['2026-10-04', '2026-10-10', 7]);
    expect(parseLocalRange('2025-10-10', '2026-10-10', { defaultDays: 7, maxDays: 366 }).days).toBe(366);
    expect(thrown(() => parseLocalRange('2025-10-09', '2026-10-10', { defaultDays: 7, maxDays: 366 })).field).toBe('from');
    expect(thrown(() => parseLocalRange('2026-10-11', '2026-10-10', { defaultDays: 7, maxDays: 366 })).status).toBe(400);
    expect(thrown(() => parseLocalRange('nope', undefined, { defaultDays: 7, maxDays: 366 })).field).toBe('from');
  });
});
