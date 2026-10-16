/**
 * Module registry (KRAVEO_SPEC_MODULES.md 4, 15.3): which modules are on and what their settings are. Reads go through an in-process
 * cache (never the database on every price calculation) that every admin write drops. The TTL only bounds how stale a SECOND server
 * instance could be (today there is one). Under NODE_ENV=test the TTL is 0 unless MODULE_CACHE_TTL_MS is set.
 *
 * "Effective" state = the module's own flag AND its parent is effective AND its `requires` hold (ALL / ANY). So switching `marketing`
 * off disables every marketing.* module whatever their own flags say. Core modules are always effective.
 */
import { prisma } from '../../db';
import { AppError } from '../../utils/appError';

export type ModuleRow = {
  code: string; parentCode: string | null; name: string; description: string; category: string; isEnabled: boolean; isCore: boolean;
  requires: string[]; requiresMode: string; sortOrder: number; updatedBy: string | null; updatedAt: Date;
};
export type SettingRow = {
  moduleCode: string; key: string; value: unknown; valueType: string; unit: string | null; label: string; description: string;
  minValue: number | null; maxValue: number | null; options: unknown; updatedBy: string | null; updatedAt: Date;
};

type Loaded = { at: number; modules: Map<string, ModuleRow>; effective: Map<string, boolean>; settings: Map<string, SettingRow> };
let cache: Loaded | null = null;
let generation = 0;

const ttlMs = (): number => {
  const raw = process.env.MODULE_CACHE_TTL_MS;
  if (raw !== undefined && raw.trim() !== '') {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return process.env.NODE_ENV === 'test' ? 0 : 30_000;
};

export const invalidateModuleCache = () => {
  cache = null;
  generation++;
};

/** Pure: effective state of every module from the raw rows. Cycles and unknown codes count as "not satisfied". */
export const computeEffective = (modules: Pick<ModuleRow, 'code' | 'parentCode' | 'isEnabled' | 'isCore' | 'requires' | 'requiresMode'>[]): Map<string, boolean> => {
  const byCode = new Map(modules.map((m) => [m.code, m]));
  const memo = new Map<string, boolean>();
  const visit = (code: string, stack: Set<string>): boolean => {
    if (memo.has(code)) return memo.get(code)!;
    const m = byCode.get(code);
    if (!m || stack.has(code)) return false;
    stack.add(code);
    let ok = m.isCore || m.isEnabled;
    if (ok && m.parentCode) ok = visit(m.parentCode, stack);
    if (ok && m.requires.length > 0) {
      const states = m.requires.map((r) => visit(r, stack));
      ok = m.requiresMode === 'ANY' ? states.some(Boolean) : states.every(Boolean);
    }
    stack.delete(code);
    memo.set(code, ok);
    return ok;
  };
  for (const m of modules) visit(m.code, new Set());
  return memo;
};

const load = async (): Promise<Loaded> => {
  const started = generation;
  const [mods, sets] = await Promise.all([prisma.platformModule.findMany(), prisma.moduleSetting.findMany()]);
  const modules = new Map(mods.map((m) => [m.code, m as ModuleRow]));
  const loaded: Loaded = {
    at: Date.now(),
    modules,
    effective: computeEffective(mods),
    settings: new Map(sets.map((s) => [`${s.moduleCode}|${s.key}`, s as SettingRow])),
  };
  if (started === generation && ttlMs() > 0) cache = loaded;
  return loaded;
};

const current = async (): Promise<Loaded> => {
  const ttl = ttlMs();
  if (ttl > 0 && cache && Date.now() - cache.at < ttl) return cache;
  return load();
};

/** Effective state (see the header). An unknown code is OFF. */
export const isEnabled = async (code: string): Promise<boolean> => (await current()).effective.get(code) === true;

/** All effective states at once, for a pipeline run (one cache read). */
export const getRegistry = async () => {
  const c = await current();
  const num = (m: string, k: string): number => {
    const v = c.settings.get(`${m}|${k}`)?.value;
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new AppError(500, 'MODULE_SETTING_MISSING', `Module setting ${m}.${k} is missing or invalid.`);
    return v;
  };
  const bool = (m: string, k: string): boolean => {
    const v = c.settings.get(`${m}|${k}`)?.value;
    if (typeof v !== 'boolean') throw new AppError(500, 'MODULE_SETTING_MISSING', `Module setting ${m}.${k} is missing or invalid.`);
    return v;
  };
  const str = (m: string, k: string): string => {
    const v = c.settings.get(`${m}|${k}`)?.value;
    if (typeof v !== 'string') throw new AppError(500, 'MODULE_SETTING_MISSING', `Module setting ${m}.${k} is missing or invalid.`);
    return v;
  };
  const json = <T>(m: string, k: string): T => {
    const v = c.settings.get(`${m}|${k}`)?.value;
    if (v === undefined) throw new AppError(500, 'MODULE_SETTING_MISSING', `Module setting ${m}.${k} is missing.`);
    return v as T;
  };
  return {
    isEnabled: (code: string) => c.effective.get(code) === true,
    num, bool, str, json,
    /** Modules that are effectively on + the settings of those, for the order snapshot (rule 5). */
    snapshot: () => {
      const enabled = [...c.effective.entries()].filter(([, on]) => on).map(([code]) => code).sort();
      const settings: Record<string, unknown> = {};
      for (const s of c.settings.values()) if (c.effective.get(s.moduleCode)) settings[`${s.moduleCode}.${s.key}`] = s.value;
      return { enabled, settings };
    },
  };
};
export type Registry = Awaited<ReturnType<typeof getRegistry>>;

export const getSetting = async <T = unknown>(moduleCode: string, key: string): Promise<T> => {
  const s = (await current()).settings.get(`${moduleCode}|${key}`);
  if (!s) throw new AppError(500, 'MODULE_SETTING_MISSING', `Module setting ${moduleCode}.${key} is missing.`);
  return s.value as T;
};
