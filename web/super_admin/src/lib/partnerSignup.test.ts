import { describe, expect, it } from 'vitest';
import { EMPTY_SIGNUP, canonicalPhone, fieldFromServer, formatPhone, frenchServerMessage, parsePartnerSession, passwordStrength, signupBody, validateSignup } from './partnerSignup';

const valid = { ...EMPTY_SIGNUP, name: 'Awa Diop', phone: '77 123 45 67', password: 'motdepasse1', restaurantName: 'Chez Awa', category: 'Grillades', address: 'Escale, Thiès' };

describe('canonicalPhone / formatPhone', () => {
  it('accepts every way a Senegalese mobile is written', () => {
    for (const raw of ['77 123 45 67', '771234567', '+221 77 123 45 67', '00221771234567', '221771234567']) expect(canonicalPhone(raw)).toBe('+221 771234567');
  });
  it('refuses landlines, short numbers and other prefixes', () => {
    for (const raw of ['33 123 45 67', '7712345', '79 123 45 67', '', 'abc']) expect(canonicalPhone(raw)).toBeNull();
  });
  it('groups digits while typing but leaves international forms alone', () => {
    expect(formatPhone('771234567')).toBe('77 123 45 67');
    expect(formatPhone('7712')).toBe('77 12');
    expect(formatPhone('+221 77 123')).toBe('+221 77 123');
  });
});

describe('validateSignup', () => {
  it('has no error for a complete form', () => expect(validateSignup(valid)).toEqual({}));
  it('names every missing field', () => {
    const errors = validateSignup(EMPTY_SIGNUP);
    expect(Object.keys(errors).sort()).toEqual(['address', 'category', 'name', 'password', 'phone', 'restaurantName']);
  });
  it('wants 8 characters for the password and a plausible NINEA when one is given', () => {
    expect(validateSignup({ ...valid, password: '1234567' }).password).toBeTruthy();
    expect(validateSignup({ ...valid, ninea: '12' }).fssaiNumber).toBeTruthy();
    expect(validateSignup({ ...valid, ninea: '0012345 2G3' }).fssaiNumber).toBeUndefined();
  });
});

describe('signupBody', () => {
  it('sends what the server expects, without empty optional fields', () => {
    expect(signupBody(valid)).toEqual({ role: 'VENDOR', name: 'Awa Diop', phone: '77 123 45 67', password: 'motdepasse1', restaurantName: 'Chez Awa', category: 'Grillades', address: 'Escale, Thiès' });
  });
  it('adds the NINEA without spaces and the pin with a rounded accuracy', () => {
    const body = signupBody({ ...valid, ninea: '0012345 2G3' }, { lat: 14.79, lng: -16.93, accuracyM: 12.6 });
    expect(body).toMatchObject({ fssaiNumber: '00123452G3', lat: 14.79, lng: -16.93, locationAccuracyM: 13 });
  });
});

describe('server answers', () => {
  it('maps server fields to form fields', () => {
    expect(fieldFromServer('fssaiNumber')).toBe('fssaiNumber');
    expect(fieldFromServer('location')).toBe('location');
    expect(fieldFromServer('role')).toBeNull();
  });
  it('translates the known messages and keeps the others', () => {
    expect(frenchServerMessage('This phone number already has an account. Try logging in.')).toContain('déjà un compte');
    expect(frenchServerMessage('Wrong phone or password.')).toContain('incorrect');
    expect(frenchServerMessage('The location must be inside Senegal.')).toContain('pas au Sénégal');
    expect(frenchServerMessage('Something unexpected')).toBe('Something unexpected');
  });
  it('rates passwords', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('abc')).toBe(1);
    expect(passwordStrength('Motdepasse12!')).toBe(4);
  });
  it('reads the session, defaulting to PENDING and keeping the filed application', () => {
    const s = parsePartnerSession({ user: { id: 'u', name: 'Awa', phone: '+221 77', role: 'VENDOR' }, vendor: { id: 'v', name: 'Chez Awa', category: 'Grillades', address: 'Thiès', fssaiNumber: '00123' } });
    expect(s.approvalStatus).toBe('PENDING');
    expect(s.application).toEqual({ restaurantName: 'Chez Awa', category: 'Grillades', address: 'Thiès', ninea: '00123' });
    expect(parsePartnerSession({ approvalStatus: 'REJECTED', rejectionReason: 'NINEA illisible', user: {} }).rejectionReason).toBe('NINEA illisible');
  });
});
