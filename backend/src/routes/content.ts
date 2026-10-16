import { Router, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/auth';
import { AppError } from '../utils/appError';
import { fail, validParams } from '../utils/http';
import { writeAudit } from '../services/audit';
import { bad, bool, int, isObj, oneOf, onlyKeys, str } from '../core/modules/validate-kit';

/**
 * Legal documents and help articles. Admin writes are ADMIN only and strictly validated; the apps read the active legal text and the
 * published articles without a token (both are public by nature). A published legal version is never edited: a change is a new version.
 */
export const contentRouter = Router();
const adminOnly = [requireAuth, requireRole('ADMIN')] as const;
const actor = (req: AuthenticatedRequest) => req.user!.id;
const wrap = (what: string, fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) => async (req: AuthenticatedRequest, res: Response) => {
  try { await fn(req, res); } catch (err) { fail(res, err, what); }
};

export const LEGAL_TYPES = ['TERMS', 'PRIVACY', 'REFUNDS', 'CONTRACT_VENDOR', 'CONTRACT_DRIVER'] as const;
export const LOCALES = ['fr', 'en'] as const;
const AUDIENCES = ['ALL', 'CLIENT', 'VENDOR', 'DRIVER'] as const;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Long text: line breaks and tabs are fine, other control characters and angle brackets are not (the apps render it as plain text / Markdown). */
export const longText = (o: Record<string, unknown>, k: string, min: number, max: number): string => {
  const v = o[k];
  if (typeof v !== 'string') throw bad(k, `${k} must be a text.`);
  const t = v.replace(/\r\n/g, '\n').trim();
  if (t.length < min || t.length > max) throw bad(k, `${k} must be ${min}-${max} characters.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/.test(t)) throw bad(k, `${k} contains forbidden characters (< > or control characters).`);
  return t;
};

const docView = (d: Prisma.LegalDocumentGetPayload<{}>, withContent: boolean) => ({
  id: d.id, type: d.type, locale: d.locale, version: d.version, title: d.title, status: d.status, isActive: d.isActive,
  publishedAt: d.publishedAt?.toISOString() ?? null, createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
  ...(withContent ? { content: d.content } : {}),
});

const notFound = (what: string) => new AppError(404, 'NOT_FOUND', `Unknown ${what}.`);
const TX = { maxWait: 10_000, timeout: 20_000 } as const;

// --------------------------------------------------------------------------------------------------------------------- legal documents
contentRouter.get('/admin/legal-documents', ...adminOnly, wrap('list legal documents', async (req, res) => {
  const type = typeof req.query.type === 'string' && req.query.type ? oneOf({ type: req.query.type }, 'type', LEGAL_TYPES) : undefined;
  const rows = await prisma.legalDocument.findMany({ where: type ? { type } : {}, orderBy: [{ type: 'asc' }, { locale: 'asc' }, { version: 'desc' }] });
  res.json({ success: true, data: rows.map((d) => docView(d, false)) });
}));

contentRouter.get('/admin/legal-documents/:id', ...adminOnly, validParams('id'), wrap('get legal document', async (req, res) => {
  const d = await prisma.legalDocument.findUnique({ where: { id: req.params.id } });
  if (!d) throw notFound('document');
  res.json({ success: true, data: docView(d, true) });
}));

contentRouter.post('/admin/legal-documents', ...adminOnly, wrap('create legal document', async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  onlyKeys(b, ['type', 'locale', 'title', 'content']);
  const type = oneOf(b, 'type', LEGAL_TYPES);
  const locale = b.locale === undefined ? 'fr' : oneOf(b, 'locale', LOCALES);
  const title = str(b, 'title', 3, 120);
  const content = longText(b, 'content', 20, 100_000);
  const doc = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`legal:${type}:${locale}`}))`;
    const last = await tx.legalDocument.aggregate({ where: { type, locale }, _max: { version: true } });
    return tx.legalDocument.create({ data: { type, locale, title, content, version: (last._max.version ?? 0) + 1, createdBy: actor(req) } });
  }, TX);
  await writeAudit('LEGAL_CREATED', 'LEGAL_DOCUMENT', doc.id, `${type} ${locale} v${doc.version} by ${actor(req)}`);
  res.status(201).json({ success: true, data: docView(doc, true) });
}));

