import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/auth';
import { AppError } from '../utils/appError';
import { fail, validParams } from '../utils/http';
import { writeAudit } from '../services/audit';
import { bad, dateOpt, isObj, oneOf, onlyKeys, str, strOpt } from '../core/modules/validate-kit';
import { longText } from './content';
import { pageOf } from '../core/modules/validate-kit';

/** Recruitment pipeline (/api/admin/prospects): restaurants and riders the team wants to sign, tracked by hand. */
export const prospectRouter = Router();
const adminOnly = [requireAuth, requireRole('ADMIN')] as const;
const actor = (req: AuthenticatedRequest) => req.user!.id;
const wrap = (what: string, fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) => async (req: AuthenticatedRequest, res: Response) => {
  try { await fn(req, res); } catch (err) { fail(res, err, what); }
};

export const STAGES = ['TO_CONTACT', 'CONTACTED', 'FOLLOW_UP', 'INTERESTED', 'SIGNED', 'REJECTED'] as const;
const KINDS = ['RESTAURANT', 'DRIVER'] as const;
const FITS = ['A', 'B', 'C'] as const;
const EVENT_TYPES = ['NOTE', 'CALL', 'VISIT', 'WHATSAPP'] as const;
const CONTACT_EVENTS = new Set(['CALL', 'VISIT', 'WHATSAPP']);
const PHONE_RE = /^[+0-9 ()-]{6,20}$/;
const EMAIL_RE = /^[^\s@<>]{1,64}@[^\s@<>]{1,200}\.[^\s@<>]{2,20}$/;

const phoneOpt = (o: Record<string, unknown>) => { const v = strOpt(o, 'phone', 20); if (v !== null && !PHONE_RE.test(v)) throw bad('phone', 'Enter a phone number (digits, +, spaces).'); return v; };
const emailOpt = (o: Record<string, unknown>) => { const v = strOpt(o, 'email', 120); if (v !== null && !EMAIL_RE.test(v)) throw bad('email', 'Enter a valid e-mail address.'); return v; };
const fitOpt = (o: Record<string, unknown>) => (o.fit === undefined || o.fit === null ? null : oneOf(o, 'fit', FITS));

const view = (p: Prisma.ProspectGetPayload<{}>) => ({
  id: p.id, kind: p.kind, businessName: p.businessName, contactName: p.contactName, phone: p.phone, email: p.email, city: p.city, district: p.district,
  category: p.category, source: p.source, fit: p.fit, stage: p.stage, nextFollowUpAt: p.nextFollowUpAt?.toISOString() ?? null,
  lastContactedAt: p.lastContactedAt?.toISOString() ?? null, assignedTo: p.assignedTo, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(),
});
const eventView = (e: Prisma.ProspectEventGetPayload<{}>) => ({ id: e.id, type: e.type, body: e.body, createdBy: e.createdBy, createdAt: e.createdAt.toISOString() });

const FIELDS = ['kind', 'businessName', 'contactName', 'phone', 'email', 'city', 'district', 'category', 'source', 'fit', 'stage', 'nextFollowUpAt', 'assignedTo'] as const;

/** A whole prospect from a body (create) or from the stored row merged with a patch (update). */
const readProspect = (o: Record<string, unknown>) => ({
  kind: o.kind === undefined ? 'RESTAURANT' : oneOf(o, 'kind', KINDS),
  businessName: str(o, 'businessName', 2, 120), contactName: strOpt(o, 'contactName', 80), phone: phoneOpt(o), email: emailOpt(o),
  city: o.city === undefined || o.city === null ? 'Thiès' : str(o, 'city', 2, 60), district: strOpt(o, 'district', 60), category: strOpt(o, 'category', 60), source: strOpt(o, 'source', 60),
  fit: fitOpt(o), stage: o.stage === undefined ? 'TO_CONTACT' : oneOf(o, 'stage', STAGES), nextFollowUpAt: dateOpt(o, 'nextFollowUpAt'),
  assignedTo: (() => { const v = strOpt(o, 'assignedTo', 64); if (v !== null && !/^[A-Za-z0-9_-]{1,64}$/.test(v)) throw bad('assignedTo', 'Invalid id.'); return v; })(),
});

prospectRouter.get('/admin/prospects/stats', ...adminOnly, wrap('prospect stats', async (_q, res) => {
  const now = new Date();
  const [by, overdue] = await Promise.all([
    prisma.prospect.groupBy({ by: ['stage'], _count: { _all: true } }),
    prisma.prospect.count({ where: { stage: { notIn: ['SIGNED', 'REJECTED'] }, nextFollowUpAt: { lt: now } } }),
  ]);
  const counts = Object.fromEntries(STAGES.map((s) => [s, by.find((r) => r.stage === s)?._count._all ?? 0])) as Record<string, number>;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const decided = counts.SIGNED + counts.REJECTED;
  res.json({ success: true, data: { total, counts, overdue, conversionRate: decided === 0 ? 0 : Math.round((counts.SIGNED / decided) * 1000) / 10 } });
}));

