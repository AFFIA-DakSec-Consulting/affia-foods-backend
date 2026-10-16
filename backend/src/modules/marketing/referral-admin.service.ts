/**
 * Back-office view of the sponsorship table (KRAVEO_SPEC_MODULES.md, marketing.referral). Read-only except cancelling a PENDING referral
 * that looks fraudulent. Paying the reward is the loyalty rules' job (trigger REFERRAL), not done here.
 */
import { prisma } from '../../db';
import { AppError } from '../../utils/appError';
import { audit } from '../../core/modules/module-admin.service';
import { bad } from '../../core/modules/validate-kit';

const STATUSES = ['PENDING', 'REWARDED', 'CANCELLED'] as const;
type PersonView = { id: string; name: string; phone: string | null } | null;

const peopleById = async (ids: string[]): Promise<Map<string, PersonView>> => {
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true } });
  return new Map(users.map((u) => [u.id, { id: u.id, name: u.name, phone: u.phone ?? null }]));
};

export const listReferrals = async (q: { status?: string; page: number; pageSize: number }) => {
  if (q.status !== undefined && q.status !== '' && !(STATUSES as readonly string[]).includes(q.status)) throw bad('status', 'status must be PENDING, REWARDED or CANCELLED.');
  const where = q.status ? { status: q.status } : {};
  const [total, rows] = await Promise.all([
    prisma.referral.count({ where }),
    prisma.referral.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  const people = await peopleById([...new Set(rows.flatMap((r) => [r.referrerId, r.refereeId]))]);
  return {
    total, page: q.page, pageSize: q.pageSize,
    data: rows.map((r) => ({ id: r.id, code: r.code, status: r.status, createdAt: r.createdAt.toISOString(), rewardedAt: r.rewardedAt?.toISOString() ?? null, referrer: people.get(r.referrerId) ?? null, referee: people.get(r.refereeId) ?? null })),
  };
};

export const referralStats = async () => {
  const [byStatus, top] = await Promise.all([
    prisma.referral.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.referral.groupBy({ by: ['referrerId'], _count: { _all: true }, orderBy: { _count: { referrerId: 'desc' } }, take: 5 }),
  ]);
  const n = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const total = n('PENDING') + n('REWARDED') + n('CANCELLED');
  const people = await peopleById(top.map((t) => t.referrerId));
  const rewardedBy = await prisma.referral.groupBy({ by: ['referrerId'], where: { status: 'REWARDED', referrerId: { in: top.map((t) => t.referrerId) } }, _count: { _all: true } });
  return {
    total, pending: n('PENDING'), rewarded: n('REWARDED'), cancelled: n('CANCELLED'),
    conversionRate: total === 0 ? 0 : Math.round((n('REWARDED') / total) * 1000) / 10,
    topReferrers: top.map((t) => ({ id: t.referrerId, name: people.get(t.referrerId)?.name ?? 'Client', referrals: t._count._all, rewarded: rewardedBy.find((r) => r.referrerId === t.referrerId)?._count._all ?? 0 })),
  };
};

export const cancelReferral = async (id: string, actorId: string) => {
  const cur = await prisma.referral.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'Unknown referral.');
  if (cur.status !== 'PENDING') throw new AppError(409, 'REFERRAL_NOT_PENDING', 'Only a referral that is still pending can be cancelled.');
  const done = await prisma.referral.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
  if (done.count === 0) throw new AppError(409, 'REFERRAL_NOT_PENDING', 'Only a referral that is still pending can be cancelled.');
  await audit(prisma, { moduleCode: 'marketing.referral', action: 'CANCEL_REFERRAL', oldValue: { id, status: 'PENDING' }, newValue: { status: 'CANCELLED' }, changedBy: actorId });
  return { id, status: 'CANCELLED' };
};
