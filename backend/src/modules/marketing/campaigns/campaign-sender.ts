/**
 * Marketing campaigns (KRAVEO_SPEC_MODULES.md 7.15): segment -> push -> conversion. This path is SEPARATE from the order-status push
 * (services/push): it never touches PushLog or an order, and switching the `marketing.campaigns` module off only stops THIS file
 * (rule 6: a customer can always follow an order).
 *
 * Safety rules enforced here, not in the app:
 *  - one send per (campaign, customer) (unique CampaignDelivery row, claimed before sending);
 *  - customers who switched marketing off (User.marketingOptOut) or have no customer-app device are skipped;
 *  - at most `daily_push_cap` marketing pushes per customer per 24 h, none during `quiet_hours` (the campaign waits);
 *  - a campaign is claimed atomically (SCHEDULED/DRAFT -> SENDING) so two servers or two clicks never send it twice;
 *  - sends are bounded in time and in concurrency; a dead device token is switched off like for order pushes.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../../db';
import { AppError } from '../../../utils/appError';
import { errSummary } from '../../../utils/log';
import { getRegistry } from '../../../core/modules/module-registry.service';
import { inWindow } from '../../../shared/pricing/clock';
import { classifyPushError, getPushProvider } from '../../../services/push/provider';
import { activeTokensFor, disableToken } from '../../../services/push/deviceTokens';
import type { PushMessage } from '../../../services/push/types';

const MAX_RECIPIENTS = 50_000;
const BATCH = 200;
const CONCURRENCY = 20;
const SEND_TIMEOUT_MS = 8_000;

export type Segment = { last_order_days_gt?: number; min_orders?: number; max_orders?: number; city?: string };

type Cfg = { dailyCap: number; quiet: { from: string; to: string } };
const loadCfg = async (): Promise<Cfg> => {
  const r = await getRegistry();
  return { dailyCap: r.num('marketing.campaigns', 'daily_push_cap'), quiet: r.json<{ from: string; to: string }>('marketing.campaigns', 'quiet_hours') };
};

/** Customers matching the segment: active CLIENT accounts that accept marketing. Never returns more than MAX_RECIPIENTS. */
export const resolveSegment = async (segment: Segment, now: Date): Promise<string[]> => {
  const where: Prisma.UserWhereInput = { role: 'CLIENT', deletedAt: null, marketingOptOut: false };
  if (segment.city) where.hostelBlock = { contains: segment.city, mode: 'insensitive' };
  const users = await prisma.user.findMany({ where, select: { id: true }, take: MAX_RECIPIENTS, orderBy: { id: 'asc' } });
  if (segment.last_order_days_gt === undefined && segment.min_orders === undefined && segment.max_orders === undefined) return users.map((u) => u.id);
  const stats = await prisma.order.groupBy({ by: ['customerId'], where: { status: { not: 'CANCELLED' }, customerId: { in: users.map((u) => u.id) } }, _count: { _all: true }, _max: { createdAt: true } });
  const byUser = new Map(stats.map((s) => [s.customerId, s]));
  const limit = segment.last_order_days_gt === undefined ? null : new Date(now.getTime() - segment.last_order_days_gt * 86_400_000);
  return users.map((u) => u.id).filter((id) => {
    const s = byUser.get(id);
    const n = s?._count._all ?? 0;
    if (segment.min_orders !== undefined && n < segment.min_orders) return false;
    if (segment.max_orders !== undefined && n > segment.max_orders) return false;
    if (limit && !(s?._max.createdAt && s._max.createdAt < limit)) return false; // "inactive for N days" only means something for customers who ordered once
    return true;
  });
};

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('push send timed out'), { code: 'TIMEOUT' })), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });

export type SendOutcome = { campaignId: string; recipients: number; sent: number; skipped: number; failed: number; deferred?: 'QUIET_HOURS' };