prospectRouter.get('/admin/prospects', ...adminOnly, wrap('list prospects', async (req, res) => {
  const q = req.query;
  const where: Prisma.ProspectWhereInput = {};
  if (typeof q.stage === 'string' && q.stage) where.stage = oneOf({ stage: q.stage }, 'stage', STAGES);
  if (typeof q.kind === 'string' && q.kind) where.kind = oneOf({ kind: q.kind }, 'kind', KINDS);
  if (q.overdue === 'true') { where.stage = { notIn: ['SIGNED', 'REJECTED'] }; where.nextFollowUpAt = { lt: new Date() }; }
  if (typeof q.q === 'string' && q.q.trim()) {
    const t = q.q.trim().slice(0, 60);
    where.OR = [{ businessName: { contains: t, mode: 'insensitive' } }, { contactName: { contains: t, mode: 'insensitive' } }, { district: { contains: t, mode: 'insensitive' } }, { phone: { contains: t } }];
  }
  const { page, pageSize } = pageOf(q);
  const [total, rows] = await Promise.all([
    prisma.prospect.count({ where }),
    prisma.prospect.findMany({ where, orderBy: [{ nextFollowUpAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  res.json({ success: true, total, page, pageSize, data: rows.map(view) });
}));

prospectRouter.get('/admin/prospects/:id', ...adminOnly, validParams('id'), wrap('get prospect', async (req, res) => {
  const p = await prisma.prospect.findUnique({ where: { id: req.params.id }, include: { events: { orderBy: { createdAt: 'desc' }, take: 200 } } });
  if (!p) throw new AppError(404, 'NOT_FOUND', 'Unknown prospect.');
  res.json({ success: true, data: { ...view(p), events: p.events.map(eventView) } });
}));

prospectRouter.post('/admin/prospects', ...adminOnly, wrap('create prospect', async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  onlyKeys(b, FIELDS);
  const data = readProspect(b);
  const p = await prisma.prospect.create({ data: { ...data, createdBy: actor(req), events: { create: { type: 'STAGE', body: `Ajouté (${data.stage})`, createdBy: actor(req) } } } });
  await writeAudit('PROSPECT_CREATED', 'PROSPECT', p.id, p.businessName);
  res.status(201).json({ success: true, data: view(p) });
}));

prospectRouter.patch('/admin/prospects/:id', ...adminOnly, validParams('id'), wrap('update prospect', async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  onlyKeys(b, FIELDS);
  if (Object.keys(b).length === 0) throw bad('body', 'Nothing to change.');
  const cur = await prisma.prospect.findUnique({ where: { id: req.params.id } });
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'Unknown prospect.');
  const merged = { ...view(cur), ...b } as Record<string, unknown>;
  const data = readProspect(merged);
  const stageChanged = data.stage !== cur.stage;
  const p = await prisma.$transaction(async (tx) => {
    const row = await tx.prospect.update({ where: { id: cur.id }, data: { ...data, ...(stageChanged && (data.stage === 'CONTACTED' || data.stage === 'FOLLOW_UP') ? { lastContactedAt: new Date() } : {}), ...(stageChanged && (data.stage === 'SIGNED' || data.stage === 'REJECTED') ? { nextFollowUpAt: null } : {}) } });
    if (stageChanged) await tx.prospectEvent.create({ data: { prospectId: cur.id, type: 'STAGE', body: `${cur.stage} → ${data.stage}`, createdBy: actor(req) } });
    return row;
  });
  if (stageChanged) await writeAudit('PROSPECT_STAGE', 'PROSPECT', p.id, `${p.businessName}: ${cur.stage} → ${p.stage}`);
  res.json({ success: true, data: view(p) });
}));

prospectRouter.post('/admin/prospects/:id/events', ...adminOnly, validParams('id'), wrap('add prospect event', async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  onlyKeys(b, ['type', 'body', 'nextFollowUpAt']);
  const type = oneOf(b, 'type', EVENT_TYPES);
  const body = longText(b, 'body', 2, 1000);
  const next = dateOpt(b, 'nextFollowUpAt');
  const cur = await prisma.prospect.findUnique({ where: { id: req.params.id }, select: { id: true, stage: true } });
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'Unknown prospect.');
  const [event] = await prisma.$transaction([
    prisma.prospectEvent.create({ data: { prospectId: cur.id, type, body, createdBy: actor(req) } }),
    prisma.prospect.update({ where: { id: cur.id }, data: { ...(CONTACT_EVENTS.has(type) ? { lastContactedAt: new Date() } : {}), ...(b.nextFollowUpAt !== undefined ? { nextFollowUpAt: next } : {}) } }),
  ]);
  res.status(201).json({ success: true, data: eventView(event) });
}));

prospectRouter.delete('/admin/prospects/:id', ...adminOnly, validParams('id'), wrap('delete prospect', async (req, res) => {
  const p = await prisma.prospect.delete({ where: { id: req.params.id } }).catch(() => null);
  if (!p) throw new AppError(404, 'NOT_FOUND', 'Unknown prospect.');
  await writeAudit('PROSPECT_DELETED', 'PROSPECT', p.id, p.businessName);
  res.json({ success: true });
}));
