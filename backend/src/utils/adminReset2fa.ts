/**
 * Recovery for a back-office account that lost its phone AND its backup codes, when no other super admin can reset it from the dashboard.
 * Needs access to the server. It clears the two-step sign-in of ONE account, closes its sessions and writes the audit log.
 *
 *   docker compose exec backend node dist/utils/adminReset2fa.js owner
 *   docker compose exec backend node dist/utils/adminReset2fa.js "77 123 45 67"
 *
 * `owner` = the account that signs in with the general ADMIN_PASSCODE. A phone number = a team member.
 */
import { prisma } from '../db';
import { canonicalPhone } from './phone';

export const findAccountToReset = async (target: string): Promise<{ id: string; name: string } | null> => {
  if (target === 'owner') {
    return prisma.user.findFirst({ where: { role: 'ADMIN', deletedAt: null, adminPasscodeHash: null, adminRole: null, adminDisabledAt: null }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: { id: true, name: true } });
  }
  const phone = canonicalPhone(target);
  return phone ? prisma.user.findFirst({ where: { role: 'ADMIN', deletedAt: null, phone }, select: { id: true, name: true } }) : null;
};

export const resetTwoFactor = async (userId: string): Promise<void> => {
  await prisma.user.update({ where: { id: userId }, data: { adminTotpSecret: null, adminTotpEnabledAt: null, adminTotpLastStep: null, adminBackupCodes: [], tokenVersion: { increment: 1 } } });
  await prisma.adminSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  await prisma.adminAuditLog.create({ data: { action: 'TWO_FACTOR_RESET', targetType: 'ADMIN_USER', targetId: userId, summary: 'by the server command (admin:reset-2fa)' } });
};

const main = async () => {
  const target = (process.argv[2] ?? '').trim();
  if (!target) {
    console.error('Usage: node dist/utils/adminReset2fa.js <owner | phone number>');
    process.exitCode = 1;
    return;
  }
  const account = await findAccountToReset(target);
  if (!account) {
    console.error(`No back-office account found for "${target}".`);
    process.exitCode = 1;
    return;
  }
  await resetTwoFactor(account.id);
  console.log(`Two-step sign-in cleared for ${account.name} (${account.id}). Their sessions are closed; they can sign in with their code and turn it on again.`);
};

if (require.main === module) {
  main().catch((err) => { console.error('Reset failed:', (err as Error).message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
