/**
 * Admin dashboard data computed by the database (counts and aggregates), so the dashboard never has to download lists to count them:
 * overview, live orders, new sign-ups with the previous period, orders by status, reviews. Read-only, ADMIN routes only.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import { AppError } from '../utils/appError';
import { addLocalDays, localDayStartOf } from '../utils/time';
import { LocalRange, parseLocalRange } from '../utils/range';
import { DELIVERY_STUCK_ALERT_MIN, READY_NO_RIDER_ALERT_MIN, RIDER_PICKUP_ALERT_MIN, vendorAcceptWindowMin } from '../config/orderFlow';
import { financeSummary } from './finance';
import { supportCounts } from './support';
import { ORDER_VIEW_INCLUDE } from './orderView';
import { ID_RE } from '../utils/http';

// ---------------------------------------------------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------------------------------------------------
const PRESETS: Record<string, number> = { today: 1, '7d': 7, '30d': 30, '90d': 90 };

/** `range=today|7d|30d|90d`, or `from` / `to` (YYYY-MM-DD, Dakar days). Default 7 days, at most 366. */
export const resolveRange = (q: { range?: unknown; from?: unknown; to?: unknown }, now = new Date()): { current: LocalRange; previous: LocalRange; label: string } => {
  let current: LocalRange;
  let label: string;
  if (typeof q.range === 'string' && q.range !== '' && q.from === undefined && q.to === undefined) {
    const days = PRESETS[q.range];
    if (!days) throw new AppError(400, 'BAD_REQUEST', `range must be one of: ${Object.keys(PRESETS).join(', ')} (or use from and to).`, 'range');
    current = parseLocalRange(undefined, undefined, { defaultDays: days, maxDays: 366, now });
    label = q.range;
  } else {
    current = parseLocalRange(q.from, q.to, { defaultDays: 7, maxDays: 366, now });
    label = 'custom';
  }
  // The period right before, of the same length, to compare with.
  const prevTo = addLocalDays(current.from, -1);
  const prevFrom = addLocalDays(prevTo, -(current.days - 1));
  const previous: LocalRange = { from: prevFrom, to: prevTo, start: localDayStartOf(prevFrom), end: current.start, days: current.days };
  return { current, previous, label };
};

const rangeView = (r: LocalRange) => ({ from: r.from, to: r.to, days: r.days });
const changePct = (cur: number, prev: number): number | null => (prev === 0 ? (cur === 0 ? 0 : null) : Math.round(((cur - prev) / prev) * 1000) / 10);
const cmp = (cur: number, prev: number) => ({ current: cur, previous: prev, change: cur - prev, changePct: changePct(cur, prev) });

// ---------------------------------------------------------------------------------------------------------------------
// Orders: by status, rejected, live
// ---------------------------------------------------------------------------------------------------------------------
const OPEN_STATUSES = ['ACCEPTED', 'PREPARING', 'READY_FOR_PICKUP', 'PICKED_UP', 'ARRIVED_AT_GATE'] as const;

export const ordersByStatus = async (r: LocalRange) => {
  const where: Prisma.OrderWhereInput = { createdAt: { gte: r.start, lt: r.end } };
  const [byStatus, cancelledBy] = await Promise.all([
    prisma.order.groupBy({ by: ['status'], where, _count: { _all: true } }),
    prisma.order.groupBy({ by: ['cancelledBy'], where: { ...where, status: 'CANCELLED' }, _count: { _all: true } }),
  ]);
  const s = (k: string) => byStatus.find((b) => b.status === k)?._count._all ?? 0;
  const c = (k: string) => cancelledBy.find((b) => b.cancelledBy === k)?._count._all ?? 0;
  return {
    total: byStatus.reduce((a, b) => a + b._count._all, 0),
    delivered: s('DELIVERED'),
    cancelled: s('CANCELLED'),
    inProgress: OPEN_STATUSES.reduce((a, k) => a + s(k), 0),
    awaitingRestaurant: s('PLACED'),
    byStatus: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
    // "Refused by the restaurant" = cancelled by the restaurant itself (the restaurant side can only cancel, which is its refusal).
    rejectedByRestaurant: c('VENDOR'),
    cancelledBy: { CUSTOMER: c('CUSTOMER'), VENDOR: c('VENDOR'), ADMIN: c('ADMIN'), SYSTEM: c('SYSTEM') },
  };
};

