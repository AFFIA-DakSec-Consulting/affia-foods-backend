/**
 * Support and complaints. Customers, restaurants and riders open a ticket (optionally about one of THEIR orders) and exchange messages
 * with the admins, who triage, assign, answer and resolve it. Everything an admin writes is audit-logged; an internal note is never
 * shown to the person who opened the ticket. Ownership is checked on every read and write: a ticket of somebody else is a 404.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../utils/appError';
import { writeAudit } from './audit';
import { ID_RE } from '../utils/http';

export const TICKET_CATEGORIES = ['ORDER', 'PAYMENT', 'DELIVERY', 'FOOD_QUALITY', 'ACCOUNT', 'APP', 'OTHER'] as const;
export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

export const MAX_OPEN_TICKETS_PER_USER = 5;
export const MAX_MESSAGES_PER_TICKET = 200;
const SUPPORT_ROLES = ['CLIENT', 'VENDOR', 'DRIVER'] as const;

const bad = (field: string, message: string) => new AppError(400, 'BAD_REQUEST', message, field);
const notFound = () => new AppError(404, 'NOT_FOUND', 'Ticket not found.');

/** Free text written by a person: no NUL / control characters (new lines and tabs are fine), no `<` `>`, trimmed, bounded. */
const text = (raw: unknown, field: string, min: number, max: number): string => {
  if (typeof raw !== 'string') throw bad(field, `${field} must be a text.`);
  const t = raw.replace(/\r\n/g, '\n').trim();
  if (t.length < min || t.length > max) throw bad(field, `${field} must be ${min} to ${max} characters.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/.test(t)) throw bad(field, `${field} contains forbidden characters.`);
  return t;
};
const oneOf = <T extends string>(raw: unknown, field: string, allowed: readonly T[]): T => {
  if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) throw bad(field, `${field} must be one of: ${allowed.join(', ')}.`);
  return raw as T;
};

const userView = (u: { id: string; name: string; phone: string | null; role: string } | null | undefined) => (u ? { id: u.id, name: u.name, phone: u.phone, role: u.role } : null);

const messageView = (m: Prisma.SupportMessageGetPayload<{}>) => ({ id: m.id, authorId: m.authorId, authorRole: m.authorRole, body: m.body, internal: m.internal, createdAt: m.createdAt.toISOString() });

const ticketView = (t: Prisma.SupportTicketGetPayload<{}>) => ({
  id: t.id, category: t.category, subject: t.subject, status: t.status, priority: t.priority, orderId: t.orderId, openedByRole: t.role,
  resolution: t.resolution, resolvedAt: t.resolvedAt?.toISOString() ?? null, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString(), lastMessageAt: t.lastMessageAt.toISOString(),
});

// ---------------------------------------------------------------------------------------------------------------------
// The person who has the problem
// ---------------------------------------------------------------------------------------------------------------------
/** The order must belong to the person (customer, restaurant owner or assigned rider): nobody opens tickets about other people's orders. */
const ownsOrder = async (orderId: string, userId: string, role: string): Promise<boolean> => {
  if (!ID_RE.test(orderId)) return false;
  const o = await prisma.order.findUnique({ where: { id: orderId }, select: { customerId: true, driverId: true, vendor: { select: { userId: true } } } });
  if (!o) return false;
  return role === 'CLIENT' ? o.customerId === userId : role === 'DRIVER' ? o.driverId === userId : o.vendor.userId === userId;
};

export const createTicket = async (user: { id: string; role: string }, raw: unknown) => {
  if (!SUPPORT_ROLES.includes(user.role as any)) throw new AppError(403, 'FORBIDDEN', 'This account cannot open a support ticket.');
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw bad('body', 'Send an object.');
  const b = raw as Record<string, unknown>;
  const extra = Object.keys(b).find((k) => !['category', 'subject', 'message', 'orderId'].includes(k));
  if (extra) throw bad(extra.slice(0, 40), `Unknown field '${extra.slice(0, 40)}'.`);
  const category = oneOf(b.category, 'category', TICKET_CATEGORIES);
  const subject = text(b.subject, 'subject', 3, 120);
  const message = text(b.message, 'message', 5, 2000);
  let orderId: string | null = null;
  if (b.orderId !== undefined && b.orderId !== null) {
    if (typeof b.orderId !== 'string' || !(await ownsOrder(b.orderId, user.id, user.role))) throw bad('orderId', 'This order was not found on your account.');
    orderId = b.orderId;
  }
  return prisma.$transaction(async (tx) => {
    // One person at a time: the limit cannot be raced by two parallel requests.
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
    const open = await tx.supportTicket.count({ where: { userId: user.id, status: { in: ['OPEN', 'IN_PROGRESS'] } } });
    if (open >= MAX_OPEN_TICKETS_PER_USER) throw new AppError(429, 'TOO_MANY_TICKETS', `You already have ${open} open requests. Wait for an answer before opening another one.`);
    const t = await tx.supportTicket.create({ data: { userId: user.id, role: user.role, orderId, category, subject, messages: { create: { authorId: user.id, authorRole: user.role, body: message } } } });
    return ticketView(t);
  });
};

export const listMyTickets = async (userId: string, q: { status?: string; page: number; pageSize: number }) => {
  const where: Prisma.SupportTicketWhereInput = { userId, ...(q.status ? { status: oneOf(q.status, 'status', TICKET_STATUSES) } : {}) };
  const [total, rows] = await Promise.all([
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.findMany({ where, orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  return { total, page: q.page, pageSize: q.pageSize, data: rows.map(ticketView) };
};

export const getMyTicket = async (userId: string, id: string) => {
  const t = await prisma.supportTicket.findFirst({ where: { id, userId }, include: { messages: { where: { internal: false }, orderBy: { createdAt: 'asc' }, take: MAX_MESSAGES_PER_TICKET } } });
  if (!t) throw notFound();
  return { ...ticketView(t), messages: t.messages.map(messageView) };
};

export const postMyMessage = async (user: { id: string; role: string }, id: string, raw: unknown) => {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const body = text(b.message, 'message', 2, 2000);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string }[]>`SELECT "status" FROM "SupportTicket" WHERE "id" = ${id} AND "userId" = ${user.id} FOR UPDATE`;
    if (rows.length === 0) throw notFound();
    if (rows[0].status === 'CLOSED') throw new AppError(409, 'TICKET_CLOSED', 'This request is closed. Open a new one if the problem is back.');
    if ((await tx.supportMessage.count({ where: { ticketId: id } })) >= MAX_MESSAGES_PER_TICKET) throw new AppError(429, 'TOO_MANY_MESSAGES', 'This conversation is full. Open a new request.');
    const m = await tx.supportMessage.create({ data: { ticketId: id, authorId: user.id, authorRole: user.role, body } });
    // An answer from the person re-opens a resolved ticket: the problem is not solved for them.
    await tx.supportTicket.update({ where: { id }, data: { lastMessageAt: m.createdAt, ...(rows[0].status === 'RESOLVED' ? { status: 'OPEN', resolvedAt: null } : {}) } });
    return messageView(m);
  });
};

// ---------------------------------------------------------------------------------------------------------------------
// Admins
// ---------------------------------------------------------------------------------------------------------------------
export const adminListTickets = async (q: { status?: unknown; category?: unknown; priority?: unknown; assignedTo?: unknown; userId?: unknown; orderId?: unknown; q?: unknown; page: number; pageSize: number }) => {
  const where: Prisma.SupportTicketWhereInput = {};
  if (q.status) where.status = oneOf(q.status, 'status', TICKET_STATUSES);
  if (q.category) where.category = oneOf(q.category, 'category', TICKET_CATEGORIES);
  if (q.priority) where.priority = oneOf(q.priority, 'priority', TICKET_PRIORITIES);
  if (q.assignedTo === 'none') where.assignedTo = null;
  else if (typeof q.assignedTo === 'string' && q.assignedTo) { if (!ID_RE.test(q.assignedTo)) throw bad('assignedTo', 'Invalid id.'); where.assignedTo = q.assignedTo; }
  if (typeof q.userId === 'string' && q.userId) { if (!ID_RE.test(q.userId)) throw bad('userId', 'Invalid id.'); where.userId = q.userId; }
  if (typeof q.orderId === 'string' && q.orderId) { if (!ID_RE.test(q.orderId)) throw bad('orderId', 'Invalid id.'); where.orderId = q.orderId; }
  if (typeof q.q === 'string' && q.q.trim()) where.subject = { contains: q.q.trim().slice(0, 60), mode: 'insensitive' };
  const [total, rows] = await Promise.all([
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.findMany({
      where, include: { user: { select: { id: true, name: true, phone: true, role: true } }, _count: { select: { messages: true } } },
      // urgent first, then the ones waiting longest
      orderBy: [{ lastMessageAt: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize,
    }),
  ]);
  const rank = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as Record<string, number>;
  const open = (s: string) => (s === 'OPEN' || s === 'IN_PROGRESS' ? 0 : 1);
  const data = rows
    .map((t) => ({ ...ticketView(t), assignedTo: t.assignedTo, firstResponseAt: t.firstResponseAt?.toISOString() ?? null, messageCount: t._count.messages, user: userView(t.user) }))
    .sort((a, b) => open(a.status) - open(b.status) || (rank[a.priority] ?? 2) - (rank[b.priority] ?? 2));
  return { total, page: q.page, pageSize: q.pageSize, data };
};

export const adminGetTicket = async (id: string) => {
  const t = await prisma.supportTicket.findUnique({ where: { id }, include: { user: { select: { id: true, name: true, phone: true, role: true } }, messages: { orderBy: { createdAt: 'asc' }, take: MAX_MESSAGES_PER_TICKET + 50 } } });
  if (!t) throw notFound();
  return { ...ticketView(t), assignedTo: t.assignedTo, firstResponseAt: t.firstResponseAt?.toISOString() ?? null, user: userView(t.user), messages: t.messages.map(messageView) };
};

export const adminUpdateTicket = async (id: string, raw: unknown, actorId: string) => {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const extra = Object.keys(b).find((k) => !['status', 'priority', 'assignedTo', 'resolution'].includes(k));
  if (extra) throw bad(extra.slice(0, 40), `Unknown field '${extra.slice(0, 40)}'.`);
  if (Object.keys(b).length === 0) throw bad('body', 'Nothing to change.');
  const data: Prisma.SupportTicketUpdateInput = {};
  if (b.priority !== undefined) data.priority = oneOf(b.priority, 'priority', TICKET_PRIORITIES);
  if (b.assignedTo !== undefined) {
    if (b.assignedTo === null) data.assignedTo = null;
    else {
      if (typeof b.assignedTo !== 'string' || !ID_RE.test(b.assignedTo) || !(await prisma.user.findFirst({ where: { id: b.assignedTo, role: 'ADMIN', deletedAt: null }, select: { id: true } }))) throw bad('assignedTo', 'assignedTo must be an admin account (or null).');
      data.assignedTo = b.assignedTo;
    }
  }
  if (b.resolution !== undefined) data.resolution = b.resolution === null ? null : text(b.resolution, 'resolution', 3, 1000);
  const status = b.status === undefined ? undefined : oneOf(b.status, 'status', TICKET_STATUSES);
  const out = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Prisma.SupportTicketGetPayload<{}>[]>`SELECT * FROM "SupportTicket" WHERE "id" = ${id} FOR UPDATE`;
    const cur = rows[0];
    if (!cur) throw notFound();
    if (status && status !== cur.status) {
      data.status = status;
      data.resolvedAt = status === 'RESOLVED' || status === 'CLOSED' ? cur.resolvedAt ?? new Date() : null;
      if (status === 'RESOLVED' && !(data.resolution ?? cur.resolution)) throw bad('resolution', 'Write what was done (resolution) before marking the ticket resolved.');
    }
    const row = await tx.supportTicket.update({ where: { id }, data });
    return { before: cur, row };
  });
  await writeAudit('SUPPORT_TICKET_UPDATED', 'SUPPORT_TICKET', id, `${actorId}: ${Object.keys(b).map((k) => `${k} ${JSON.stringify((out.before as any)[k])} -> ${JSON.stringify((out.row as any)[k])}`).join('; ')}`);
  return ticketView(out.row);
};

export const adminReply = async (id: string, raw: unknown, actorId: string) => {
  const b = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const extra = Object.keys(b).find((k) => !['message', 'internal'].includes(k));
  if (extra) throw bad(extra.slice(0, 40), `Unknown field '${extra.slice(0, 40)}'.`);
  const body = text(b.message, 'message', 2, 2000);
  const internal = b.internal === undefined ? false : b.internal === true ? true : (() => { if (b.internal !== false) throw bad('internal', 'internal must be true or false.'); return false; })();
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ status: string; firstResponseAt: Date | null }[]>`SELECT "status", "firstResponseAt" FROM "SupportTicket" WHERE "id" = ${id} FOR UPDATE`;
    if (rows.length === 0) throw notFound();
    if (rows[0].status === 'CLOSED') throw new AppError(409, 'TICKET_CLOSED', 'This ticket is closed.');
    const m = await tx.supportMessage.create({ data: { ticketId: id, authorId: actorId, authorRole: 'ADMIN', body, internal } });
    // A visible answer is the "first response" and moves a new ticket to IN_PROGRESS; an internal note changes neither.
    await tx.supportTicket.update({
      where: { id },
      data: internal ? {} : { lastMessageAt: m.createdAt, ...(rows[0].firstResponseAt ? {} : { firstResponseAt: m.createdAt }), ...(rows[0].status === 'OPEN' ? { status: 'IN_PROGRESS' } : {}) },
    });
    return messageView(m);
  });
};

export const supportCounts = async (range?: { start: Date; end: Date }) => {
  const [byStatus, byCategory, times] = await Promise.all([
    prisma.supportTicket.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.supportTicket.groupBy({ by: ['category'], where: { status: { in: ['OPEN', 'IN_PROGRESS'] } }, _count: { _all: true } }),
    prisma.$queryRaw<{ firstMin: number | null; resolveHours: number | null }[]>`
      SELECT AVG(EXTRACT(EPOCH FROM ("firstResponseAt" - "createdAt")) / 60)::float8 AS "firstMin",
             AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "createdAt")) / 3600)::float8 AS "resolveHours"
      FROM "SupportTicket"
      WHERE ${range ? Prisma.sql`"createdAt" >= ${range.start} AND "createdAt" < ${range.end}` : Prisma.sql`"createdAt" >= now() - interval '30 days'`}`,
  ]);
  const n = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const round1 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
  return {
    open: n('OPEN'), inProgress: n('IN_PROGRESS'), resolved: n('RESOLVED'), closed: n('CLOSED'), total: byStatus.reduce((a, b) => a + b._count._all, 0),
    openByCategory: Object.fromEntries(byCategory.map((c) => [c.category, c._count._all])),
    avgFirstResponseMinutes: round1(times[0]?.firstMin), avgResolutionHours: round1(times[0]?.resolveHours),
  };
};
