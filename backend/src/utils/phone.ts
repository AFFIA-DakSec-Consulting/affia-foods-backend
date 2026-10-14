/**
 * Senegalese mobile numbers: 9 digits starting 70, 75, 76, 77 or 78 (country code +221).
 * `77 123 45 67`, `+221 77 123 45 67`, `00221771234567`, `221771234567` -> `+221 771234567`; null when it is not a valid mobile number.
 */
export const canonicalPhone = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 12 && digits.startsWith('221')) digits = digits.slice(3);
  if (!/^7[05678]\d{7}$/.test(digits)) return null;
  return `+221 ${digits}`;
};

/** The 9 national digits: the key used to find an account whatever way the number was typed or stored. */
export const phoneKey = (canonical: string) => canonical.replace(/\D/g, '').slice(-9);
