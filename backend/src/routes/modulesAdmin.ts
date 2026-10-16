import { Router, Response } from 'express';
import { prisma } from '../db';
import { AuthenticatedRequest, requireAuth, requireRole } from '../middleware/auth';
import { fail, validParams } from '../utils/http';
import { getSettings } from '../services/settings';
import { listAudit, listModules, listSettings, toggleModule, updateSetting } from '../core/modules/module-admin.service';
import { createBonus, createCampaign, createLoyaltyRule, createPlan, createPromotion, deleteBonus, deleteCampaign, deleteLoyaltyRule, deletePlan, deletePromotion, listZones, patchBonus, patchCampaign, patchLoyaltyRule, patchPlan, patchPromotion, promotionStats, promotionView, replaceZones } from '../core/modules/admin-catalogs.service';
import { campaignStats, markCampaignOpened, sendCampaign } from '../modules/marketing/campaigns/campaign-sender';
import { bad, bool, int, isObj, num, onlyKeys, pageOf, strOpt } from '../core/modules/validate-kit';
import { cancelReferral, listReferrals, referralStats } from '../modules/marketing/referral-admin.service';
import { computePricing } from '../shared/pricing/pricing.pipeline';

/**
 * Back-office API of the modular platform (KRAVEO_SPEC_MODULES.md 10). ADMIN only, every write validated, transactional and written to
 * module_audit_log with the acting admin taken from the JWT (never from the body). Mounted under /api; rate limits in middleware/rateLimit.ts.
 */
export const modulesAdminRouter = Router();
const adminOnly = [requireAuth, requireRole('ADMIN')] as const;
const actor = (req: AuthenticatedRequest) => req.user!.id;
const MODULE_CODE = /^[a-z_]{1,32}(\.[a-z_]{1,32})?$/;
const codeParam = (req: AuthenticatedRequest): string => {
  const c = req.params.code;
  if (typeof c !== 'string' || !MODULE_CODE.test(c)) throw bad('code', 'Invalid module code.');
  return c;
};
const wrap = (what: string, fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) => async (req: AuthenticatedRequest, res: Response) => {
  try { await fn(req, res); } catch (err) { fail(res, err, what); }
};

// ---- modules and settings
modulesAdminRouter.get('/admin/modules', ...adminOnly, wrap('list modules', async (_q, res) => res.json({ success: true, data: await listModules() })));

modulesAdminRouter.get('/admin/modules/audit-log', ...adminOnly, wrap('module audit', async (req, res) => {
  const mc = typeof req.query.module === 'string' ? req.query.module : undefined;
  if (mc !== undefined && !MODULE_CODE.test(mc)) throw bad('module', 'Invalid module code.');
  res.json({ success: true, ...(await listAudit({ moduleCode: mc, ...pageOf(req.query) })) });
}));

modulesAdminRouter.patch('/admin/modules/:code/toggle', ...adminOnly, wrap('toggle module', async (req, res) => {
  const body = isObj(req.body) ? req.body : {};
  onlyKeys(body, ['enabled', 'cascade']);
  const enabled = bool(body, 'enabled');
  const cascade = body.cascade === undefined ? false : bool(body, 'cascade');
  const out = await toggleModule(codeParam(req), enabled, actor(req), cascade);
  res.json({ success: true, changed: out.changed, data: await listModules() });
}));

modulesAdminRouter.get('/admin/modules/:code/settings', ...adminOnly, wrap('list settings', async (req, res) => res.json({ success: true, data: await listSettings(codeParam(req)) })));

modulesAdminRouter.patch('/admin/modules/:code/settings/:key', ...adminOnly, wrap('update setting', async (req, res) => {
  const key = req.params.key;
  if (!/^[a-z_]{1,80}$/.test(key)) throw bad('key', 'Invalid setting key.');
  const body = isObj(req.body) ? req.body : {};
  onlyKeys(body, ['value']);
  if (!('value' in body)) throw bad('value', 'Send {"value": ...}.');
  const out = await updateSetting(codeParam(req), key, body.value, actor(req));
  res.json({ success: true, changed: out.changed, data: { key, value: out.value, previous: out.before } });
}));