/** Atomically takes the campaign (DRAFT/SCHEDULED -> SENDING). Returns null when someone else has it or it is not sendable. */
const claim = async (id: string): Promise<boolean> =>
  (await prisma.$executeRaw`UPDATE "Campaign" SET "status" = 'SENDING' WHERE "id" = ${id} AND "status" IN ('DRAFT', 'SCHEDULED')`) === 1;

export const sendCampaign = async (id: string, now: Date = new Date()): Promise<SendOutcome> => {
  const reg = await getRegistry();
  if (!reg.isEnabled('marketing.campaigns')) throw new AppError(409, 'MODULE_DISABLED', 'Switch on the module "marketing.campaigns" first.');
  const campaign = await prisma.campaign.findUnique({ where: { id } });
  if (!campaign) throw new AppError(404, 'NOT_FOUND', 'Unknown campaign.');
  if (!campaign.title || !campaign.body) throw new AppError(400, 'BAD_REQUEST', 'A campaign needs a title and a message before it can be sent.', 'title');
  if (campaign.channel !== 'PUSH') throw new AppError(409, 'CHANNEL_NOT_AVAILABLE', 'Only the PUSH channel can be sent for now.', 'channel');
  const cfg = await loadCfg();
  if (inWindow(now, cfg.quiet)) return { campaignId: id, recipients: 0, sent: 0, skipped: 0, failed: 0, deferred: 'QUIET_HOURS' };
  const provider = getPushProvider();
  if (!provider.enabled) throw new AppError(503, 'PUSH_NOT_CONFIGURED', 'Push notifications are not configured on this server.');
  if (!(await claim(id))) throw new AppError(409, 'CAMPAIGN_NOT_SENDABLE', 'This campaign is already sending, was sent, or was cancelled.');

  const out: SendOutcome = { campaignId: id, recipients: 0, sent: 0, skipped: 0, failed: 0 };
  try {
    const ids = await resolveSegment((campaign.segment ?? {}) as Segment, now);
    out.recipients = ids.length;
    const since = new Date(now.getTime() - 24 * 3_600_000);
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const recent = await prisma.campaignDelivery.groupBy({ by: ['userId'], where: { userId: { in: chunk }, status: 'SENT', sentAt: { gte: since } }, _count: { _all: true } });
      const sentToday = new Map(recent.map((r) => [r.userId, r._count._all]));
      for (let j = 0; j < chunk.length; j += CONCURRENCY) {
        await Promise.all(chunk.slice(j, j + CONCURRENCY).map(async (userId) => {
          const skip = async (reason: string) => { out.skipped++; await prisma.campaignDelivery.createMany({ data: [{ campaignId: id, userId, status: 'SKIPPED', reason }], skipDuplicates: true }); };
          if ((sentToday.get(userId) ?? 0) >= cfg.dailyCap) return skip('DAILY_CAP');
          const tokens = await activeTokensFor(userId, 'CUSTOMER');
          if (tokens.length === 0) return skip('NO_DEVICE');
          const claimed = await prisma.campaignDelivery.createMany({ data: [{ campaignId: id, userId, status: 'SENT' }], skipDuplicates: true });
          if (claimed.count === 0) return; // already handled by an earlier attempt of this campaign
          const results = await Promise.all(tokens.map(async ({ token }) => {
            const message: PushMessage = {
              token, title: campaign.title!, body: campaign.body!, channelId: 'marketing', priority: 'normal', ttlSeconds: 6 * 3600, collapseKey: `campaign:${id}`,
              data: { event: 'MARKETING', orderId: '', v: '1', campaignId: id },
            };
            try { await withTimeout(Promise.resolve().then(() => provider.send(message)), SEND_TIMEOUT_MS); return true; }
            catch (err) { const k = classifyPushError(err); if (k.deadToken) await disableToken(token, k.code).catch(() => undefined); return false; }
          }));
          if (results.some(Boolean)) out.sent++;
          else { out.failed++; await prisma.campaignDelivery.updateMany({ where: { campaignId: id, userId }, data: { status: 'FAILED', reason: 'PROVIDER' } }); }
        }));
      }
    }
    await prisma.campaign.update({ where: { id }, data: { status: 'SENT', sentCount: out.sent } });
  } catch (err) {
    console.error('campaign send failed:', errSummary(err));
    // Nothing is lost: the unique delivery rows stop a retry from sending twice to the same customer.
    await prisma.campaign.update({ where: { id }, data: { status: 'SCHEDULED', sentCount: out.sent } }).catch(() => undefined);
    throw new AppError(500, 'CAMPAIGN_SEND_FAILED', 'The campaign could not be sent completely. It stays scheduled and will not send twice to anyone.');
  }
  return out;
};