contentRouter.patch('/admin/legal-documents/:id', ...adminOnly, validParams('id'), wrap('update legal document', async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  onlyKeys(b, ['title', 'content']);
  if (b.title === undefined && b.content === undefined) throw bad('body', 'Nothing to change.');
  const data: Prisma.LegalDocumentUpdateInput = {};
  if (b.title !== undefined) data.title = str(b, 'title', 3, 120);
  if (b.content !== undefined) data.content = longText(b, 'content', 20, 100_000);
  // Only a draft can be edited; the check and the write are one statement, so a concurrent publish cannot slip a change into a published text.
  const done = await prisma.legalDocument.updateMany({ where: { id: req.params.id, status: 'DRAFT' }, data: data as Prisma.LegalDocumentUpdateManyMutationInput });
  if (done.count === 0) {
    if (!(await prisma.legalDocument.findUnique({ where: { id: req.params.id }, select: { id: true } }))) throw notFound('document');
    throw new AppError(409, 'LEGAL_NOT_DRAFT', 'A published version cannot be edited. Create a new version instead.');
  }
  const d = await prisma.legalDocument.findUniqueOrThrow({ where: { id: req.params.id } });
  await writeAudit('LEGAL_UPDATED', 'LEGAL_DOCUMENT', d.id, `${d.type} ${d.locale} v${d.version}`);
  res.json({ success: true, data: docView(d, true) });
}));

