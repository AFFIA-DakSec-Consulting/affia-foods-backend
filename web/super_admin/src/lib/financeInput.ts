// Validation of what an admin types in the Finance forms. The server stays the authority (backend services/settlement.ts,
// finance.ts, payoutAccount.ts, pricing.ts); these rules copy it so an obvious mistake never needs a round trip.
// Every validator returns { ok: true, value } or { ok: false, errors } with one plain message per field.

import { addDays, isDateString, istToday } from './financeParse';
import { frNumber } from './pricing';

export type Checked<T> = { ok: true; value: T } | { ok: false; errors: Record<string, string> };
const fail = (errors: Record<string, string>): { ok: false; errors: Record<string, string> } => ({ ok: false, errors });

const clean = (text: string): string => text.trim().replace(/\s+/g, ' ');

export const REFERENCE_RE = /^[A-Za-z0-9][A-Za-z0-9 _.\/:#-]{2,63}$/;
const REFERENCE_MESSAGE = 'La référence doit faire de 3 à 64 caractères : lettres, chiffres, espace et _ . / : # -';

/** A random id so a double click or a retry of the same form is recognised by the server as the same adjustment. */
export const newRequestId = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
};

// ───────────────────────────── Mark paid ─────────────────────────────

export interface MarkPaidInput { reference: string; paidAt?: string; note?: string }

/**
 * `paidDate` is an India date (YYYY-MM-DD) or empty. Today's date (or empty) lets the server use "now"; an earlier date is sent as
 * noon India time of that day. A future date is refused.
 */
export const validateMarkPaid = (form: { reference: string; paidDate: string; note: string }, nowMs: number = Date.now()): Checked<MarkPaidInput> => {
  const errors: Record<string, string> = {};
  const reference = clean(form.reference);
  if (reference === '') errors.reference = 'Saisissez la référence de la transaction (virement bancaire ou UPI).';
  else if (!REFERENCE_RE.test(reference)) errors.reference = REFERENCE_MESSAGE;
  const value: MarkPaidInput = { reference };
  const date = form.paidDate.trim();
  if (date !== '') {
    if (!isDateString(date)) errors.paidDate = 'Choisissez une date de paiement valide.';
    else if (date > istToday(nowMs)) errors.paidDate = 'La date de paiement ne peut pas être dans le futur.';
    else if (date < istToday(nowMs)) value.paidAt = `${date}T12:00:00+05:30`;
  }
  const note = form.note.trim();
  if (note.length > 300) errors.note = 'La note ne peut pas dépasser 300 caractères.';
  else if (note !== '') value.note = note;
  return Object.keys(errors).length > 0 ? fail(errors) : { ok: true, value };
};

// ───────────────────────────── Hold ─────────────────────────────

export const validateHold = (noteText: string): Checked<{ note?: string }> => {
  const note = clean(noteText);
  if (note.length > 300) return fail({ note: 'La note ne peut pas dépasser 300 caractères.' });
  return { ok: true, value: note ? { note } : {} };
};

// ───────────────────────────── Adjustment ─────────────────────────────

export const MAX_ADJUSTMENT = 100_000;
const SIGNED_AMOUNT = /^[+-]?\d{1,6}(\.\d{1,2})?$/;

export interface AdjustmentInput { amount: number; reason: string }

