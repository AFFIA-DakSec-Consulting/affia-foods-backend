import { Router, Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/auth';
import { AppError } from '../utils/appError';
import { fail, validParams } from '../utils/http';
import { audit } from '../core/modules/module-admin.service';
import { getRegistry } from '../core/modules/module-registry.service';
import { bad, bool, isObj, num, onlyKeys, str } from '../core/modules/validate-kit';
import { SENEGAL_BOUNDS, inSenegal } from '../config/campus';
import { MODULE, evaluate, listAreas, loadConfig } from '../services/serviceAreas';

/** Back-office of the service areas (/api/admin/service-areas): the circles where the app is available, and a tester for a point. ADMIN only. */
export const serviceAreaRouter = Router();
const adminOnly = [requireAuth, requireRole('ADMIN')] as const;
const actor = (req: AuthenticatedRequest) => req.user!.id;
const wrap = (what: string, fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) => async (req: AuthenticatedRequest, res: Response) => {
  try { await fn(req, res); } catch (err) { fail(res, err, what); }
};

const MAX_AREAS = 50;
const view = (a: { id: string; name: string; lat: number; lng: number; radiusKm: number; isActive: boolean; sortOrder: number }) => ({ id: a.id, name: a.name, lat: a.lat, lng: a.lng, radiusKm: a.radiusKm, isActive: a.isActive, sortOrder: a.sortOrder });

/** A GPS coordinate: a finite number in range, with as many decimals as the GPS gave (validate-kit's `num` keeps 2, which is right for money, not for a position). */
const coord = (o: Record<string, unknown>, k: 'lat' | 'lng', limit: number): number => {
  const v = o[k];
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > limit) throw bad(k, `${k} must be a number between ${-limit} and ${limit}.`);
  return v;
};

/** A centre must be a real point of Senegal; the radius is in kilometres. */
const readArea = (o: Record<string, unknown>) => {
  const lat = coord(o, 'lat', 90);
  const lng = coord(o, 'lng', 180);
  if (!inSenegal(lat, lng)) throw bad('lat', 'The centre of a zone must be inside Senegal.');
  return { name: str(o, 'name', 2, 60), lat, lng, radiusKm: num(o, 'radiusKm', 0.5, 500), isActive: o.isActive === undefined ? true : bool(o, 'isActive') };
};

/** Does the app currently narrow itself down to the areas? */
const isRestricted = async (): Promise<boolean> => {
  const reg = await getRegistry();
  return reg.isEnabled(MODULE) && reg.str(MODULE, 'mode') === 'AREAS';
};

/** While the app is limited to the areas, the last active one cannot be switched off or removed: nobody could order any more. */
const assertNotLast = async (id: string) => {
  if (!(await isRestricted())) return;
  const others = await prisma.serviceArea.count({ where: { isActive: true, id: { not: id } } });
  if (others === 0) throw new AppError(409, 'LAST_ACTIVE_AREA', 'The app is limited to the zones and this is the last active one. Open the app to all of Senegal first, or add another zone.');
};

serviceAreaRouter.get('/admin/service-areas', ...adminOnly, wrap('list service areas', async (_req, res) => {
  const [areas, cfg] = await Promise.all([listAreas(), loadConfig()]);
  res.json({ success: true, data: areas.map(view), meta: { restricted: cfg.restricted, bounds: SENEGAL_BOUNDS, maxAreas: MAX_AREAS } });
}));

serviceAreaRouter.post('/admin/service-areas', ...adminOnly, wrap('create service area', async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  onlyKeys(b, ['name', 'lat', 'lng', 'radiusKm', 'isActive']);
  const data = readArea(b);
  if ((await prisma.serviceArea.count()) >= MAX_AREAS) throw new AppError(409, 'TOO_MANY_AREAS', `At most ${MAX_AREAS} zones.`);
  const row = await prisma.serviceArea.create({ data: { ...data, sortOrder: (await prisma.serviceArea.count()) * 10 + 10 } });
  await audit(prisma, { moduleCode: MODULE, action: 'CREATE_SERVICE_AREA', newValue: { id: row.id, name: row.name, radiusKm: row.radiusKm }, changedBy: actor(req) });
  res.status(201).json({ success: true, data: view(row) });
}));

serviceAreaRouter.patch('/admin/service-areas/:id', ...adminOnly, validParams('id'), wrap('update service area', async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  onlyKeys(b, ['name', 'lat', 'lng', 'radiusKm', 'isActive']);
  if (Object.keys(b).length === 0) throw bad('body', 'Nothing to change.');
  const cur = await prisma.serviceArea.findUnique({ where: { id: req.params.id } });
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'Unknown zone.');
  const data = readArea({ name: cur.name, lat: cur.lat, lng: cur.lng, radiusKm: cur.radiusKm, isActive: cur.isActive, ...b });
  if (cur.isActive && !data.isActive) await assertNotLast(cur.id);
  const row = await prisma.serviceArea.update({ where: { id: cur.id }, data });
  const diff: Record<string, [unknown, unknown]> = {};
  for (const k of ['name', 'lat', 'lng', 'radiusKm', 'isActive'] as const) if (cur[k] !== row[k]) diff[k] = [cur[k], row[k]];
  await audit(prisma, { moduleCode: MODULE, action: 'UPDATE_SERVICE_AREA', oldValue: { id: cur.id, name: cur.name }, newValue: diff, changedBy: actor(req) });
  res.json({ success: true, data: view(row) });
}));

serviceAreaRouter.delete('/admin/service-areas/:id', ...adminOnly, validParams('id'), wrap('delete service area', async (req, res) => {
  const cur = await prisma.serviceArea.findUnique({ where: { id: req.params.id } });
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'Unknown zone.');
  if (cur.isActive) await assertNotLast(cur.id);
  await prisma.serviceArea.delete({ where: { id: cur.id } });
  await audit(prisma, { moduleCode: MODULE, action: 'DELETE_SERVICE_AREA', oldValue: { id: cur.id, name: cur.name }, changedBy: actor(req) });
  res.json({ success: true });
}));

/** "Would this point be served?" for a restaurant and for a customer, under the rule as it is now. Writes nothing. */
serviceAreaRouter.post('/admin/service-areas/check', ...adminOnly, wrap('check a point', async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  onlyKeys(b, ['lat', 'lng']);
  const lat = coord(b, 'lat', 90);
  const lng = coord(b, 'lng', 180);
  const cfg = await loadConfig();
  const answer = (audience: 'vendor' | 'customer') => {
    const v = evaluate(cfg, audience, lat, lng);
    return v.ok ? { served: true, area: v.area ? { id: v.area.id, name: v.area.name } : null } : { served: false, reason: v.code, message: v.message };
  };
  res.json({ success: true, data: { restricted: cfg.restricted, inCountry: inSenegal(lat, lng), vendor: answer('vendor'), customer: answer('customer') } });
}));
