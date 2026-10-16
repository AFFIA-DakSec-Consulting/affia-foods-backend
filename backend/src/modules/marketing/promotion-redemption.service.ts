/**
 * Spending a promotion for real (KRAVEO_SPEC_MODULES.md 15.6): budget, total uses and per-user uses are checked and consumed ATOMICALLY
 * inside the caller's order transaction. Zero rows affected = the promotion is refused. Used by the module engine once it is
 * authoritative; during shadow mode nothing calls it (the legacy code still decides). Idempotent per (promotion, order).
 */
import { Prisma } from '@prisma/client';
import { AppError } from '../../utils/appError';

export type RedeemInput = { promotionId: string; userId: string; orderRef: string; discountAmount: number; platformShare: number; merchantShare: number };

export const redeemPromotion = async (tx: Prisma.TransactionClient, r: RedeemInput): Promise<{ created: boolean }> => {
  if (![r.discountAmount, r.platformShare, r.merchantShare].every((n) => Number.isInteger(n) && n >= 0) || r.platformShare + r.merchantShare !== r.discountAmount) {
    throw new AppError(500, 'BAD_REDEMPTION', 'Redemption amounts do not add up.');
  }
  const again = await tx.promotionRedemption.findUnique({ where: { promotionId_orderRef: { promotionId: r.promotionId, orderRef: r.orderRef } } });
  if (again) return { created: false };
  // One conditional UPDATE both checks and consumes the budget and the total-use limit; the row lock serialises concurrent checkouts.
  const n = await tx.$executeRaw`
    UPDATE "Promotion" SET "budgetSpent" = "budgetSpent" + ${r.platformShare}
    WHERE "id" = ${r.promotionId} AND "isActive" = TRUE
      AND ("budgetTotal" IS NULL OR "budgetSpent" + ${r.platformShare} <= "budgetTotal")
      AND ("maxUsesTotal" IS NULL OR (SELECT COUNT(*) FROM "PromotionRedemption" WHERE "promotionId" = ${r.promotionId}) < "maxUsesTotal")`;
  if (n === 0) throw new AppError(409, 'PROMOTION_EXHAUSTED', 'This promotion is no longer available.');
  const promo = await tx.promotion.findUnique({ where: { id: r.promotionId }, select: { maxUsesPerUser: true } });
  if (promo?.maxUsesPerUser != null) {
    const used = await tx.promotionRedemption.count({ where: { promotionId: r.promotionId, userId: r.userId } });
    if (used >= promo.maxUsesPerUser) throw new AppError(409, 'PROMOTION_ALREADY_USED', 'You have already used this promotion.');
  }
  await tx.promotionRedemption.create({ data: r });
  return { created: true };
};

/** Takes one free delivery from an active subscription, atomically (quota null = unlimited). false = quota used up or not active. */
export const consumeSubscriptionDelivery = async (tx: Prisma.TransactionClient, subscriptionId: string, now: Date): Promise<boolean> => {
  const n = await tx.$executeRaw`
    UPDATE "Subscription" s SET "deliveriesUsed" = s."deliveriesUsed" + 1
    FROM "SubscriptionPlan" p
    WHERE s."id" = ${subscriptionId} AND p."id" = s."planId" AND s."status" = 'ACTIVE' AND s."startsAt" <= ${now} AND s."endsAt" >= ${now}
      AND (p."freeDeliveriesQuota" IS NULL OR s."deliveriesUsed" < p."freeDeliveriesQuota")`;
  return n === 1;
};