/** The orders that need a human RIGHT NOW (same thresholds as /admin/orders/needs-attention, as a count). */
const stuckWhere = (now: Date): Prisma.OrderWhereInput => {
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);
  return {
    OR: [
      { status: 'PLACED', paymentStatus: 'PAID', OR: [{ paidAt: null }, { paidAt: { lt: ago(vendorAcceptWindowMin() + 5) } }] },
      { status: { in: ['PICKED_UP', 'ARRIVED_AT_GATE'] }, OR: [{ pickedUpAt: { lt: ago(DELIVERY_STUCK_ALERT_MIN) } }, { pickedUpAt: null, updatedAt: { lt: ago(DELIVERY_STUCK_ALERT_MIN) } }] },
      { status: 'READY_FOR_PICKUP', paymentStatus: 'PAID', driverId: { not: null }, updatedAt: { lt: ago(RIDER_PICKUP_ALERT_MIN) } },
      { status: 'READY_FOR_PICKUP', paymentStatus: 'PAID', driverId: null, updatedAt: { lt: ago(READY_NO_RIDER_ALERT_MIN) } },
      { otpLocked: true, status: 'ARRIVED_AT_GATE' },
    ],
  };
};

export const liveCounts = async (now = new Date()) => {
  const paid = { paymentStatus: 'PAID' as const };
  const [awaitingRestaurant, preparing, ready, onTheWay, noRider, stuck, unpaid] = await Promise.all([
    prisma.order.count({ where: { status: 'PLACED', ...paid } }),
    prisma.order.count({ where: { status: { in: ['ACCEPTED', 'PREPARING'] }, ...paid } }),
    prisma.order.count({ where: { status: 'READY_FOR_PICKUP', ...paid } }),
    prisma.order.count({ where: { status: { in: ['PICKED_UP', 'ARRIVED_AT_GATE'] }, ...paid } }),
    prisma.order.count({ where: { status: 'READY_FOR_PICKUP', ...paid, driverId: null } }),
    prisma.order.count({ where: { ...stuckWhere(now) } }),
    prisma.order.count({ where: { status: 'PLACED', paymentStatus: { not: 'PAID' }, createdAt: { gte: new Date(now.getTime() - 60 * 60_000) } } }),
  ]);
  return {
    // "In progress" = paid and not finished: what the restaurants and riders are working on.
    inProgress: awaitingRestaurant + preparing + ready + onTheWay,
    awaitingRestaurant, preparing, readyForPickup: ready, onTheWay,
    withoutRider: noRider, stuck, awaitingPayment: unpaid,
  };
};

export const liveOrders = async (q: { limit: number; problem?: unknown }, now = new Date()) => {
  const where: Prisma.OrderWhereInput = q.problem === 'stuck' ? stuckWhere(now) : q.problem === 'no_rider' ? { status: 'READY_FOR_PICKUP', paymentStatus: 'PAID', driverId: null } : { status: { in: ['PLACED', ...OPEN_STATUSES] }, paymentStatus: 'PAID' };
  if (q.problem !== undefined && !['stuck', 'no_rider'].includes(String(q.problem))) throw new AppError(400, 'BAD_REQUEST', 'problem must be stuck or no_rider.', 'problem');
  return prisma.order.findMany({ where, orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }], take: q.limit, include: ORDER_VIEW_INCLUDE });
};

