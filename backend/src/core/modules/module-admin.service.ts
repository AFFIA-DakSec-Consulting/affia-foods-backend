/**
 * Back-office operations on modules and settings (KRAVEO_SPEC_MODULES.md 10): every write validates, runs in ONE transaction under row
 * locks (two admins cannot interleave), writes module_audit_log with old and new value and the acting admin, then drops the cache.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { AppError } from '../../utils/appError';
import { computeEffective, invalidateModuleCache } from './module-registry.service';
import { crossCheck, validateSettingValue } from './settings-validation';

type Tx = Prisma.TransactionClient;
const TX_OPTS = { maxWait: 10_000, timeout: 20_000 } as const;

export const audit = (tx: Tx | typeof prisma, a: { moduleCode?: string | null; settingKey?: string | null; action: string; oldValue?: unknown; newValue?: unknown; changedBy: string }) =>
  tx.moduleAuditLog.create({
    data: {
      moduleCode: a.moduleCode ?? null,
      settingKey: a.settingKey ?? null,
      action: a.action,
      oldValue: a.oldValue === undefined ? Prisma.DbNull : (a.oldValue as Prisma.InputJsonValue),
      newValue: a.newValue === undefined ? Prisma.DbNull : (a.newValue as Prisma.InputJsonValue),
      changedBy: a.changedBy,
    },
  });

export const listModules = async () => {
  const [mods, sets] = await Promise.all([prisma.platformModule.findMany({ orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] }), prisma.moduleSetting.groupBy({ by: ['moduleCode'], _count: { _all: true } })]);
  const eff = computeEffective(mods);
  const counts = new Map(sets.map((s) => [s.moduleCode, s._count._all]));
  return mods.map((m) => ({
    code: m.code, parentCode: m.parentCode, name: m.name, description: m.description, category: m.category,
    isEnabled: m.isEnabled, isCore: m.isCore, effective: eff.get(m.code) === true,
    requires: m.requires, requiresMode: m.requiresMode, settingsCount: counts.get(m.code) ?? 0,
    blockedBy: m.isEnabled && eff.get(m.code) !== true ? blockers(m, mods, eff) : [],
    updatedAt: m.updatedAt.toISOString(), updatedBy: m.updatedBy,
  }));
};

/** Why an enabled module is not effective (a parent or a requirement is off). */
const blockers = (m: { parentCode: string | null; requires: string[] }, all: { code: string }[], eff: Map<string, boolean>): string[] => {
  const out = new Set<string>();
  if (m.parentCode && eff.get(m.parentCode) !== true) out.add(m.parentCode);
  for (const r of m.requires) if (eff.get(r) !== true) out.add(r);
  return [...out].filter((c) => all.some((a) => a.code === c));
};

type ModRow = Prisma.PlatformModuleGetPayload<{}>;
const lockAllModules = (tx: Tx): Promise<ModRow[]> =>
  tx.$queryRaw<ModRow[]>`SELECT * FROM "PlatformModule" ORDER BY "code" FOR UPDATE`;

/** Which enabled modules lean on `code` (as parent, or as a requirement they cannot do without). */
const dependentsOf = (code: string, mods: ModRow[], on: Set<string>): string[] =>
  mods.filter((m) => on.has(m.code) && m.code !== code && (m.parentCode === code || (m.requires.includes(code) && (m.requiresMode === 'ALL' || !m.requires.some((r) => r !== code && on.has(r)))))).map((m) => m.code);

