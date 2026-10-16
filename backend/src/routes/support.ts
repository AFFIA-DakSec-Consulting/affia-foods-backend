import { Router, Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/auth';
import { AppError } from '../utils/appError';
import { fail, validParams } from '../utils/http';
import { parsePaging, parseLocalRange } from '../utils/range';
import { writeAudit } from '../services/audit';
import { adminGetTicket, adminListTickets, adminReply, adminUpdateTicket, createTicket, getMyTicket, listMyTickets, postMyMessage, supportCounts } from '../services/support';
import { liveCounts, liveOrders, listReviews, overview, resolveRange, reviewStats } from '../services/adminStats';
import { orderView } from '../services/orderView';

/**
 * Support tickets (customers, restaurants and riders open them; admins handle them) and the admin dashboard data
 * (overview, live orders, reviews). Mounted under /api. Admin routes are ADMIN only; the person's routes only ever see their own tickets.
 */
export const supportRouter = Router();
const adminOnly = [requireAuth, requireRole('ADMIN')] as const;
const anyUser = [requireAuth, requireRole('CLIENT', 'VENDOR', 'DRIVER')] as const;
const wrap = (what: string, fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) => async (req: AuthenticatedRequest, res: Response) => {
  try { await fn(req, res); } catch (err) { fail(res, err, what); }
};
const actor = (req: AuthenticatedRequest) => req.user!.id;
const role = (req: AuthenticatedRequest) => req.user!.role as string;
const asString = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

// ---- the person who has a problem
supportRouter.post('/support/tickets', ...anyUser, wrap('create ticket', async (req, res) => res.status(201).json({ success: true, data: await createTicket({ id: actor(req), role: role(req) }, req.body) })));
supportRouter.get('/support/tickets', ...anyUser, wrap('list my tickets', async (req, res) => res.json({ success: true, ...(await listMyTickets(actor(req), { status: asString(req.query.status), ...parsePaging(req.query.page, req.query.pageSize) })) })));
supportRouter.get('/support/tickets/:id', ...anyUser, validParams('id'), wrap('get my ticket', async (req, res) => res.json({ success: true, data: await getMyTicket(actor(req), req.params.id) })));
supportRouter.post('/support/tickets/:id/messages', ...anyUser, validParams('id'), wrap('post my message', async (req, res) => res.status(201).json({ success: true, data: await postMyMessage({ id: actor(req), role: role(req) }, req.params.id, req.body) })));

// ---- admins: tickets
supportRouter.get('/admin/support/tickets', ...adminOnly, wrap('admin list tickets', async (req, res) => {
  const q = req.query;
  res.json({ success: true, ...(await adminListTickets({ status: q.status, category: q.category, priority: q.priority, assignedTo: q.assignedTo, userId: q.userId, orderId: q.orderId, q: q.q, ...parsePaging(q.page, q.pageSize) })) });
}));
supportRouter.get('/admin/support/stats', ...adminOnly, wrap('support stats', async (req, res) => {
  const { current } = resolveRange({ range: req.query.range, from: req.query.from, to: req.query.to });
  res.json({ success: true, data: await supportCounts(current) });
}));
supportRouter.get('/admin/support/tickets/:id', ...adminOnly, validParams('id'), wrap('admin get ticket', async (req, res) => res.json({ success: true, data: await adminGetTicket(req.params.id) })));
supportRouter.patch('/admin/support/tickets/:id', ...adminOnly, validParams('id'), wrap('admin update ticket', async (req, res) => res.json({ success: true, data: await adminUpdateTicket(req.params.id, req.body, actor(req)) })));
supportRouter.post('/admin/support/tickets/:id/messages', ...adminOnly, validParams('id'), wrap('admin reply', async (req, res) => res.status(201).json({ success: true, data: await adminReply(req.params.id, req.body, actor(req)) })));

// ---- admins: dashboard
supportRouter.get('/admin/stats/overview', ...adminOnly, wrap('stats overview', async (req, res) => res.json({ success: true, data: await overview({ range: req.query.range, from: req.query.from, to: req.query.to }) })));

supportRouter.get('/admin/orders/live', ...adminOnly, wrap('live orders', async (req, res) => {
  const requested = Number.parseInt(String(req.query.limit ?? '50'), 10);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 200) : 50;
  const counts = await liveCounts();
  const list = req.query.list === 'false' ? [] : await liveOrders({ limit, problem: req.query.problem });
  res.json({ success: true, counts, count: list.length, data: list.map((o) => orderView(o, 'ADMIN', actor(req))).filter((v) => v !== null) });
}));

