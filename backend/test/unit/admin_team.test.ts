import {
  ADMIN_ROLES, GROUPS, accessMapOf, accessOf, base32Decode, base32Encode, decide, groupOfPath, hashBackupCode, hashPasscode, isReadRequest, matchTotp, newBackupCodes, newPasscode,
  newTotpSecret, otpauthUrl, permissionsOf, totpCode, verifyPasscode,
} from '../../src/services/adminTeam';

describe('admin team: which section a path belongs to', () => {
  it('maps a path under /admin to its group', () => {
    expect(groupOfPath('/orders/live')).toBe('ops');
    expect(groupOfPath('/customers')).toBe('ops');
    expect(groupOfPath('/settlements/abc/mark-paid')).toBe('finance');
    expect(groupOfPath('/partners/u1/payout-account/reveal')).toBe('finance');
    expect(groupOfPath('/partners/u1/reset-password')).toBe('ops');
    expect(groupOfPath('/settings/fees')).toBe('finance');
    expect(groupOfPath('/campaigns/x/send')).toBe('marketing');
    expect(groupOfPath('/modules/audit-log')).toBe('marketing');
    expect(groupOfPath('/support/tickets')).toBe('support');
    expect(groupOfPath('/legal-documents')).toBe('content');
    expect(groupOfPath('/prospects/stats')).toBe('prospecting');
    expect(groupOfPath('/stats/overview?range=7d')).toBe('stats');
    expect(groupOfPath('/team')).toBe('team');
    expect(groupOfPath('/team/me')).toBe('self');
    expect(groupOfPath('/team/me/sessions')).toBe('self');
    expect(groupOfPath('/something-new')).toBe('ops'); // an unknown path needs the operations group, never nothing
  });
});

describe('admin team: read or write', () => {
  it('counts a GET as a read, and the two POSTs that only compute', () => {
    expect(isReadRequest('GET', '/orders')).toBe(true);
    expect(isReadRequest('HEAD', '/orders')).toBe(true);
    expect(isReadRequest('POST', '/pricing/simulate')).toBe(true);
    expect(isReadRequest('POST', '/catalog/preview')).toBe(true);
    expect(isReadRequest('POST', '/service-areas/check')).toBe(true);
    expect(isReadRequest('POST', '/service-areas')).toBe(false);
    expect(isReadRequest('POST', '/orders/1/cancel')).toBe(false);
    expect(isReadRequest('POST', '/partners/u/payout-account/reveal')).toBe(false); // showing an account number is a sensitive action
    expect(isReadRequest('PATCH', '/modules/x/toggle')).toBe(false);
    expect(isReadRequest('DELETE', '/prospects/1')).toBe(false);
  });

  it('gives the owner (no role) and the super admin every section in write', () => {
    for (const g of GROUPS) {
      expect(accessOf(null, g)).toBe('write');
      expect(accessOf('SUPER_ADMIN', g)).toBe('write');
    }
    expect(permissionsOf(null)).toEqual([...GROUPS]);
  });

  it('keeps every other role out of the team, whatever else it has', () => {
    for (const role of ADMIN_ROLES.filter((r) => r !== 'SUPER_ADMIN')) {
      expect(accessOf(role, 'team')).toBeNull();
      expect(decide(role, 'team', 'GET', '/team')).toBe('denied');
    }
  });

  it('decides allowed / read only / denied from the role, the section and the method', () => {
    expect(decide('FINANCE', 'finance', 'POST', '/settlements/1/mark-paid')).toBe('allowed');
    expect(decide('FINANCE', 'ops', 'GET', '/orders')).toBe('allowed');
    expect(decide('FINANCE', 'ops', 'POST', '/orders/1/cancel')).toBe('read_only');
    expect(decide('FINANCE', 'marketing', 'GET', '/campaigns')).toBe('denied');
    expect(decide('MARKETING', 'ops', 'GET', '/customers')).toBe('allowed');
    expect(decide('MARKETING', 'ops', 'PATCH', '/vendors/1/commission')).toBe('read_only');
    expect(decide('MARKETING', 'marketing', 'POST', '/pricing/simulate')).toBe('allowed');
    expect(decide('SUPPORT', 'ops', 'POST', '/orders/1/retry-refund')).toBe('allowed');
    expect(decide('SUPPORT', 'finance', 'GET', '/settlements')).toBe('denied');
    expect(decide('VIEWER', 'marketing', 'GET', '/campaigns')).toBe('allowed');
    expect(decide('VIEWER', 'marketing', 'POST', '/campaigns')).toBe('read_only');
    expect(decide('VIEWER', 'finance', 'DELETE', '/settlements/1')).toBe('read_only');
    for (const role of ADMIN_ROLES) expect(decide(role, 'self', 'DELETE', '/team/me/sessions/1')).toBe('allowed');
  });

  it('lists what the dashboard needs: the sections a role can open and at which level', () => {
    expect(permissionsOf('FINANCE')).toEqual(['ops', 'finance', 'stats']);
    expect(accessMapOf('FINANCE')).toEqual({ ops: 'read', finance: 'write', stats: 'write' });
    expect(accessMapOf('VIEWER').team).toBeUndefined();
    expect(Object.values(accessMapOf('VIEWER')).every((a) => a === 'read')).toBe(true);
  });
});