export const toggleModule = async (code: string, enable: boolean, actorId: string, cascade = false) => {
  const out = await prisma.$transaction(async (tx) => {
    const mods = await lockAllModules(tx);
    const mod = mods.find((m) => m.code === code);
    if (!mod) throw new AppError(404, 'NOT_FOUND', 'Unknown module.');
    if (mod.isCore) throw new AppError(409, 'MODULE_CORE', 'This module is required and cannot be switched off.');
    if (mod.isEnabled === enable) return { changed: [] as string[] };
    const on = new Set(mods.filter((m) => m.isEnabled || m.isCore).map((m) => m.code));
    const changed: string[] = [];
    if (enable) {
      const missing: string[] = [];
      if (mod.parentCode && !on.has(mod.parentCode)) missing.push(mod.parentCode);
      if (mod.requires.length > 0) {
        const ok = mod.requiresMode === 'ANY' ? mod.requires.some((r) => on.has(r)) : mod.requires.every((r) => on.has(r));
        if (!ok) missing.push(...mod.requires.filter((r) => !on.has(r)));
      }
      if (missing.length > 0) throw new AppError(409, 'MODULE_DEPENDENCY', `Switch on first: ${[...new Set(missing)].join(', ')}.`, undefined, { missing: [...new Set(missing)] });
      changed.push(code);
    } else {
      // Disable: refuse while an enabled module depends on this one, unless the admin explicitly asked for the cascade.
      const todo = [code];
      const closure: string[] = [];
      on.delete(code);
      while (todo.length > 0) {
        const cur = todo.pop()!;
        closure.push(cur);
        const deps = dependentsOf(cur, mods, new Set([...on, cur])).filter((d) => on.has(d));
        for (const d of deps) { on.delete(d); todo.push(d); }
      }
      const dependents = closure.filter((c) => c !== code);
      if (dependents.length > 0 && !cascade) throw new AppError(409, 'MODULE_DEPENDENTS', `These modules need it: ${dependents.join(', ')}. Switch them off first, or confirm the cascade.`, undefined, { dependents });
      changed.push(...closure);
    }
    for (const c of changed) {
      await tx.platformModule.update({ where: { code: c }, data: { isEnabled: enable, updatedBy: actorId } });
      await audit(tx, { moduleCode: c, action: enable ? 'ENABLE' : 'DISABLE', oldValue: { isEnabled: !enable }, newValue: { isEnabled: enable, cascade: c !== code }, changedBy: actorId });
    }
    return { changed };
  }, TX_OPTS);
  invalidateModuleCache();
  return out;
};

export const listSettings = async (moduleCode: string) => {
  const mod = await prisma.platformModule.findUnique({ where: { code: moduleCode }, select: { code: true } });
  if (!mod) throw new AppError(404, 'NOT_FOUND', 'Unknown module.');
  const rows = await prisma.moduleSetting.findMany({ where: { moduleCode }, orderBy: { key: 'asc' } });
  return rows.map((s) => ({ key: s.key, value: s.value, valueType: s.valueType, unit: s.unit, label: s.label, description: s.description, min: s.minValue, max: s.maxValue, options: s.options, updatedAt: s.updatedAt.toISOString(), updatedBy: s.updatedBy }));
};

export const updateSetting = async (moduleCode: string, key: string, raw: unknown, actorId: string) => {
  const out = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Prisma.ModuleSettingGetPayload<{}>[]>`SELECT * FROM "ModuleSetting" WHERE "moduleCode" = ${moduleCode} ORDER BY "key" FOR UPDATE`;
    const row = rows.find((r) => r.key === key);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Unknown setting.');
    const value = validateSettingValue({ key, valueType: row.valueType, minValue: row.minValue, maxValue: row.maxValue, options: row.options }, raw);
    // Limiting the app to the zones needs at least one active zone, or nobody could order or sign up.
    if (moduleCode === 'delivery.service_areas' && key === 'mode' && value === 'AREAS' && (await tx.serviceArea.count({ where: { isActive: true } })) === 0) {
      throw new AppError(409, 'NO_ACTIVE_AREA', 'Add and activate at least one zone before limiting the app to the zones.', 'value');
    }
    const merged: Record<string, unknown> = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    merged[key] = value;
    crossCheck(moduleCode, merged);
    const changed = JSON.stringify(row.value) !== JSON.stringify(value);
    if (changed) {
      await tx.moduleSetting.update({ where: { moduleCode_key: { moduleCode, key } }, data: { value: value as Prisma.InputJsonValue, updatedBy: actorId } });
      await audit(tx, { moduleCode, settingKey: key, action: 'UPDATE_SETTING', oldValue: row.value, newValue: value, changedBy: actorId });
    }
    return { changed, before: row.value, value };
  }, TX_OPTS);
  invalidateModuleCache();
  return out;
};

export const listAudit = async (q: { moduleCode?: string; page: number; pageSize: number }) => {
  const where: Prisma.ModuleAuditLogWhereInput = q.moduleCode ? { moduleCode: q.moduleCode } : {};
  const [total, rows] = await Promise.all([
    prisma.moduleAuditLog.count({ where }),
    prisma.moduleAuditLog.findMany({ where, orderBy: [{ changedAt: 'desc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, data: rows.map((r) => ({ id: r.id, moduleCode: r.moduleCode, settingKey: r.settingKey, action: r.action, oldValue: r.oldValue, newValue: r.newValue, changedBy: r.changedBy, changedAt: r.changedAt.toISOString() })) };
};