contentRouter.post('/admin/legal-documents/:id/publish', ...adminOnly, validParams('id'), wrap('publish legal document', async (req, res) => {
  const done = await prisma.legalDocument.updateMany({ where: { id: req.params.id, status: 'DRAFT' }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
  if (done.count === 0) {
    if (!(await prisma.legalDocument.findUnique({ where: { id: req.params.id }, select: { id: true } }))) throw notFound('document');
    throw new AppError(409, 'LEGAL_NOT_DRAFT', 'This version is already published.');
  }
  const d = await prisma.legalDocument.findUniqueOrThrow({ where: { id: req.params.id } });
  await writeAudit('LEGAL_PUBLISHED', 'LEGAL_DOCUMENT', d.id, `${d.type} ${d.locale} v${d.version}`);
  res.json({ success: true, data: docView(d, false) });
}));

contentRouter.post('/admin/legal-documents/:id/unpublish', ...adminOnly, validParams('id'), wrap('unpublish legal document', async (req, res) => {
  const done = await prisma.legalDocument.updateMany({ where: { id: req.params.id, status: 'PUBLISHED', isActive: false }, data: { status: 'DRAFT', publishedAt: null } });
  if (done.count === 0) {
    const cur = await prisma.legalDocument.findUnique({ where: { id: req.params.id } });
    if (!cur) throw notFound('document');
    throw new AppError(409, cur.isActive ? 'LEGAL_ACTIVE' : 'LEGAL_NOT_PUBLISHED', cur.isActive ? 'This is the version the apps show. Activate another version first.' : 'This version is not published.');
  }
  const d = await prisma.legalDocument.findUniqueOrThrow({ where: { id: req.params.id } });
  await writeAudit('LEGAL_UNPUBLISHED', 'LEGAL_DOCUMENT', d.id, `${d.type} ${d.locale} v${d.version}`);
  res.json({ success: true, data: docView(d, false) });
}));

contentRouter.post('/admin/legal-documents/:id/activate', ...adminOnly, validParams('id'), wrap('activate legal document', async (req, res) => {
  const d = await prisma.$transaction(async (tx) => {
    const cur = await tx.legalDocument.findUnique({ where: { id: req.params.id } });
    if (!cur) throw notFound('document');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`legal:${cur.type}:${cur.locale}`}))`;
    const fresh = await tx.legalDocument.findUniqueOrThrow({ where: { id: cur.id } });
    if (fresh.status !== 'PUBLISHED') throw new AppError(409, 'LEGAL_NOT_PUBLISHED', 'Publish this version before making it the active one.');
    await tx.legalDocument.updateMany({ where: { type: fresh.type, locale: fresh.locale, isActive: true, id: { not: fresh.id } }, data: { isActive: false } });
    return tx.legalDocument.update({ where: { id: fresh.id }, data: { isActive: true } });
  }, TX);
  await writeAudit('LEGAL_ACTIVATED', 'LEGAL_DOCUMENT', d.id, `${d.type} ${d.locale} v${d.version}`);
  res.json({ success: true, data: docView(d, false) });
}));

contentRouter.delete('/admin/legal-documents/:id', ...adminOnly, validParams('id'), wrap('delete legal document', async (req, res) => {
  const done = await prisma.legalDocument.deleteMany({ where: { id: req.params.id, status: 'DRAFT' } });
  if (done.count === 0) {
    if (!(await prisma.legalDocument.findUnique({ where: { id: req.params.id }, select: { id: true } }))) throw notFound('document');
    throw new AppError(409, 'LEGAL_NOT_DRAFT', 'A published version is kept for the record. Only a draft can be deleted.');
  }
  await writeAudit('LEGAL_DELETED', 'LEGAL_DOCUMENT', req.params.id, 'draft deleted');
  res.json({ success: true });
}));

/** The text the apps show: the active version of a type. Public. */
contentRouter.get('/legal/:type', wrap('public legal document', async (req, res) => {
  const type = oneOf({ type: req.params.type.toUpperCase().replace(/-/g, '_') }, 'type', LEGAL_TYPES);
  const locale = typeof req.query.locale === 'string' && (LOCALES as readonly string[]).includes(req.query.locale) ? req.query.locale : 'fr';
  const d = await prisma.legalDocument.findFirst({ where: { type, locale, isActive: true } }) ?? (locale !== 'fr' ? await prisma.legalDocument.findFirst({ where: { type, locale: 'fr', isActive: true } }) : null);
  if (!d) throw notFound('document');
  res.json({ success: true, data: docView(d, true) });
}));

// --------------------------------------------------------------------------------------------------------------------- help articles
const articleView = (a: Prisma.HelpArticleGetPayload<{}>, withContent: boolean) => ({
  id: a.id, slug: a.slug, theme: a.theme, audience: a.audience, title: a.title, isPublished: a.isPublished, sortOrder: a.sortOrder,
  createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString(), ...(withContent ? { content: a.content } : {}),
});

const readArticle = (b: Record<string, unknown>) => ({
  slug: (() => { const s = str(b, 'slug', 3, 80); if (!SLUG_RE.test(s)) throw bad('slug', 'slug uses lowercase letters, digits and single dashes.'); return s; })(),
  theme: str(b, 'theme', 2, 60), audience: oneOf(b, 'audience', AUDIENCES), title: str(b, 'title', 3, 140), content: longText(b, 'content', 20, 20_000),
  isPublished: b.isPublished === undefined ? false : bool(b, 'isPublished'), sortOrder: b.sortOrder === undefined ? 0 : int(b, 'sortOrder', 0, 10_000),
});
const ARTICLE_KEYS = ['slug', 'theme', 'audience', 'title', 'content', 'isPublished', 'sortOrder'] as const;

contentRouter.get('/admin/help-articles', ...adminOnly, wrap('list help articles', async (_q, res) => {
  const rows = await prisma.helpArticle.findMany({ orderBy: [{ theme: 'asc' }, { sortOrder: 'asc' }, { title: 'asc' }] });
  res.json({ success: true, data: rows.map((a) => articleView(a, false)) });
}));
contentRouter.get('/admin/help-articles/:id', ...adminOnly, validParams('id'), wrap('get help article', async (req, res) => {
  const a = await prisma.helpArticle.findUnique({ where: { id: req.params.id } });
  if (!a) throw notFound('article');
  res.json({ success: true, data: articleView(a, true) });
}));
contentRouter.post('/admin/help-articles', ...adminOnly, wrap('create help article', async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  onlyKeys(b, ARTICLE_KEYS);
  const data = readArticle(b);
  try {
    const a = await prisma.helpArticle.create({ data });
    await writeAudit('HELP_ARTICLE_CREATED', 'HELP_ARTICLE', a.id, a.slug);
    res.status(201).json({ success: true, data: articleView(a, true) });
  } catch (err: any) {
    if (err?.code === 'P2002') throw new AppError(409, 'SLUG_TAKEN', 'This slug is already used.', 'slug');
    throw err;
  }
}));
contentRouter.patch('/admin/help-articles/:id', ...adminOnly, validParams('id'), wrap('update help article', async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  onlyKeys(b, ARTICLE_KEYS);
  const cur = await prisma.helpArticle.findUnique({ where: { id: req.params.id } });
  if (!cur) throw notFound('article');
  const data = readArticle({ slug: cur.slug, theme: cur.theme, audience: cur.audience, title: cur.title, content: cur.content, isPublished: cur.isPublished, sortOrder: cur.sortOrder, ...b });
  try {
    const a = await prisma.helpArticle.update({ where: { id: cur.id }, data });
    await writeAudit('HELP_ARTICLE_UPDATED', 'HELP_ARTICLE', a.id, `${a.slug}${cur.isPublished !== a.isPublished ? (a.isPublished ? ' published' : ' unpublished') : ''}`);
    res.json({ success: true, data: articleView(a, true) });
  } catch (err: any) {
    if (err?.code === 'P2002') throw new AppError(409, 'SLUG_TAKEN', 'This slug is already used.', 'slug');
    throw err;
  }
}));
contentRouter.delete('/admin/help-articles/:id', ...adminOnly, validParams('id'), wrap('delete help article', async (req, res) => {
  const a = await prisma.helpArticle.delete({ where: { id: req.params.id } }).catch(() => null);
  if (!a) throw notFound('article');
  await writeAudit('HELP_ARTICLE_DELETED', 'HELP_ARTICLE', a.id, a.slug);
  res.json({ success: true });
}));

/** What the apps show: published articles for an audience (plus the ones for everyone). Public. */
contentRouter.get('/help/articles', wrap('public help articles', async (req, res) => {
  const audience = typeof req.query.audience === 'string' && (AUDIENCES as readonly string[]).includes(req.query.audience) ? req.query.audience : 'ALL';
  const rows = await prisma.helpArticle.findMany({ where: { isPublished: true, audience: audience === 'ALL' ? 'ALL' : { in: ['ALL', audience] } }, orderBy: [{ theme: 'asc' }, { sortOrder: 'asc' }] });
  res.json({ success: true, data: rows.map((a) => articleView(a, true)) });
}));