describe('admin team: personal codes', () => {
  it('generates a readable 12-character code without look-alike characters', () => {
    const code = newPasscode();
    expect(code).toHaveLength(12);
    expect(code).toMatch(/^[A-HJ-NP-Za-km-z2-9]+$/);
    expect(newPasscode()).not.toBe(code);
  });

  it('verifies a code against its hash and refuses anything else', async () => {
    const hash = await hashPasscode('correct horse 42');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(hash).not.toContain('correct horse');
    expect(await verifyPasscode('correct horse 42', hash)).toBe(true);
    expect(await verifyPasscode('correct horse 43', hash)).toBe(false);
    expect(await verifyPasscode('', hash)).toBe(false);
    expect(await verifyPasscode('anything', null)).toBe(false);
    expect(await verifyPasscode('anything', 'not-a-hash')).toBe(false);
    expect(await hashPasscode('correct horse 42')).not.toBe(hash); // a fresh salt each time
  });
});

describe('admin team: authenticator codes (RFC 6238)', () => {
  // The reference vectors of RFC 6238 appendix B, secret "12345678901234567890" (SHA-1), 8 digits truncated to 6.
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  it('computes the reference codes', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(totpCode(secret, Math.floor(59 / 30))).toBe('287082');
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe('081804');
    expect(totpCode(secret, Math.floor(1234567890 / 30))).toBe('005924');
    expect(totpCode(secret, Math.floor(2000000000 / 30))).toBe('279037');
  });

  it('round-trips base32 and rejects garbage', () => {
    const raw = Buffer.from([1, 2, 3, 250, 251, 252, 0, 9]);
    expect(base32Decode(base32Encode(raw)).equals(raw)).toBe(true);
    expect(() => base32Decode('not*base32')).toThrow();
    const s = newTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(s)).toHaveLength(20);
  });

  it('accepts the current code and one step of clock drift, never an old step or a wrong format', () => {
    const now = 1_000_000_000_000;
    const step = Math.floor(now / 1000 / 30);
    expect(matchTotp(secret, totpCode(secret, step), null, now)).toBe(step);
    expect(matchTotp(secret, totpCode(secret, step - 1), null, now)).toBe(step - 1);
    expect(matchTotp(secret, totpCode(secret, step + 1), null, now)).toBe(step + 1);
    expect(matchTotp(secret, totpCode(secret, step - 2), null, now)).toBeNull();
    expect(matchTotp(secret, totpCode(secret, step + 2), null, now)).toBeNull();
    expect(matchTotp(secret, '12345', null, now)).toBeNull();
    expect(matchTotp(secret, 'abcdef', null, now)).toBeNull();
    // a step already used is refused (replay), a later one is fine
    expect(matchTotp(secret, totpCode(secret, step), step, now)).toBeNull();
    expect(matchTotp(secret, totpCode(secret, step + 1), step, now)).toBe(step + 1);
  });

  it('builds a link an authenticator app understands', () => {
    const url = otpauthUrl(secret, '+221 775550001');
    expect(url.startsWith('otpauth://totp/Affia%20Foods%3A')).toBe(true);
    expect(url).toContain(`secret=${secret}`);
    expect(url).toContain('digits=6');
    expect(url).toContain('period=30');
  });

  it('makes eight distinct, hashed, case-insensitive backup codes', () => {
    const codes = newBackupCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
    expect(hashBackupCode(codes[0])).toBe(hashBackupCode(` ${codes[0].toUpperCase()} `));
    expect(hashBackupCode(codes[0])).not.toBe(hashBackupCode(codes[1]));
    expect(hashBackupCode(codes[0])).toMatch(/^[0-9a-f]{64}$/);
  });
});