/** `amount` + pays the restaurant more, - deducts. `current` lets us refuse a deduction that would make the payable amount negative. */
export const validateAdjustment = (
  form: { amount: string; reason: string },
  current?: { vendorAmount: number; adjustmentTotal: number },
): Checked<AdjustmentInput> => {
  const errors: Record<string, string> = {};
  const text = form.amount.trim().replace(/^\+\s*/, '+').replace(/^-\s*/, '-');
  let amount = 0;
  if (text === '') errors.amount = 'Saisissez un montant : + verse davantage au restaurant, - déduit.';
  else if (/^[+-]?\d+\.\d{3,}$/.test(text)) errors.amount = 'Le montant peut avoir 2 décimales au maximum.';
  else if (!SIGNED_AMOUNT.test(text)) errors.amount = 'Le montant doit être un nombre simple, comme 500 ou -250.';
  else {
    amount = Math.round(Number(text) * 100) / 100;
    if (amount === 0) errors.amount = 'Le montant ne peut pas être 0.';
    else if (Math.abs(amount) > MAX_ADJUSTMENT) errors.amount = `Le montant doit être compris entre -${frNumber(MAX_ADJUSTMENT)} et ${frNumber(MAX_ADJUSTMENT)}.`;
    else if (current) {
      const net = Math.round(current.vendorAmount * 100) + Math.round(current.adjustmentTotal * 100) + Math.round(amount * 100);
      if (net < 0) errors.amount = 'Le montant à payer deviendrait négatif. Déduisez moins, ou annulez le règlement.';
    }
  }
  const reason = clean(form.reason);
  if (reason === '') errors.reason = 'Saisissez un motif (3 à 200 caractères). Il est conservé dans le journal d’audit.';
  else if (reason.length < 3 || reason.length > 200) errors.reason = 'Le motif doit faire de 3 à 200 caractères.';
  return Object.keys(errors).length > 0 ? fail(errors) : { ok: true, value: { amount, reason } };
};

// ───────────────────────────── Rider payout ─────────────────────────────

export const MAX_RIDER_PAYOUT = 100_000;
const POSITIVE_AMOUNT = /^\d{1,6}(\.\d{1,2})?$/;

export interface RiderPayoutInput { driverUserId: string; amount: number; method: 'UPI' | 'BANK' | 'CASH'; reference?: string; note?: string }

export const validateRiderPayout = (form: { driverUserId: string; method: string; amount: string; reference: string; note: string }): Checked<RiderPayoutInput> => {
  const errors: Record<string, string> = {};
  if (!form.driverUserId) errors.driverUserId = 'Choisissez le livreur.';
  if (form.method !== 'UPI' && form.method !== 'BANK' && form.method !== 'CASH') errors.method = 'Choisissez UPI, virement bancaire ou espèces.';
  const text = form.amount.trim();
  let amount = 0;
  if (text === '') errors.amount = 'Saisissez le montant payé.';
  else if (/^\d+\.\d{3,}$/.test(text)) errors.amount = 'Le montant peut avoir 2 décimales au maximum.';
  else if (!POSITIVE_AMOUNT.test(text)) errors.amount = 'Le montant doit être un nombre simple, comme 2500 ou 2500.50.';
  else {
    amount = Math.round(Number(text) * 100) / 100;
    if (amount <= 0) errors.amount = 'Le montant doit être supérieur à 0.';
    else if (amount > MAX_RIDER_PAYOUT) errors.amount = `Le montant ne peut pas dépasser ${frNumber(MAX_RIDER_PAYOUT)}.`;
  }
  const reference = clean(form.reference);
  if (reference !== '' && !REFERENCE_RE.test(reference)) errors.reference = REFERENCE_MESSAGE;
  const note = form.note.trim();
  if (note.length > 300) errors.note = 'La note ne peut pas dépasser 300 caractères.';
  if (Object.keys(errors).length > 0) return fail(errors);
  return {
    ok: true,
    value: { driverUserId: form.driverUserId, amount, method: form.method as 'UPI' | 'BANK' | 'CASH', ...(reference ? { reference } : {}), ...(note ? { note } : {}) },
  };
};

// ───────────────────────────── Payout account ─────────────────────────────