// ---- admins: reviews
supportRouter.get('/admin/reviews/stats', ...adminOnly, wrap('review stats', async (req, res) => {
  const { current, previous } = resolveRange({ range: req.query.range, from: req.query.from, to: req.query.to });
  res.json({ success: true, data: await reviewStats(current, previous) });
}));
supportRouter.get('/admin/reviews', ...adminOnly, wrap('admin list reviews', async (req, res) => {
  const q = req.query;
  const hasRange = q.from !== undefined || q.to !== undefined;
  const range = hasRange ? parseLocalRange(q.from, q.to, { defaultDays: 30, maxDays: 366 }) : undefined;
  res.json({ success: true, ...(await listReviews({ rating: q.rating, flagged: q.flagged, vendorId: q.vendorId, driverId: q.driverId, range, ...parsePaging(q.page, q.pageSize) })) });
}));

const reasonOf = (raw: unknown): string => {
  if (typeof raw !== 'string') throw new AppError(400, 'BAD_REQUEST', 'reason must be a text of 3 to 300 characters.', 'reason');
  const t = raw.trim().replace(/\s+/g, ' ');
  if (t.length < 3 || t.length > 300 || /[\u0000-\u001f\u007f<>]/.test(t)) throw new AppError(400, 'BAD_REQUEST', 'reason must be a text of 3 to 300 characters, without special symbols.', 'reason');
  return t;
};

// An admin flags or clears a review.
supportRouter.patch('/admin/reviews/:id/flag', ...adminOnly, validParams('id'), wrap('flag review', async (req, res) => {
  const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const extra = Object.keys(b).find((k) => !['flagged', 'reason'].includes(k));
  if (extra) throw new AppError(400, 'BAD_REQUEST', `Unknown field '${extra.slice(0, 40)}'.`, extra.slice(0, 40));
  if (typeof b.flagged !== 'boolean') throw new AppError(400, 'BAD_REQUEST', 'flagged must be true or false.', 'flagged');
  const data = b.flagged ? { flagged: true, flagReason: reasonOf(b.reason), flaggedBy: `ADMIN:${actor(req)}`, flaggedAt: new Date() } : { flagged: false, flagReason: null, flaggedBy: null, flaggedAt: null };
  const row = await prisma.reviewRecord.update({ where: { id: req.params.id }, data }).catch(() => null);
  if (!row) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Review not found.' });
  await writeAudit(b.flagged ? 'REVIEW_FLAGGED' : 'REVIEW_UNFLAGGED', 'REVIEW', row.id, `${actor(req)}${b.flagged ? `: ${data.flagReason}` : ''}`);
  res.json({ success: true, data: { id: row.id, flagged: row.flagged, flagReason: row.flagReason, flaggedAt: row.flaggedAt?.toISOString() ?? null } });
}));

// A restaurant reports a review about its own restaurant (an admin then decides). It can never clear a flag.
supportRouter.post('/reviews/:id/report', requireAuth, requireRole('VENDOR'), validParams('id'), wrap('report review', async (req, res) => {
  const b = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  const reason = reasonOf(b.reason);
  const review = await prisma.reviewRecord.findFirst({ where: { id: req.params.id, vendor: { userId: actor(req) } }, select: { id: true, flagged: true } });
  if (!review) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Review not found.' });
  if (!review.flagged) {
    await prisma.reviewRecord.updateMany({ where: { id: review.id, flagged: false }, data: { flagged: true, flagReason: reason, flaggedBy: `VENDOR:${actor(req)}`, flaggedAt: new Date() } });
    await writeAudit('REVIEW_REPORTED', 'REVIEW', review.id, `vendor ${actor(req)}: ${reason}`);
  }
  res.json({ success: true, message: 'Thank you. Our team will look at this review.' });
}));