// ---- delivery zones and courier bonuses
modulesAdminRouter.get('/admin/delivery-zones', ...adminOnly, wrap('list zones', async (req, res) => {
  const city = typeof req.query.city === 'string' ? req.query.city : undefined;
  res.json({ success: true, data: await listZones(city) });
}));
modulesAdminRouter.put('/admin/delivery-zones', ...adminOnly, wrap('replace zones', async (req, res) => res.json({ success: true, data: await replaceZones(req.body, actor(req)) })));

modulesAdminRouter.get('/admin/courier-bonuses', ...adminOnly, wrap('list bonuses', async (_q, res) => res.json({ success: true, data: await prisma.courierBonus.findMany({ orderBy: { name: 'asc' } }) })));
modulesAdminRouter.post('/admin/courier-bonuses', ...adminOnly, wrap('create bonus', async (req, res) => res.status(201).json({ success: true, data: await createBonus(req.body, actor(req)) })));
modulesAdminRouter.patch('/admin/courier-bonuses/:id', ...adminOnly, validParams('id'), wrap('update bonus', async (req, res) => res.json({ success: true, data: await patchBonus(req.params.id, req.body, actor(req)) })));
modulesAdminRouter.delete('/admin/courier-bonuses/:id', ...adminOnly, validParams('id'), wrap('delete bonus', async (req, res) => { await deleteBonus(req.params.id, actor(req)); res.json({ success: true }); }));

// ---- promotions
modulesAdminRouter.get('/admin/promotions', ...adminOnly, wrap('list promotions', async (req, res) => {
  const { page, pageSize } = pageOf(req.query);
  const [total, rows] = await Promise.all([prisma.promotion.count(), prisma.promotion.findMany({ orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }], skip: (page - 1) * pageSize, take: pageSize })]);
  res.json({ success: true, total, page, pageSize, data: rows.map(promotionView) });
}));
modulesAdminRouter.post('/admin/promotions', ...adminOnly, wrap('create promotion', async (req, res) => res.status(201).json({ success: true, data: promotionView(await createPromotion(req.body, actor(req))) })));
modulesAdminRouter.patch('/admin/promotions/:id', ...adminOnly, validParams('id'), wrap('update promotion', async (req, res) => res.json({ success: true, data: promotionView(await patchPromotion(req.params.id, req.body, actor(req))) })));
modulesAdminRouter.get('/admin/promotions/:id', ...adminOnly, validParams('id'), wrap('get promotion', async (req, res) => {
  const p = await prisma.promotion.findUnique({ where: { id: req.params.id } });
  if (!p) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Unknown promotion.' });
  res.json({ success: true, data: promotionView(p) });
}));
modulesAdminRouter.delete('/admin/promotions/:id', ...adminOnly, validParams('id'), wrap('delete promotion', async (req, res) => { await deletePromotion(req.params.id, actor(req)); res.json({ success: true }); }));
modulesAdminRouter.get('/admin/promotions/:id/stats', ...adminOnly, validParams('id'), wrap('promotion stats', async (req, res) => res.json({ success: true, data: await promotionStats(req.params.id) })));

// ---- subscription plans, campaigns, loyalty rules
modulesAdminRouter.get('/admin/subscription-plans', ...adminOnly, wrap('list plans', async (_q, res) => res.json({ success: true, data: await prisma.subscriptionPlan.findMany({ orderBy: { price: 'asc' } }) })));
modulesAdminRouter.post('/admin/subscription-plans', ...adminOnly, wrap('create plan', async (req, res) => res.status(201).json({ success: true, data: await createPlan(req.body, actor(req)) })));
modulesAdminRouter.get('/admin/subscription-plans/:id', ...adminOnly, validParams('id'), wrap('get plan', async (req, res) => {
  const p = await prisma.subscriptionPlan.findUnique({ where: { id: req.params.id } });
  if (!p) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Unknown plan.' });
  res.json({ success: true, data: p });
}));
modulesAdminRouter.patch('/admin/subscription-plans/:id', ...adminOnly, validParams('id'), wrap('update plan', async (req, res) => res.json({ success: true, data: await patchPlan(req.params.id, req.body, actor(req)) })));
modulesAdminRouter.delete('/admin/subscription-plans/:id', ...adminOnly, validParams('id'), wrap('delete plan', async (req, res) => { await deletePlan(req.params.id, actor(req)); res.json({ success: true }); }));

