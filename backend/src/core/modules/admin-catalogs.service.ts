/**
 * Back-office CRUD of the module data: delivery zones, courier bonuses, promotions, subscription plans, campaigns, loyalty rules
 * (KRAVEO_SPEC_MODULES.md 10). Strict validation, one transaction per write, audit with the acting admin, never a hard delete.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../db';
import { AppError } from '../../utils/appError';
import { isHHMM } from '../../shared/pricing/clock';
import { audit } from './module-admin.service';
import { getRegistry, invalidateModuleCache } from './module-registry.service';
import { bad, bool, dateOpt, idList, int, intOpt, isObj, num, numOpt, oneOf, onlyKeys, str, strOpt } from './validate-kit';

/** The editable fields of a stored row, so a patch is validated as a whole without tripping on `id` or timestamps. */
const pick = (row: object, keys: readonly string[]): Record<string, unknown> => Object.fromEntries(keys.map((k) => [k, (row as Record<string, unknown>)[k]]));

const TX = { maxWait: 10_000, timeout: 20_000 } as const;
const MAX_FEE = 50_000;

// --------------------------------------------------------------------------------------------------------------------- zones
// Letters of any alphabet (the pilot city is "Thiès"), digits, space, - _ '
const CITY_RE = /^[\p{L}\p{N} _'’-]{1,40}$/u;

export const validateZones = (raw: unknown) => {
  if (!isObj(raw)) throw bad('body', 'Send {"city":"default","zones":[...]}.');
  onlyKeys(raw, ['city', 'zones']);
  const city = raw.city === undefined ? 'default' : raw.city;
  if (typeof city !== 'string' || !CITY_RE.test(city)) throw bad('city', 'city must be a short name (letters, digits, space, - _ \').');
  const list = raw.zones;
  if (!Array.isArray(list) || list.length < 1 || list.length > 12) throw bad('zones', 'Send 1 to 12 zones.');
  const zones = list.map((z, i) => {
    if (!isObj(z)) throw bad(`zones[${i}]`, 'Each zone is an object.');
    onlyKeys(z, ['label', 'minKm', 'maxKm', 'fee', 'courierPayout']);
    return { label: str(z, 'label', 1, 40), minKm: num(z, 'minKm', 0, 500), maxKm: numOpt(z, 'maxKm', 0, 500), fee: intOpt(z, 'fee', 0, MAX_FEE), courierPayout: intOpt(z, 'courierPayout', 0, MAX_FEE), sortOrder: i + 1 };
  });
  zones.forEach((z, i) => {
    if (i === 0 && z.minKm !== 0) throw bad('zones[0].minKm', 'The first zone must start at 0 km.');
    if (i > 0 && z.minKm !== zones[i - 1].maxKm) throw bad(`zones[${i}].minKm`, 'Zones must be contiguous: each one starts where the previous one ends.');
    if (i < zones.length - 1 && (z.maxKm === null || z.maxKm <= z.minKm)) throw bad(`zones[${i}].maxKm`, 'Only the last zone has no upper limit; every other zone must end after it starts.');
    if (i === zones.length - 1 && z.maxKm !== null && z.maxKm <= z.minKm) throw bad(`zones[${i}].maxKm`, 'The zone must end after it starts (or have no limit).');
  });
  return { city, zones };
};

export const listZones = async (city?: string) => (await prisma.deliveryZone.findMany({ where: city ? { city } : {}, orderBy: [{ city: 'asc' }, { sortOrder: 'asc' }] }));

export const replaceZones = async (raw: unknown, actorId: string) => {
  const { city, zones } = validateZones(raw);
  const out = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'zones:' + city}))`;
    const before = await tx.deliveryZone.findMany({ where: { city }, orderBy: { sortOrder: 'asc' } });
    await tx.deliveryZone.deleteMany({ where: { city } });
    await tx.deliveryZone.createMany({ data: zones.map((z) => ({ ...z, city })) });
    await audit(tx, { moduleCode: 'delivery.zone_pricing', action: 'UPDATE_ZONE', oldValue: before.map(({ id: _i, ...r }) => r), newValue: zones, changedBy: actorId });
    return tx.deliveryZone.findMany({ where: { city }, orderBy: { sortOrder: 'asc' } });
  }, TX);
  invalidateModuleCache();
  return out;
};

// --------------------------------------------------------------------------------------------------------------------- courier bonuses
const BONUS_TRIGGERS = ['RAIN', 'NIGHT', 'RUSH_HOUR', 'ZONE', 'MANUAL'] as const;
const readBonus = async (raw: Record<string, unknown>) => {
  onlyKeys(raw, ['name', 'description', 'triggerType', 'amount', 'conditions', 'isActive']);
  const triggerType = oneOf(raw, 'triggerType', BONUS_TRIGGERS);
  let conditions: Prisma.InputJsonValue | typeof Prisma.DbNull = Prisma.DbNull;
  if (triggerType === 'NIGHT' || triggerType === 'RUSH_HOUR') {
    const c = raw.conditions;
    if (!isObj(c) || Object.keys(c).some((k) => k !== 'from' && k !== 'to') || !isHHMM(c.from) || !isHHMM(c.to)) throw bad('conditions', 'Send {"from":"HH:MM","to":"HH:MM"}.');
    conditions = { from: c.from, to: c.to };
  } else if (triggerType === 'ZONE') {
    const c = raw.conditions;
    if (!isObj(c) || Object.keys(c).some((k) => k !== 'zoneId') || typeof c.zoneId !== 'string') throw bad('conditions', 'Send {"zoneId":"..."}.');
    if (!(await prisma.deliveryZone.findUnique({ where: { id: c.zoneId }, select: { id: true } }))) throw bad('conditions', 'Unknown zone.');
    conditions = { zoneId: c.zoneId };
  } else if (raw.conditions !== undefined && raw.conditions !== null) throw bad('conditions', 'This bonus type takes no conditions.');
  return { name: str(raw, 'name', 2, 80), description: str(raw, 'description', 2, 400), triggerType, amount: int(raw, 'amount', 0, 10_000), conditions, isActive: raw.isActive === undefined ? true : bool(raw, 'isActive') };
};
export const createBonus = async (raw: unknown, actorId: string) => {
  if (!isObj(raw)) throw bad('body', 'Send an object.');
  const data = await readBonus(raw);
  const row = await prisma.courierBonus.create({ data });
  await audit(prisma, { moduleCode: 'courier.bonuses', action: 'CREATE_BONUS', newValue: { id: row.id, name: data.name, triggerType: data.triggerType, amount: data.amount }, changedBy: actorId });
  return row;
};
export const patchBonus = async (id: string, raw: unknown, actorId: string) => {
  if (!isObj(raw)) throw bad('body', 'Send an object.');
  const cur = await prisma.courierBonus.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'Unknown bonus.');
  const data = await readBonus({ ...pick(cur, ['name', 'description', 'triggerType', 'amount', 'conditions', 'isActive']), ...raw });
  const row = await prisma.courierBonus.update({ where: { id }, data });
  await audit(prisma, { moduleCode: 'courier.bonuses', action: 'UPDATE_BONUS', oldValue: { id, amount: cur.amount, isActive: cur.isActive }, newValue: { amount: row.amount, isActive: row.isActive, fields: Object.keys(raw) }, changedBy: actorId });
  return row;
};
export const deleteBonus = async (id: string, actorId: string) => {
  const row = await prisma.courierBonus.delete({ where: { id } }).catch(() => null);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Unknown bonus.');
  await audit(prisma, { moduleCode: 'courier.bonuses', action: 'DELETE_BONUS', oldValue: { id, name: row.name }, changedBy: actorId });
};

// --------------------------------------------------------------------------------------------------------------------- promotions
export const PROMO_TYPES = ['FREE_DELIVERY', 'PERCENT_OFF_DELIVERY', 'FIXED_OFF_DELIVERY', 'PERCENT_OFF_CART', 'FIXED_OFF_CART'] as const;
const PROMO_MODULES = ['marketing.free_delivery', 'marketing.promo_codes', 'marketing.first_order'] as const;
const PROMO_EDITABLE = ['name', 'description', 'value', 'fundedBy', 'merchantSharePct', 'minCartAmount', 'maxDistanceKm', 'maxDiscountAmount', 'eligibleCities', 'eligibleMerchants', 'firstOrderOnly', 'coinsCost', 'requiresRedemption', 'maxUsesTotal', 'maxUsesPerUser', 'budgetTotal', 'startsAt', 'endsAt', 'isActive', 'priority', 'stackable'] as const;
const CODE_RE = /^[A-Z0-9_-]{3,40}$/;

type PromoInput = Omit<Prisma.PromotionUncheckedCreateInput, 'id' | 'budgetSpent' | 'createdAt' | 'updatedAt'>;

/** Reads and checks a whole promotion (create) or the merge of a stored one with a patch (update). `maxMerchantPct` comes from the module setting. */
export const readPromotion = (o: Record<string, unknown>, maxMerchantPct: number): PromoInput => {
  const type = oneOf(o, 'type', PROMO_TYPES);
  const moduleCode = oneOf(o, 'moduleCode', PROMO_MODULES);
  const percent = type === 'PERCENT_OFF_CART' || type === 'PERCENT_OFF_DELIVERY';
  let value: number | null = null;
  if (type === 'FREE_DELIVERY') {
    if (o.value !== undefined && o.value !== null) throw bad('value', 'A free delivery has no value.');
  } else if (percent) value = num(o, 'value', 0.01, 100);
  else value = int(o, 'value', 1, 100_000);
  const fundedBy = o.fundedBy === undefined ? 'PLATFORM' : oneOf(o, 'fundedBy', ['PLATFORM', 'MERCHANT', 'SPLIT'] as const);
  let merchantSharePct = 0;
  if (fundedBy !== 'PLATFORM') {
    merchantSharePct = num(o, 'merchantSharePct', 0.01, 100);
    if (merchantSharePct > maxMerchantPct) throw bad('merchantSharePct', `A restaurant cannot fund more than ${maxMerchantPct}% of a promotion.`);
  } else if (o.merchantSharePct !== undefined && o.merchantSharePct !== null && o.merchantSharePct !== 0) throw bad('merchantSharePct', 'A platform-funded promotion has no restaurant share.');
  const startsAt = dateOpt(o, 'startsAt');
  const endsAt = dateOpt(o, 'endsAt');
  if (startsAt && endsAt && endsAt <= startsAt) throw bad('endsAt', 'endsAt must be after startsAt.');
  const code = o.code === undefined || o.code === null ? null : String(o.code).trim().toUpperCase();
  if (code !== null && !CODE_RE.test(code)) throw bad('code', 'A code is 3-40 characters: letters A-Z, digits, - and _.');
  const requiresRedemption = o.requiresRedemption === undefined ? false : bool(o, 'requiresRedemption');
  const coinsCost = intOpt(o, 'coinsCost', 1, 100_000);
  if (requiresRedemption && (coinsCost === null || code === null)) throw bad('coinsCost', 'A promotion unlocked with coins needs a code and a coin cost.');
  const firstOrderOnly = o.firstOrderOnly === undefined ? false : bool(o, 'firstOrderOnly');
  const maxUsesPerUser = o.maxUsesPerUser === undefined ? 1 : intOpt(o, 'maxUsesPerUser', 1, 1000);
  const eligibleCities = idList(o, 'eligibleCities', 20);
  const eligibleMerchants = idList(o, 'eligibleMerchants', 200);
  // A promotion with no code applies by itself: it must at least be bounded by a budget or an end date, so it can never run forever for free.
  const budgetTotal = intOpt(o, 'budgetTotal', 0, 1_000_000_000);
  if (code === null && budgetTotal === null && endsAt === null && type !== 'FREE_DELIVERY' && !firstOrderOnly) throw bad('budgetTotal', 'An automatic promotion needs a budget or an end date.');
  return {
    moduleCode, name: str(o, 'name', 2, 120), description: str(o, 'description', 2, 500), code, type, value, fundedBy, merchantSharePct,
    minCartAmount: intOpt(o, 'minCartAmount', 0, 1_000_000), maxDistanceKm: numOpt(o, 'maxDistanceKm', 0, 500),
    maxDiscountAmount: intOpt(o, 'maxDiscountAmount', 0, 1_000_000), eligibleCities, eligibleMerchants, firstOrderOnly, coinsCost, requiresRedemption,
    maxUsesTotal: intOpt(o, 'maxUsesTotal', 1, 100_000_000), maxUsesPerUser, budgetTotal, startsAt, endsAt,
    isActive: o.isActive === undefined ? true : bool(o, 'isActive'), priority: o.priority === undefined ? 0 : int(o, 'priority', -1000, 1000), stackable: o.stackable === undefined ? false : bool(o, 'stackable'),
  };
};

const merchantGate = async (p: PromoInput) => {
  const reg = await getRegistry();
  if (p.fundedBy !== 'PLATFORM' && !reg.isEnabled('marketing.merchant_funded')) throw new AppError(409, 'MODULE_DISABLED', 'Switch on the module "marketing.merchant_funded" to let a restaurant fund a promotion.', 'fundedBy');
  return reg.num('marketing.merchant_funded', 'max_merchant_share_pct');
};

export const createPromotion = async (raw: unknown, actorId: string) => {
  if (!isObj(raw)) throw bad('body', 'Send an object.');
  onlyKeys(raw, ['moduleCode', 'type', 'code', ...PROMO_EDITABLE]);
  const reg = await getRegistry();
  const max = reg.num('marketing.merchant_funded', 'max_merchant_share_pct');
  const p = readPromotion(raw, max);
  await merchantGate(p);
  try {
    const row = await prisma.promotion.create({ data: p });
    await audit(prisma, { moduleCode: p.moduleCode, action: 'CREATE_PROMOTION', newValue: { id: row.id, code: row.code, type: row.type, value: row.value, name: row.name }, changedBy: actorId });
    return row;
  } catch (err: any) {
    if (err?.code === 'P2002') throw new AppError(409, 'CODE_TAKEN', 'This code already exists.', 'code');
    throw err;
  }
};

export const patchPromotion = async (id: string, raw: unknown, actorId: string) => {
  if (!isObj(raw)) throw bad('body', 'Send an object.');
  onlyKeys(raw, PROMO_EDITABLE); // type, code and moduleCode never change after creation
  const reg = await getRegistry();
  const max = reg.num('marketing.merchant_funded', 'max_merchant_share_pct');
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Prisma.PromotionGetPayload<{}>[]>`SELECT * FROM "Promotion" WHERE "id" = ${id} FOR UPDATE`;
    const cur = rows[0];
    if (!cur) throw new AppError(404, 'NOT_FOUND', 'Unknown promotion.');
    const merged = { ...cur, ...raw } as Record<string, unknown>;
    for (const k of ['startsAt', 'endsAt']) if (merged[k] instanceof Date) merged[k] = (merged[k] as Date).toISOString();
    const p = readPromotion(merged, max);
    if (p.budgetTotal != null && p.budgetTotal < cur.budgetSpent) throw bad('budgetTotal', `The budget cannot be below what is already spent (${cur.budgetSpent} FCFA).`);
    await merchantGate(p);
    const row = await tx.promotion.update({ where: { id }, data: { ...p, code: cur.code, type: cur.type, moduleCode: cur.moduleCode } });
    const diff: Record<string, [unknown, unknown]> = {};
    for (const k of PROMO_EDITABLE) if (JSON.stringify((cur as any)[k]) !== JSON.stringify((row as any)[k])) diff[k] = [(cur as any)[k], (row as any)[k]];
    await audit(tx, { moduleCode: cur.moduleCode, action: 'UPDATE_PROMOTION', oldValue: { id, code: cur.code }, newValue: diff, changedBy: actorId });
    return row;
  }, TX);
};

/** A promotion that was never used can be deleted; one with history can only be switched off (the books keep their meaning). */
export const deletePromotion = async (id: string, actorId: string) => {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Prisma.PromotionGetPayload<{}>[]>`SELECT * FROM "Promotion" WHERE "id" = ${id} FOR UPDATE`;
    const p = rows[0];
    if (!p) throw new AppError(404, 'NOT_FOUND', 'Unknown promotion.');
    const used = (await tx.promotionRedemption.count({ where: { promotionId: id } })) > 0 || p.budgetSpent > 0
      || (p.code ? (await tx.order.count({ where: { couponCode: p.code } })) > 0 : false);
    if (used) throw new AppError(409, 'PROMOTION_USED', 'This promotion has been used. Switch it off (isActive: false) instead of deleting it.');
    await tx.campaign.updateMany({ where: { promotionId: id }, data: { promotionId: null } });
    await tx.promotion.delete({ where: { id } });
    await audit(tx, { moduleCode: p.moduleCode, action: 'DELETE_PROMOTION', oldValue: { id, code: p.code, name: p.name }, changedBy: actorId });
  }, TX);
};

export const promotionView = (p: Prisma.PromotionGetPayload<{}>) => ({ ...p, startsAt: p.startsAt?.toISOString() ?? null, endsAt: p.endsAt?.toISOString() ?? null, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() });

export const promotionStats = async (id: string) => {
  const p = await prisma.promotion.findUnique({ where: { id } });
  if (!p) throw new AppError(404, 'NOT_FOUND', 'Unknown promotion.');
  const [agg, users] = await Promise.all([
    prisma.promotionRedemption.aggregate({ where: { promotionId: id }, _count: { _all: true }, _sum: { discountAmount: true, platformShare: true, merchantShare: true } }),
    prisma.promotionRedemption.groupBy({ by: ['userId'], where: { promotionId: id } }),
  ]);
  return {
    promotionId: id, uses: agg._count._all, distinctUsers: users.length, discountTotal: agg._sum.discountAmount ?? 0,
    platformCost: agg._sum.platformShare ?? 0, merchantCost: agg._sum.merchantShare ?? 0,
    budgetTotal: p.budgetTotal, budgetSpent: p.budgetSpent, budgetLeft: p.budgetTotal === null ? null : Math.max(0, p.budgetTotal - p.budgetSpent),
    note: 'Counts only redemptions recorded by the module engine (after the cut-over). During shadow mode use PricingParityLog and the orders carrying the code.',
  };
};

// --------------------------------------------------------------------------------------------------------------------- subscription plans
const PLAN_KEYS = ['name', 'description', 'price', 'durationDays', 'freeDeliveriesQuota', 'minCartAmount', 'maxDistanceKm', 'isActive'] as const;
const readPlan = (raw: Record<string, unknown>) => {
  onlyKeys(raw, PLAN_KEYS);
  return { name: str(raw, 'name', 2, 80), description: str(raw, 'description', 2, 500), price: int(raw, 'price', 0, 1_000_000), durationDays: raw.durationDays === undefined ? 30 : int(raw, 'durationDays', 1, 366), freeDeliveriesQuota: intOpt(raw, 'freeDeliveriesQuota', 1, 10_000), minCartAmount: intOpt(raw, 'minCartAmount', 0, 1_000_000), maxDistanceKm: numOpt(raw, 'maxDistanceKm', 0, 500), isActive: raw.isActive === undefined ? true : bool(raw, 'isActive') };
};
export const createPlan = async (raw: unknown, actorId: string) => {
  if (!isObj(raw)) throw bad('body', 'Send an object.');
  const data = readPlan(raw);
  const row = await prisma.subscriptionPlan.create({ data });
  await audit(prisma, { moduleCode: 'marketing.subscription', action: 'CREATE_PLAN', newValue: { id: row.id, ...data }, changedBy: actorId });
  return row;
};
/** Price, length and quota of a plan apply to FUTURE subscriptions only: existing ones keep their own dates and counters. */
export const patchPlan = async (id: string, raw: unknown, actorId: string) => {
  if (!isObj(raw)) throw bad('body', 'Send an object.');
  const cur = await prisma.subscriptionPlan.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'Unknown plan.');
  const data = readPlan({ ...pick(cur, PLAN_KEYS), ...raw });
  const row = await prisma.subscriptionPlan.update({ where: { id }, data });
  const diff: Record<string, [unknown, unknown]> = {};
  for (const k of PLAN_KEYS) if ((cur as any)[k] !== (row as any)[k]) diff[k] = [(cur as any)[k], (row as any)[k]];
  await audit(prisma, { moduleCode: 'marketing.subscription', action: 'UPDATE_PLAN', oldValue: { id }, newValue: diff, changedBy: actorId });
  return row;
};
export const deletePlan = async (id: string, actorId: string) => {
  if ((await prisma.subscription.count({ where: { planId: id } })) > 0) throw new AppError(409, 'PLAN_HAS_SUBSCRIBERS', 'This plan has subscribers. Switch it off (isActive: false) instead of deleting it.');
  const row = await prisma.subscriptionPlan.delete({ where: { id } }).catch(() => null);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Unknown plan.');
  await audit(prisma, { moduleCode: 'marketing.subscription', action: 'DELETE_PLAN', oldValue: { id, name: row.name }, changedBy: actorId });
};

// --------------------------------------------------------------------------------------------------------------------- campaigns
const SEGMENT_KEYS = ['last_order_days_gt', 'min_orders', 'max_orders', 'city'] as const;
export const readSegment = (raw: unknown) => {
  if (!isObj(raw)) throw bad('segment', 'segment must be an object.');
  onlyKeys(raw, SEGMENT_KEYS);
  const seg: Record<string, unknown> = {};
  if (raw.last_order_days_gt !== undefined) seg.last_order_days_gt = int(raw, 'last_order_days_gt', 0, 3650);
  if (raw.min_orders !== undefined) seg.min_orders = int(raw, 'min_orders', 0, 100_000);
  if (raw.max_orders !== undefined) seg.max_orders = int(raw, 'max_orders', 0, 100_000);
  if (raw.city !== undefined) { if (typeof raw.city !== 'string' || !CITY_RE.test(raw.city)) throw bad('city', 'Invalid city.'); seg.city = raw.city; }
  return seg;
};
/** Campaigns are stored and scheduled here; SENDING is not implemented yet (it needs the push split, see the recap). Marketing never uses the transactional push path. */
export const createCampaign = async (raw: unknown, actorId: string) => {
  if (!isObj(raw)) throw bad('body', 'Send an object.');
  onlyKeys(raw, ['name', 'description', 'channel', 'segment', 'title', 'body', 'promotionId', 'scheduledAt']);
  const promotionId = strOpt(raw, 'promotionId', 64);
  if (promotionId && !(await prisma.promotion.findUnique({ where: { id: promotionId }, select: { id: true } }))) throw bad('promotionId', 'Unknown promotion.');
  const data = {
    name: str(raw, 'name', 2, 120), description: str(raw, 'description', 2, 500), channel: raw.channel === undefined ? 'PUSH' : oneOf(raw, 'channel', ['PUSH', 'SMS', 'IN_APP'] as const),
    segment: readSegment(raw.segment) as Prisma.InputJsonValue, title: strOpt(raw, 'title', 65), body: strOpt(raw, 'body', 240), promotionId, scheduledAt: dateOpt(raw, 'scheduledAt'),
  };
  const row = await prisma.campaign.create({ data });
  await audit(prisma, { moduleCode: 'marketing.campaigns', action: 'CREATE_CAMPAIGN', newValue: { id: row.id, name: row.name }, changedBy: actorId });
  return row;
};
export const patchCampaign = async (id: string, raw: unknown, actorId: string) => {
  if (!isObj(raw)) throw bad('body', 'Send an object.');
  onlyKeys(raw, ['name', 'description', 'segment', 'title', 'body', 'scheduledAt', 'status']);
  const cur = await prisma.campaign.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'Unknown campaign.');
  if (cur.status === 'SENT') throw new AppError(409, 'CAMPAIGN_SENT', 'A sent campaign cannot be changed.');
  const data: Prisma.CampaignUpdateInput = {};
  if (raw.name !== undefined) data.name = str(raw, 'name', 2, 120);
  if (raw.description !== undefined) data.description = str(raw, 'description', 2, 500);
  if (raw.segment !== undefined) data.segment = readSegment(raw.segment) as Prisma.InputJsonValue;
  if (raw.title !== undefined) data.title = strOpt(raw, 'title', 65);
  if (raw.body !== undefined) data.body = strOpt(raw, 'body', 240);
  if (raw.scheduledAt !== undefined) data.scheduledAt = dateOpt(raw, 'scheduledAt');
  if (raw.status !== undefined) {
    const status = oneOf(raw, 'status', ['DRAFT', 'SCHEDULED', 'CANCELLED'] as const); // SENT is set by the sender only
    if (status === 'SCHEDULED') {
      if (!(await getRegistry()).isEnabled('marketing.campaigns')) throw new AppError(409, 'MODULE_DISABLED', 'Switch on the module "marketing.campaigns" first.');
      if (!(raw.scheduledAt ?? cur.scheduledAt) || !(cur.title || raw.title) || !(cur.body || raw.body)) throw bad('status', 'A scheduled campaign needs a date, a title and a body.');
    }
    data.status = status;
  }
  const row = await prisma.campaign.update({ where: { id }, data });
  await audit(prisma, { moduleCode: 'marketing.campaigns', action: 'UPDATE_CAMPAIGN', newValue: { id, fields: Object.keys(raw) }, changedBy: actorId });
  return row;
};

/** Only a campaign that never went out can be deleted; a sent one stays for its statistics. */
export const deleteCampaign = async (id: string, actorId: string) => {
  const cur = await prisma.campaign.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'Unknown campaign.');
  if (cur.status !== 'DRAFT' && cur.status !== 'CANCELLED') throw new AppError(409, 'CAMPAIGN_NOT_DELETABLE', 'Cancel the campaign first. A sent campaign is kept for its statistics.');
  await prisma.campaign.deleteMany({ where: { id, status: { in: ['DRAFT', 'CANCELLED'] } } });
  await audit(prisma, { moduleCode: 'marketing.campaigns', action: 'DELETE_CAMPAIGN', oldValue: { id, name: cur.name }, changedBy: actorId });
};

// --------------------------------------------------------------------------------------------------------------------- loyalty rules
const RULE_KEYS = ['name', 'description', 'triggerType', 'coinsAmount', 'coinsPercent', 'minCart', 'maxCoins', 'isActive'] as const;
const readRule = (raw: Record<string, unknown>) => {
  onlyKeys(raw, RULE_KEYS);
  const coinsAmount = intOpt(raw, 'coinsAmount', 0, 5000);
  const coinsPercent = numOpt(raw, 'coinsPercent', 0, 100);
  if (coinsAmount === null && coinsPercent === null) throw bad('coinsAmount', 'Give coinsAmount or coinsPercent.');
  return { name: str(raw, 'name', 2, 80), description: str(raw, 'description', 2, 400), triggerType: oneOf(raw, 'triggerType', ['ORDER_COMPLETED', 'SIGNUP', 'REFERRAL', 'REVIEW'] as const), coinsAmount, coinsPercent, minCart: intOpt(raw, 'minCart', 0, 1_000_000), maxCoins: intOpt(raw, 'maxCoins', 1, 5000), isActive: raw.isActive === undefined ? true : bool(raw, 'isActive') };
};
export const createLoyaltyRule = async (raw: unknown, actorId: string) => {
  if (!isObj(raw)) throw bad('body', 'Send an object.');
  const data = readRule(raw);
  const row = await prisma.loyaltyRule.create({ data });
  await audit(prisma, { moduleCode: 'marketing.loyalty_coins', action: 'CREATE_LOYALTY_RULE', newValue: { id: row.id, ...data }, changedBy: actorId });
  return row;
};
export const patchLoyaltyRule = async (id: string, raw: unknown, actorId: string) => {
  if (!isObj(raw)) throw bad('body', 'Send an object.');
  const cur = await prisma.loyaltyRule.findUnique({ where: { id } });
  if (!cur) throw new AppError(404, 'NOT_FOUND', 'Unknown rule.');
  const data = readRule({ ...pick(cur, RULE_KEYS), ...raw });
  const row = await prisma.loyaltyRule.update({ where: { id }, data });
  await audit(prisma, { moduleCode: 'marketing.loyalty_coins', action: 'UPDATE_LOYALTY_RULE', oldValue: { id, coinsAmount: cur.coinsAmount, isActive: cur.isActive }, newValue: { coinsAmount: row.coinsAmount, isActive: row.isActive, fields: Object.keys(raw) }, changedBy: actorId });
  return row;
};
export const deleteLoyaltyRule = async (id: string, actorId: string) => {
  const row = await prisma.loyaltyRule.delete({ where: { id } }).catch(() => null);
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Unknown rule.');
  await audit(prisma, { moduleCode: 'marketing.loyalty_coins', action: 'DELETE_LOYALTY_RULE', oldValue: { id, name: row.name }, changedBy: actorId });
};