/** Called by the maintenance tick: sends the scheduled campaigns that are due (and not in quiet hours). Never throws. */
export const runCampaignMaintenance = async (now: Date = new Date()): Promise<number> => {
  try {
    if (!(await getRegistry()).isEnabled('marketing.campaigns')) return 0;
    // A server that died mid-send leaves SENDING behind: put it back, the delivery rows guarantee nobody gets it twice.
    await prisma.$executeRaw`UPDATE "Campaign" SET "status" = 'SCHEDULED' WHERE "status" = 'SENDING' AND "scheduledAt" IS NOT NULL AND "scheduledAt" < ${new Date(now.getTime() - 30 * 60_000)}`;
    const due = await prisma.campaign.findMany({ where: { status: 'SCHEDULED', scheduledAt: { lte: now } }, select: { id: true }, orderBy: { scheduledAt: 'asc' }, take: 3 });
    let n = 0;
    for (const c of due) {
      try { const r = await sendCampaign(c.id, now); if (!r.deferred) n++; } catch (err) { console.error('scheduled campaign failed:', (err as Error)?.message ?? 'error'); }
    }
    return n;
  } catch (err) {
    console.error('campaign maintenance failed:', errSummary(err));
    return 0;
  }
};

export const startCampaignMaintenance = () => {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runCampaignMaintenance().finally(() => { running = false; });
  }, 60_000);
  timer.unref();
  return timer;
};

/** The customer app calls this when a campaign notification is opened. Counts once per customer. */
export const markCampaignOpened = async (campaignId: string, userId: string): Promise<boolean> => {
  const n = await prisma.campaignDelivery.updateMany({ where: { campaignId, userId, status: 'SENT', openedAt: null }, data: { openedAt: new Date() } });
  if (n.count > 0) await prisma.campaign.update({ where: { id: campaignId }, data: { openedCount: { increment: 1 } } });
  return n.count > 0;
};

/** Conversion = recipients who placed an order within 72 hours after the push. Computed on read, so it can never drift. */
export const campaignStats = async (id: string) => {
  const c = await prisma.campaign.findUnique({ where: { id } });
  if (!c) throw new AppError(404, 'NOT_FOUND', 'Unknown campaign.');
  const [byStatus, conv] = await Promise.all([
    prisma.campaignDelivery.groupBy({ by: ['status'], where: { campaignId: id }, _count: { _all: true } }),
    prisma.$queryRaw<{ n: number }[]>`
      SELECT COUNT(DISTINCT d."userId")::int AS n FROM "CampaignDelivery" d
      JOIN "Order" o ON o."customerId" = d."userId" AND o."createdAt" >= d."sentAt" AND o."createdAt" < d."sentAt" + interval '72 hours' AND o."status" <> 'CANCELLED'
      WHERE d."campaignId" = ${id} AND d."status" = 'SENT'`,
  ]);
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const sent = count('SENT');
  const converted = conv[0]?.n ?? 0;
  return { campaignId: id, status: c.status, sent, failed: count('FAILED'), skipped: count('SKIPPED'), opened: c.openedCount, converted, conversionRate: sent === 0 ? 0 : Math.round((converted / sent) * 1000) / 10 };
};