modulesAdminRouter.get('/admin/campaigns', ...adminOnly, wrap('list campaigns', async (req, res) => {
  const { page, pageSize } = pageOf(req.query);
  const [total, data] = await Promise.all([prisma.campaign.count(), prisma.campaign.findMany({ orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize })]);
  res.json({ success: true, total, page, pageSize, data });
}));
modulesAdminRouter.post('/admin/campaigns', ...adminOnly, wrap('create campaign', async (req, res) => res.status(201).json({ success: true, data: await createCampaign(req.body, actor(req)) })));
modulesAdminRouter.get('/admin/campaigns/:id', ...adminOnly, validParams('id'), wrap('get campaign', async (req, res) => {
  const c = await prisma.campaign.findUnique({ where: { id: req.params.id } });
  if (!c) return res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Unknown campaign.' });
  res.json({ success: true, data: c });
}));
modulesAdminRouter.patch('/admin/campaigns/:id', ...adminOnly, validParams('id'), wrap('update campaign', async (req, res) => res.json({ success: true, data: await patchCampaign(req.params.id, req.body, actor(req)) })));
modulesAdminRouter.delete('/admin/campaigns/:id', ...adminOnly, validParams('id'), wrap('delete campaign', async (req, res) => { await deleteCampaign(req.params.id, actor(req)); res.json({ success: true }); }));
modulesAdminRouter.post('/admin/campaigns/:id/send', ...adminOnly, validParams('id'), wrap('send campaign', async (req, res) => {
  const out = await sendCampaign(req.params.id);
  await prisma.moduleAuditLog.create({ data: { moduleCode: 'marketing.campaigns', action: 'SEND_CAMPAIGN', newValue: { ...out }, changedBy: actor(req) } });
  res.json({ success: true, data: out });
}));
modulesAdminRouter.get('/admin/campaigns/:id/stats', ...adminOnly, validParams('id'), wrap('campaign stats', async (req, res) => res.json({ success: true, data: await campaignStats(req.params.id) })));

// The customer app reports that a campaign notification was opened (counted once per customer).
modulesAdminRouter.post('/campaigns/:id/opened', requireAuth, requireRole('CLIENT'), validParams('id'), wrap('campaign opened', async (req, res) => {
  await markCampaignOpened(req.params.id, req.user!.id);
  res.json({ success: true });
}));

modulesAdminRouter.get('/admin/loyalty-rules', ...adminOnly, wrap('list loyalty rules', async (_q, res) => res.json({ success: true, data: await prisma.loyaltyRule.findMany({ orderBy: { name: 'asc' } }) })));
modulesAdminRouter.post('/admin/loyalty-rules', ...adminOnly, wrap('create loyalty rule', async (req, res) => res.status(201).json({ success: true, data: await createLoyaltyRule(req.body, actor(req)) })));
modulesAdminRouter.patch('/admin/loyalty-rules/:id', ...adminOnly, validParams('id'), wrap('update loyalty rule', async (req, res) => res.json({ success: true, data: await patchLoyaltyRule(req.params.id, req.body, actor(req)) })));
modulesAdminRouter.delete('/admin/loyalty-rules/:id', ...adminOnly, validParams('id'), wrap('delete loyalty rule', async (req, res) => { await deleteLoyaltyRule(req.params.id, actor(req)); res.json({ success: true }); }));

