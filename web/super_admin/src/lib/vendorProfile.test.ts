import { describe, expect, it } from 'vitest';
import { dayText, formFromProfile, hoursFromForm, isDirty, isOpenNow, patchFromForm, validateProfile } from './vendorProfile';

const base = formFromProfile({ name: 'Chez Awa', category: 'Sénégalais', address: 'Rue 10, Thiès', eta: '20-25 min', pickupNotes: null, bannerImage: 'https://x.test/b.jpg', logoUrl: null, description: null, phone: null, openingHours: null });

describe('vendor profile form', () => {
  it('starts from the profile and leaves closed days empty', () => {
    const form = formFromProfile({ bannerImage: 'https://x.test/b.jpg', openingHours: { mon: [{ open: '08:00', close: '14:00' }] } });
    expect(form.hours.mon).toHaveLength(1);
    expect(form.hours.tue).toEqual([]);
  });

  it('checks links, phone, description and hours like the server', () => {
    expect(validateProfile(base)).toEqual({});
    expect(validateProfile({ ...base, bannerImage: '' }).bannerImage).toBeDefined();
    expect(validateProfile({ ...base, logoUrl: 'pas un lien' }).logoUrl).toBeDefined();
    expect(validateProfile({ ...base, logoUrl: 'javascript:alert(1)' }).logoUrl).toBeDefined();
    expect(validateProfile({ ...base, phone: '123' }).phone).toBeDefined();
    expect(validateProfile({ ...base, phone: '+221 77 123 45 67' }).phone).toBeUndefined();
    expect(validateProfile({ ...base, description: 'x'.repeat(301) }).description).toBeDefined();
    const bad = { ...base, hours: { ...base.hours, mon: [{ open: '12:00', close: '08:00' }] } };
    expect(validateProfile(bad).hours).toContain('Lundi');
    const overlap = { ...base, hours: { ...base.hours, tue: [{ open: '08:00', close: '12:00' }, { open: '11:00', close: '15:00' }] } };
    expect(validateProfile(overlap).hours).toContain('chevauchent');
  });

  it('sends only what changed, and empty text clears', () => {
    const edited = { ...base, description: ' Bonne cuisine ', phone: '77 123 45 67', hours: { ...base.hours, sat: [{ open: '10:00', close: '22:00' }] } };
    expect(isDirty(edited, base)).toBe(true);
    expect(patchFromForm(edited, base)).toEqual({ description: 'Bonne cuisine', phone: '77 123 45 67', openingHours: { sat: [{ open: '10:00', close: '22:00' }] } });
    const withLogo = formFromProfile({ bannerImage: 'https://x.test/b.jpg', logoUrl: 'https://x.test/l.png' });
    expect(patchFromForm({ ...withLogo, logoUrl: '' }, withLogo)).toEqual({ logoUrl: null });
    expect(isDirty(base, base)).toBe(false);
  });

  it('sorts the periods of a day and leaves closed days out', () => {
    const hours = { ...base.hours, mon: [{ open: '18:00', close: '23:00' }, { open: '08:00', close: '14:00' }] };
    expect(hoursFromForm(hours)).toEqual({ mon: [{ open: '08:00', close: '14:00' }, { open: '18:00', close: '23:00' }] });
  });

  it('knows if the restaurant is open now in Thiès time (UTC+0), or null without hours', () => {
    const hours = { mon: [{ open: '08:00', close: '14:00' }] };
    const monday10h = Date.parse('2026-10-12T10:00:00Z');
    expect(isOpenNow(hours, monday10h)).toBe(true);
    expect(isOpenNow(hours, Date.parse('2026-10-12T15:00:00Z'))).toBe(false);
    expect(isOpenNow(hours, Date.parse('2026-10-13T10:00:00Z'))).toBe(false);
    expect(isOpenNow(null)).toBeNull();
    expect(dayText(hours.mon)).toBe('08:00 – 14:00');
    expect(dayText(undefined)).toBe('Fermé');
  });

  it('name, address, preparation time and rider notes: checked and sent as the server expects', () => {
    expect(base.prepMin).toBe('20');
    expect(base.prepMax).toBe('25');
    expect(validateProfile({ ...base, name: 'A' }).name).toBeDefined();
    expect(validateProfile({ ...base, address: '' }).address).toBeDefined();
    expect(validateProfile({ ...base, category: '' }).category).toBeDefined();
    expect(validateProfile({ ...base, prepMin: '30', prepMax: '20' }).prep).toBeDefined();
    expect(validateProfile({ ...base, prepMin: '5', prepMax: '999' }).prep).toBeDefined();
    expect(validateProfile({ ...base, pickupNotes: 'x'.repeat(201) }).pickupNotes).toBeDefined();
    const edited = { ...base, name: ' Chez Awa 2 ', address: 'Rue 12, Thiès', prepMin: '15', prepMax: '30', pickupNotes: 'Porte bleue' };
    expect(patchFromForm(edited, base)).toEqual({ name: 'Chez Awa 2', address: 'Rue 12, Thiès', eta: '15-30 min', pickupNotes: 'Porte bleue' });
    expect(patchFromForm({ ...base, pickupNotes: '' }, { ...base, pickupNotes: 'Porte bleue' })).toEqual({ pickupNotes: null });
  });
});