// ---------------------------------------------------------------------------------------------------------------------
// Sign-ups and partners
// ---------------------------------------------------------------------------------------------------------------------
const signupsIn = async (r: { start: Date; end: Date }) => {
  const rows = await prisma.user.groupBy({ by: ['role'], where: { createdAt: { gte: r.start, lt: r.end }, deletedAt: null, role: { in: ['CLIENT', 'VENDOR', 'DRIVER'] } }, _count: { _all: true } });
  const n = (k: string) => rows.find((x) => x.role === k)?._count._all ?? 0;
  return { clients: n('CLIENT'), restaurants: n('VENDOR'), drivers: n('DRIVER') };
};

export const signups = async (cur: LocalRange, prev: LocalRange) => {
  const [a, b] = await Promise.all([signupsIn(cur), signupsIn(prev)]);
  return { clients: cmp(a.clients, b.clients), restaurants: cmp(a.restaurants, b.restaurants), drivers: cmp(a.drivers, b.drivers), previousRange: rangeView(prev) };
};

const partnersSnapshot = async () => {
  const [vendors, drivers, online, open] = await Promise.all([
    prisma.vendor.groupBy({ by: ['approvalStatus'], _count: { _all: true } }),
    prisma.driverPartner.groupBy({ by: ['approvalStatus'], _count: { _all: true } }),
    prisma.driverPartner.count({ where: { approvalStatus: 'APPROVED', dutyStatus: { in: ['ONLINE', 'IN_TRANSIT'] } } }),
    prisma.vendor.count({ where: { approvalStatus: 'APPROVED', isAcceptingOrders: true } }),
  ]);
  const by = (rows: { approvalStatus: string; _count: { _all: number } }[]) => ({
    total: rows.reduce((a, r) => a + r._count._all, 0), approved: rows.find((r) => r.approvalStatus === 'APPROVED')?._count._all ?? 0,
    pending: rows.find((r) => r.approvalStatus === 'PENDING')?._count._all ?? 0, suspended: rows.find((r) => r.approvalStatus === 'SUSPENDED')?._count._all ?? 0,
    rejected: rows.find((r) => r.approvalStatus === 'REJECTED')?._count._all ?? 0,
  });
  return { restaurants: { ...by(vendors), acceptingOrders: open }, drivers: { ...by(drivers), onDuty: online } };
};

// ---------------------------------------------------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------------------------------------------------
export const reviewStats = async (cur: { start: Date; end: Date }, prev?: { start: Date; end: Date }) => {
  const one = async (r: { start: Date; end: Date }) => {
    const [agg, dist, dish, low] = await Promise.all([
      prisma.reviewRecord.aggregate({ where: { createdAt: { gte: r.start, lt: r.end } }, _count: { _all: true }, _avg: { driverRating: true } }),
      prisma.$queryRaw<{ stars: number; n: number }[]>`SELECT LEAST(5, GREATEST(1, ROUND("driverRating")))::int AS "stars", COUNT(*)::int AS "n" FROM "ReviewRecord" WHERE "createdAt" >= ${r.start} AND "createdAt" < ${r.end} GROUP BY 1`,
      prisma.$queryRaw<{ avg: number | null; n: number }[]>`
        SELECT AVG((d->>'rating')::float8)::float8 AS "avg", COUNT(*)::int AS "n"
        FROM "ReviewRecord" rr, LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(rr."dishReviews") = 'array' THEN rr."dishReviews" ELSE '[]'::jsonb END) d
        WHERE rr."createdAt" >= ${r.start} AND rr."createdAt" < ${r.end} AND (d->>'rating') ~ '^[0-9.]+$'`,
      prisma.reviewRecord.count({ where: { createdAt: { gte: r.start, lt: r.end }, driverRating: { lte: 2 } } }),
    ]);
    const r1 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);
    return {
      count: agg._count._all, averageDriverRating: r1(agg._avg.driverRating), averageDishRating: r1(dish[0]?.avg), dishRatingsCount: dish[0]?.n ?? 0, lowRated: low,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, ...Object.fromEntries(dist.map((d) => [d.stars, d.n])) } as Record<string, number>,
    };
  };
  const [current, previous, flaggedOpen] = await Promise.all([one(cur), prev ? one(prev) : Promise.resolve(null), prisma.reviewRecord.count({ where: { flagged: true } })]);
  return { ...current, flaggedOpen, ...(previous ? { previous: { count: previous.count, averageDriverRating: previous.averageDriverRating, averageDishRating: previous.averageDishRating }, countChangePct: changePct(current.count, previous.count) } : {}) };
};