export const UPI_RE = /^[a-z0-9][a-z0-9._-]{1,63}@[a-z][a-z0-9]{1,31}$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_NUMBER_RE = /^\d{6,20}$/;
const HOLDER_RE = /^[\p{L}][\p{L}\p{M}\s.'-]*$/u;

export type PayoutAccountInput =
  | { method: 'UPI'; upiId: string; accountHolder?: string }
  | { method: 'BANK'; accountHolder: string; accountNumber: string; ifsc: string; bankName?: string };

export const validatePayoutAccount = (form: { method: string; upiId: string; accountHolder: string; accountNumber: string; ifsc: string; bankName: string }): Checked<PayoutAccountInput> => {
  const errors: Record<string, string> = {};
  const holder = clean(form.accountHolder);
  const holderError = (required: boolean): string | undefined => {
    if (holder === '') return required ? 'Saisissez le nom du titulaire du compte (2 à 80 caractères).' : undefined;
    if (holder.length < 2 || holder.length > 80) return 'Le nom du titulaire doit faire de 2 à 80 caractères.';
    if (!HOLDER_RE.test(holder)) return "Le nom du titulaire ne peut contenir que des lettres, des espaces et . ' -";
    return undefined;
  };
  if (form.method === 'UPI') {
    const upiId = form.upiId.trim().toLowerCase();
    if (upiId === '') errors.upiId = 'Saisissez l’identifiant UPI, par exemple nom@okhdfcbank.';
    else if (!UPI_RE.test(upiId)) errors.upiId = 'Ce n’est pas un identifiant UPI valide (par exemple nom@okhdfcbank).';
    const he = holderError(false);
    if (he) errors.accountHolder = he;
    return Object.keys(errors).length > 0 ? fail(errors) : { ok: true, value: { method: 'UPI', upiId, ...(holder ? { accountHolder: holder } : {}) } };
  }
  if (form.method !== 'BANK') return fail({ method: 'Choisissez UPI ou compte bancaire.' });
  const he = holderError(true);
  if (he) errors.accountHolder = he;
  const accountNumber = form.accountNumber.replace(/[\s-]/g, '');
  if (accountNumber === '') errors.accountNumber = 'Saisissez le numéro de compte complet (6 à 20 chiffres).';
  else if (!ACCOUNT_NUMBER_RE.test(accountNumber)) errors.accountNumber = 'Le numéro de compte doit faire de 6 à 20 chiffres.';
  const ifsc = form.ifsc.trim().toUpperCase();
  if (ifsc === '') errors.ifsc = 'Saisissez le code IFSC, par exemple HDFC0001234.';
  else if (!IFSC_RE.test(ifsc)) errors.ifsc = 'Ce n’est pas un code IFSC valide (4 lettres, 0, puis 6 lettres ou chiffres).';
  const bankName = clean(form.bankName);
  if (bankName !== '' && (bankName.length < 2 || bankName.length > 60)) errors.bankName = 'Le nom de la banque doit faire de 2 à 60 caractères.';
  return Object.keys(errors).length > 0 ? fail(errors) : { ok: true, value: { method: 'BANK', accountHolder: holder, accountNumber, ifsc, ...(bankName ? { bankName } : {}) } };
};

// ───────────────────────────── Settlement settings ─────────────────────────────

export const MAX_HOLD_DAYS = 30;

export interface SettlementSettingsInput { time: string; mode: 'MANUAL_PAYOUT' | 'AUTO_PAYOUT'; autoCreate: boolean; holdDays: number }

export const validateSettlementSettings = (form: { time: string; mode: string; autoCreate: boolean; holdDays: string }): Checked<SettlementSettingsInput> => {
  const errors: Record<string, string> = {};
  const time = form.time.trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) errors.time = 'Format HH:MM sur 24 h, heure IST (Inde), par exemple 22:00.';
  if (form.mode !== 'MANUAL_PAYOUT' && form.mode !== 'AUTO_PAYOUT') errors.mode = 'Choisissez comment les règlements sont payés.';
  const hold = form.holdDays.trim();
  if (!/^\d{1,2}$/.test(hold) || Number(hold) > MAX_HOLD_DAYS) errors.holdDays = `Le délai de rétention doit être un nombre entier de jours, de 0 à ${MAX_HOLD_DAYS}.`;
  if (Object.keys(errors).length > 0) return fail(errors);
  return { ok: true, value: { time, mode: form.mode as SettlementSettingsInput['mode'], autoCreate: form.autoCreate, holdDays: Number(hold) } };
};

// Re-exported so a form can default a "paid date" input to today without importing two modules.
export { addDays, istToday };
