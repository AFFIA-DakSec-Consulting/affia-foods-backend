/**
 * Validation of a module setting written from the back-office (KRAVEO_SPEC_MODULES.md 10, 16 "Admin qui casse la tarification").
 * PURE. The row says what is allowed (valueType, min, max, options); a few JSON settings have their own shape; a few cross-field rules
 * are checked on the whole module after the change (min <= max). Anything else is refused.
 */
import { AppError } from '../../utils/appError';
import { isHHMM } from '../../shared/pricing/clock';

export type SettingMeta = { key: string; valueType: string; minValue: number | null; maxValue: number | null; options: unknown };

const bad = (key: string, message: string) => new AppError(400, 'BAD_REQUEST', message, key);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const rushWindows = (key: string, v: unknown) => {
  if (!Array.isArray(v) || v.length > 8) throw bad(key, 'Send a list of at most 8 time windows like {"from":"12:00","to":"14:00"}.');
  return v.map((w) => {
    if (!isObj(w) || Object.keys(w).some((k) => k !== 'from' && k !== 'to') || !isHHMM(w.from) || !isHHMM(w.to)) throw bad(key, 'Each window needs "from" and "to" as HH:MM (24 hour, Dakar time).');
    return { from: w.from, to: w.to };
  });
};
const oneWindow = (key: string, v: unknown) => {
  if (!isObj(v) || Object.keys(v).some((k) => k !== 'from' && k !== 'to') || !isHHMM(v.from) || !isHHMM(v.to)) throw bad(key, 'Send {"from":"HH:MM","to":"HH:MM"}.');
  return { from: v.from, to: v.to };
};
const JSON_VALIDATORS: Record<string, (key: string, v: unknown) => unknown> = { rush_hours: rushWindows, quiet_hours: oneWindow };

/** Returns the clean value to store, or throws a 400 AppError naming the setting. */
export const validateSettingValue = (meta: SettingMeta, raw: unknown): unknown => {
  const { key, valueType: t } = meta;
  if (t === 'boolean') {
    if (typeof raw !== 'boolean') throw bad(key, 'This setting is true or false.');
    return raw;
  }
  if (t === 'number' || t === 'money') {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw bad(key, 'This setting must be a number.');
    if (t === 'money' && !Number.isInteger(raw)) throw bad(key, 'An amount must be a whole number of FCFA.');
    if (Math.abs(raw * 100 - Math.round(raw * 100)) > 1e-6) throw bad(key, 'At most 2 decimals.');
    if (meta.minValue !== null && raw < meta.minValue) throw bad(key, `The minimum is ${meta.minValue}.`);
    if (meta.maxValue !== null && raw > meta.maxValue) throw bad(key, `The maximum is ${meta.maxValue}.`);
    if (t === 'money' && raw < 0) throw bad(key, 'An amount cannot be negative.');
    return raw;
  }
  if (t === 'string') {
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200) throw bad(key, 'This setting must be a short text.');
    if (Array.isArray(meta.options) && !meta.options.includes(raw)) throw bad(key, `Allowed values: ${meta.options.join(', ')}.`);
    return raw;
  }
  if (t === 'json') {
    const v = JSON_VALIDATORS[key];
    if (!v) throw bad(key, 'This setting cannot be edited here.');
    return v(key, raw);
  }
  throw bad(key, 'Unknown setting type.');
};

/** Rules that involve several settings of one module, checked on the merged values. */
export const crossCheck = (moduleCode: string, v: Record<string, unknown>): void => {
  const n = (k: string) => (typeof v[k] === 'number' ? (v[k] as number) : undefined);
  const le = (a: string, b: string, msg: string) => {
    const x = n(a), y = n(b);
    if (x !== undefined && y !== undefined && x > y) throw bad(a, msg);
  };
  if (moduleCode === 'delivery.base_pricing') {
    le('min_fee', 'max_fee', 'The minimum fee cannot be above the maximum fee.');
    const x = n('small_order_below'), y = n('small_order_fee');
    if (x !== undefined && y !== undefined && x > 0 && y === 0) throw bad('small_order_fee', 'Set a small-order fee, or set the small-order threshold to 0.');
  }
  if (moduleCode === 'courier.base_payout') le('min_payout', 'max_payout', 'The minimum payout cannot be above the maximum payout.');
  if (moduleCode === 'delivery.surge_pricing' && n('rain_surcharge') !== undefined && n('max_surge_total') !== undefined && n('rain_surcharge')! > n('max_surge_total')!) {
    throw bad('rain_surcharge', 'The rain surcharge cannot be above the surge cap.');
  }
};
