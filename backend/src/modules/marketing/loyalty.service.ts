/**
 * Kraveo Coins ledger (KRAVEO_SPEC_MODULES.md 7.12, 15.4): the balance is the SUM of an append-only ledger, never a loose counter.
 * One earning per (user, order, reason) even if the delivery webhook is replayed. `User.kraveoCoins` is kept as the legacy mirror
 * until the cut-over, updated in the same transaction. Expiry and redeem are explicit ledger rows.
 */
import { Prisma } from '@prisma/client';
import { AppError } from '../../utils/appError';

export const balanceOf = async (tx: Prisma.TransactionClient, userId: string): Promise<number> => {
  const a = await tx.loyaltyTransaction.aggregate({ where: { userId }, _sum: { amount: true } });
  return a._sum.amount ?? 0;
};

export type LedgerReason = 'OPENING' | 'EARNED_ORDER' | 'REDEEMED_COUPON' | 'EXPIRED' | 'ADMIN' | 'REFERRAL';

/** Appends one ledger row under a lock on the user. Idempotent when `orderRef` is given. `maxBalance` caps what can be earned. */
export const addLedgerEntry = async (
  tx: Prisma.TransactionClient,
  e: { userId: string; amount: number; reason: LedgerReason; orderRef?: string | null; promotionId?: string | null; maxBalance?: number },
): Promise<{ applied: number; balance: number; duplicate: boolean }> => {
  if (!Number.isInteger(e.amount) || e.amount === 0 || Math.abs(e.amount) > 1_000_000) throw new AppError(500, 'BAD_LEDGER_AMOUNT', 'Invalid coin amount.');
  const locked = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE "id" = ${e.userId} FOR UPDATE`;
  if (locked.length === 0) throw new AppError(404, 'NOT_FOUND', 'Unknown user.');
  if (e.orderRef) {
    const dup = await tx.loyaltyTransaction.findFirst({ where: { userId: e.userId, orderRef: e.orderRef, reason: e.reason } });
    if (dup) return { applied: 0, balance: await balanceOf(tx, e.userId), duplicate: true };
  }
  const before = await balanceOf(tx, e.userId);
  let amount = e.amount;
  if (amount > 0 && e.maxBalance !== undefined) amount = Math.max(0, Math.min(amount, e.maxBalance - before));
  if (amount < 0 && before + amount < 0) throw new AppError(409, 'INSUFFICIENT_COINS', 'Not enough Kraveo Coins.');
  if (amount === 0) return { applied: 0, balance: before, duplicate: false };
  const after = before + amount;
  await tx.loyaltyTransaction.create({ data: { userId: e.userId, amount, reason: e.reason, orderRef: e.orderRef ?? null, promotionId: e.promotionId ?? null, balanceAfter: after } });
  await tx.user.update({ where: { id: e.userId }, data: { kraveoCoins: after } });
  return { applied: amount, balance: after, duplicate: false };
};