export const listReviews = async (q: { rating?: unknown; flagged?: unknown; vendorId?: unknown; driverId?: unknown; range?: LocalRange; page: number; pageSize: number }) => {
  const where: Prisma.ReviewRecordWhereInput = {};
  if (q.rating !== undefined && q.rating !== '') {
    const n = Number(q.rating);
    if (!Number.isInteger(n) || n < 1 || n > 5) throw new AppError(400, 'BAD_REQUEST', 'rating must be 1 to 5.', 'rating');
    where.driverRating = { gte: n - 0.5, lt: n + 0.5 };
  }
  if (q.flagged !== undefined && q.flagged !== '') {
    if (q.flagged !== 'true' && q.flagged !== 'false') throw new AppError(400, 'BAD_REQUEST', 'flagged must be true or false.', 'flagged');
    where.flagged = q.flagged === 'true';
  }
  for (const k of ['vendorId', 'driverId'] as const) {
    const v = q[k];
    if (typeof v === 'string' && v) { if (!ID_RE.test(v)) throw new AppError(400, 'BAD_REQUEST', `Invalid ${k}.`, k); where[k] = v; }
  }
  if (q.range) where.createdAt = { gte: q.range.start, lt: q.range.end };
  const [total, rows] = await Promise.all([
    prisma.reviewRecord.count({ where }),
    prisma.reviewRecord.findMany({
      where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: { customer: { select: { id: true, name: true } }, vendor: { select: { id: true, name: true } }, driver: { select: { id: true, name: true } } },
    }),
  ]);
  return {
    total, page: q.page, pageSize: q.pageSize,
    data: rows.map((r) => ({
      id: r.id, orderId: r.orderId, createdAt: r.createdAt.toISOString(), driverRating: r.driverRating, driverTags: r.driverTags, driverNotes: r.driverNotes, dishReviews: r.dishReviews, restaurantNotes: r.dhabaNotes,
      customer: r.customer ? { id: r.customer.id, name: r.customer.name } : null, restaurant: { id: r.vendor.id, name: r.vendor.name }, driver: r.driver ? { id: r.driver.id, name: r.driver.name } : null,
      flagged: r.flagged, flagReason: r.flagReason, flaggedBy: r.flaggedBy, flaggedAt: r.flaggedAt?.toISOString() ?? null,
    })),
  };
};

// ---------------------------------------------------------------------------------------------------------------------
// One call for the dashboard
// ---------------------------------------------------------------------------------------------------------------------
export const overview = async (q: { range?: unknown; from?: unknown; to?: unknown }, now = new Date()) => {
  const { current, previous, label } = resolveRange(q, now);
  const [orders, ordersPrev, live, sign, partners, reviews, support, finance] = await Promise.all([
    ordersByStatus(current), ordersByStatus(previous), liveCounts(now), signups(current, previous), partnersSnapshot(),
    reviewStats(current, previous), supportCounts(current), financeSummary(current),
  ]);
  return {
    range: { ...rangeView(current), preset: label }, previousRange: rangeView(previous),
    orders: { ...orders, previous: { total: ordersPrev.total, delivered: ordersPrev.delivered, cancelled: ordersPrev.cancelled, rejectedByRestaurant: ordersPrev.rejectedByRestaurant }, totalChangePct: changePct(orders.total, ordersPrev.total), deliveredChangePct: changePct(orders.delivered, ordersPrev.delivered) },
    live, signups: sign, partners, reviews, support, finance,
    generatedAt: now.toISOString(),
  };
};