// ---- referrals (sponsorship): read-only list and stats, plus cancelling a suspicious one. Rewards are paid by the loyalty rules, not from here.
modulesAdminRouter.get('/admin/referrals', ...adminOnly, wrap('list referrals', async (req, res) => {
  res.json({ success: true, ...(await listReferrals({ status: typeof req.query.status === 'string' ? req.query.status : undefined, ...pageOf(req.query) })) });
}));
modulesAdminRouter.get('/admin/referrals/stats', ...adminOnly, wrap('referral stats', async (_q, res) => res.json({ success: true, data: await referralStats() })));
modulesAdminRouter.post('/admin/referrals/:id/cancel', ...adminOnly, validParams('id'), wrap('cancel referral', async (req, res) => res.json({ success: true, data: await cancelReferral(req.params.id, actor(req)) })));

// ---- simulator: price a hypothetical order step by step, optionally with a module forced on/off BEFORE activating it. Writes nothing.
modulesAdminRouter.post('/admin/pricing/simulate', ...adminOnly, wrap('simulate pricing', async (req, res) => {
  const b = isObj(req.body) ? req.body : {};
  onlyKeys(b, ['distance_km', 'cart_amount', 'restaurants_count', 'user_id', 'promo_code', 'overrides', 'at', 'commission_amount']);
  const distanceKm = num(b, 'distance_km', 0, 500);
  const cartAmount = int(b, 'cart_amount', 0, 10_000_000);
  const restaurants = b.restaurants_count === undefined ? 1 : int(b, 'restaurants_count', 1, 10);
  const userId = strOpt(b, 'user_id', 64);
  if (userId && !/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw bad('user_id', 'Invalid user id.');
  const promo = strOpt(b, 'promo_code', 40)?.toUpperCase() ?? null;
  let overrides: Record<string, boolean> | undefined;
  if (b.overrides !== undefined) {
    if (!isObj(b.overrides)) throw bad('overrides', 'overrides must be an object of module code -> true/false.');
    const known = new Set((await prisma.platformModule.findMany({ select: { code: true } })).map((m) => m.code));
    overrides = {};
    for (const [k, v] of Object.entries(b.overrides)) {
      if (!known.has(k)) throw bad('overrides', `Unknown module '${k.slice(0, 40)}'.`);
      if (typeof v !== 'boolean') throw bad('overrides', 'Each override is true or false.');
      overrides[k] = v;
    }
  }
  const at = b.at === undefined ? new Date() : new Date(String(b.at));
  if (!Number.isFinite(at.getTime())) throw bad('at', 'at must be an ISO 8601 date.');
  const r = await computePricing({ context: { cartAmount, distanceKm, restaurantsCount: restaurants, maxDetourKm: 0, now: at, city: 'default' }, vendorIds: [], userId, promoCode: promo, overrides, mode: 'simulation' });
  // Simplified platform margin: commission + what the customer pays for delivery + the restaurants' contribution - the courier - the discounts given on the food.
  const commission = b.commission_amount !== undefined ? int(b, 'commission_amount', 0, 10_000_000) : await defaultCommission(cartAmount);
  const margin = commission + r.deliveryFeeCustomer + r.merchantContribution - r.courierPayout - r.cartDiscount;
  res.json({
    success: true,
    data: {
      step1_delivery: r.delivery, step2_courier: r.courier, step3_marketing: r.marketing,
      customerPays: { food: cartAmount - r.cartDiscount, delivery: r.deliveryFeeCustomer, total: r.customerTotal },
      courierPayout: r.courierPayout, deliverySubsidy: r.deliverySubsidy, merchantContribution: r.merchantContribution,
      margin: { commission, value: margin, formula: 'commission + delivery paid by customer + restaurant contribution - courier payout - discounts on food', deficit: margin < 0 },
      snapshot: r.snapshot,
    },
  });
}));

const defaultCommission = async (cart: number): Promise<number> => {
  const c = (await getSettings()).commission;
  return c.type === 'PERCENT' ? Math.round((cart * c.value) / (100 + c.value)) : 0;
};
