/** Modular platform (KRAVEO_SPEC_MODULES.md): back-office API, security, atomic budget, ledger, shadow mode. Real PostgreSQL. */
import supertest from 'supertest';
import { startTestServer, stopTestServer, TestServerInstance } from '../harness/app';
import { prisma } from '../harness/db';
import { World, createWorld, purgeWorld, createApi, Api } from '../harness/journey';
import { invalidateModuleCache } from '../../src/core/modules/module-registry.service';
import { redeemPromotion, consumeSubscriptionDelivery } from '../../src/modules/marketing/promotion-redemption.service';
import { addLedgerEntry } from '../../src/modules/marketing/loyalty.service';
import { runShadow, __waitForShadow } from '../../src/shared/pricing/shadow';
import { setPushProvider } from '../../src/services/push/provider';
import { sendCampaign, runCampaignMaintenance } from '../../src/modules/marketing/campaigns/campaign-sender';
import type { PushMessage } from '../../src/services/push/types';

jest.setTimeout(60_000);

describe('modular platform', () => {
  let server: TestServerInstance;
  let request: ReturnType<typeof supertest>;
  let W: World;
  let api: Api;
  let saved: { modules: any[]; settings: any[]; zones: any[] };
  const admin = () => `Bearer ${W.admin.token}`;
  const as = (method: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, body?: unknown, token = admin()) => {
    const r = (request as any)[method](url).set('Authorization', token);
    return body === undefined ? r : r.send(body);
  };

  beforeAll(async () => {
    W = await createWorld('mp', '5', { customers: 2, vendors: 2, riders: 0 });
    server = await startTestServer(0);
    request = supertest(server.app);
    api = createApi(server.baseUrl);
    saved = { modules: await prisma.platformModule.findMany(), settings: await prisma.moduleSetting.findMany(), zones: await prisma.deliveryZone.findMany() };
  });
  afterAll(async () => {
    // Put the seeded configuration back exactly as it was.
    for (const m of saved.modules) await prisma.platformModule.update({ where: { code: m.code }, data: { isEnabled: m.isEnabled } });
    for (const s of saved.settings) await prisma.moduleSetting.update({ where: { id: s.id }, data: { value: s.value } });
    await prisma.deliveryZone.deleteMany({});
    await prisma.deliveryZone.createMany({ data: saved.zones });
    await prisma.promotionRedemption.deleteMany({ where: { userId: { startsWith: 'mp-' } } });
    await prisma.promotion.deleteMany({ where: { name: { startsWith: 'MPTEST' } } });
    await prisma.campaign.deleteMany({ where: { name: { startsWith: 'MPTEST' } } });
    await prisma.subscriptionPlan.deleteMany({ where: { name: { startsWith: 'MPTEST' } } });
    await prisma.loyaltyTransaction.deleteMany({ where: { userId: { startsWith: 'mp-' } } });
    await prisma.pricingParityLog.deleteMany({});
    await purgeWorld('mp');
    invalidateModuleCache();
    await stopTestServer(server);
  });

  test('every back-office route refuses anonymous callers, customers, and unknown fields', async () => {
    const routes: [string, string][] = [['get', '/api/admin/modules'], ['patch', '/api/admin/modules/marketing/toggle'], ['get', '/api/admin/modules/marketing/settings'], ['patch', '/api/admin/modules/marketing.promo_codes/settings/allow_stacking'],
      ['get', '/api/admin/delivery-zones'], ['put', '/api/admin/delivery-zones'], ['get', '/api/admin/promotions'], ['post', '/api/admin/promotions'], ['get', '/api/admin/subscription-plans'], ['post', '/api/admin/campaigns'],
      ['get', '/api/admin/loyalty-rules'], ['get', '/api/admin/modules/audit-log'], ['post', '/api/admin/pricing/simulate'], ['get', '/api/admin/courier-bonuses']];
    for (const [m, url] of routes) {
      expect([m, url, (await (request as any)[m](url).send({})).status]).toEqual([m, url, 401]);
      expect([m, url, (await as(m as any, url, {}, `Bearer ${W.customers[0].token}`)).status]).toEqual([m, url, 403]);
    }
  });

  test('module list: core modules cannot be toggled; marketing off cascades only when confirmed; every change is audited with the admin id', async () => {
    const list = await as('get', '/api/admin/modules');
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBeGreaterThanOrEqual(17);
    expect(list.body.data.find((m: any) => m.code === 'marketing.promo_codes')).toMatchObject({ effective: true, parentCode: 'marketing' });
    expect((await as('patch', '/api/admin/modules/delivery.base_pricing/toggle', { enabled: false })).body.code).toBe('MODULE_CORE');
    expect((await as('patch', '/api/admin/modules/marketing.free_delivery/toggle', { enabled: 'yes' })).status).toBe(400);
    expect((await as('patch', '/api/admin/modules/marketing.free_delivery/toggle', { enabled: true, hack: 1 })).status).toBe(400);
    expect((await as('patch', '/api/admin/modules/nope.nope/toggle', { enabled: true })).status).toBe(404);
    expect((await as('patch', '/api/admin/modules/..%2Fx/toggle', { enabled: true })).status).toBe(400);
    // Turning a child on needs its parent; turning marketing off needs the cascade because children depend on it.
    const refused = await as('patch', '/api/admin/modules/marketing/toggle', { enabled: false });
    expect([refused.status, refused.body.code]).toEqual([409, 'MODULE_DEPENDENTS']);
    expect(refused.body.dependents).toEqual(expect.arrayContaining(['marketing.promo_codes', 'marketing.first_order']));
    expect((await prisma.platformModule.findUniqueOrThrow({ where: { code: 'marketing' } })).isEnabled).toBe(true);
    const done = await as('patch', '/api/admin/modules/marketing/toggle', { enabled: false, cascade: true });
    expect(done.status).toBe(200);
    expect(done.body.changed).toEqual(expect.arrayContaining(['marketing', 'marketing.promo_codes']));
    const off = await as('post', '/api/admin/pricing/simulate', { distance_km: 4, cart_amount: 10000, promo_code: 'KRAVEO50' });
    expect(off.body.data.step3_marketing).toBeNull(); // marketing OFF: no discount at all, the order still prices
    expect(off.body.data.customerPays.total).toBe(10500);
    const blocked = await as('patch', '/api/admin/modules/marketing.free_delivery/toggle', { enabled: true });
    expect([blocked.status, blocked.body.code]).toEqual([409, 'MODULE_DEPENDENCY']);
    expect((await as('patch', '/api/admin/modules/marketing/toggle', { enabled: true })).status).toBe(200);
    expect((await as('patch', '/api/admin/modules/marketing.promo_codes/toggle', { enabled: true })).status).toBe(200);
    expect((await as('patch', '/api/admin/modules/marketing.first_order/toggle', { enabled: true })).status).toBe(200);
    const log = await as('get', '/api/admin/modules/audit-log?module=marketing');
    expect(log.body.data[0]).toMatchObject({ moduleCode: 'marketing', changedBy: W.admin.id });
  });

  test('settings: validated by type, range, options and cross-field rules; the change is audited with old and new value', async () => {
    const set = (m: string, k: string, value: unknown) => as('patch', `/api/admin/modules/${m}/settings/${k}`, { value });
    expect((await set('delivery.base_pricing', 'base_fee', 10.5)).status).toBe(400);
    expect((await set('delivery.base_pricing', 'base_fee', 99999)).status).toBe(400);
    expect((await set('delivery.base_pricing', 'base_fee', '600')).status).toBe(400);
    expect((await set('delivery.base_pricing', 'nope', 1)).status).toBe(404);
    expect((await set('courier.base_payout', 'mode', 'free_money')).status).toBe(400);
    expect((await set('delivery.base_pricing', 'min_fee', 6000)).status).toBe(400); // above max_fee
    expect((await as('patch', '/api/admin/modules/delivery.base_pricing/settings/base_fee', { value: 600, extra: 1 })).status).toBe(400);
    const ok = await set('delivery.base_pricing', 'base_fee', 600);
    expect(ok.body).toMatchObject({ success: true, changed: true, data: { value: 600, previous: 500 } });
    const log = await as('get', '/api/admin/modules/audit-log?module=delivery.base_pricing');
    expect(log.body.data[0]).toMatchObject({ action: 'UPDATE_SETTING', settingKey: 'base_fee', oldValue: 500, newValue: 600, changedBy: W.admin.id });
    expect((await set('delivery.base_pricing', 'base_fee', 600)).body.changed).toBe(false);
    await set('delivery.base_pricing', 'base_fee', 500);
    const rush = await set('delivery.surge_pricing', 'rush_hours', [{ from: '99:00', to: '14:00' }]);
    expect(rush.status).toBe(400);
  });

  test('zones: replaced as a whole and audited; a broken grid is refused and nothing changes', async () => {
    const before = (await as('get', '/api/admin/delivery-zones')).body.data.length;
    const bad = await as('put', '/api/admin/delivery-zones', { zones: [{ label: 'a', minKm: 0, maxKm: 2, fee: 700, courierPayout: 700 }, { label: 'b', minKm: 5, maxKm: null, fee: 1, courierPayout: 1 }] });
    expect(bad.status).toBe(400);
    expect((await as('get', '/api/admin/delivery-zones')).body.data.length).toBe(before);
    const ok = await as('put', '/api/admin/delivery-zones', { zones: [{ label: '0-3 km', minKm: 0, maxKm: 3, fee: 800, courierPayout: 800 }, { label: '3 km et +', minKm: 3, maxKm: null, fee: null, courierPayout: null }] });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toHaveLength(2);
    const sim = await as('post', '/api/admin/pricing/simulate', { distance_km: 2, cart_amount: 5000, overrides: { 'delivery.zone_pricing': true } });
    expect(sim.body.data.step1_delivery).toMatchObject({ deliveryFeeOriginal: 800, zone: { label: '0-3 km' } });
    expect(sim.body.data.courierPayout).toBe(800);
  });

  test('promotions: create, duplicate code, immutable code/type, funding cap, stats; a created coupon works with no deploy', async () => {
    const mk = (o: Record<string, unknown> = {}) => as('post', '/api/admin/promotions', { moduleCode: 'marketing.promo_codes', type: 'FIXED_OFF_CART', value: 700, name: 'MPTEST fixe', description: 'test', code: 'mptest700', minCartAmount: 3000, ...o });
    const created = await mk();
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe('MPTEST700');
    expect((await mk()).body.code).toBe('CODE_TAKEN');
    expect((await mk({ code: 'mptest2', fundedBy: 'SPLIT', merchantSharePct: 10 })).body.code).toBe('MODULE_DISABLED'); // merchant_funded is off
    expect((await mk({ code: 'x' })).status).toBe(400);
    expect((await mk({ value: -5, code: 'mptest3' })).status).toBe(400);
    const id = created.body.data.id;
    expect((await as('patch', `/api/admin/promotions/${id}`, { code: 'OTHER' })).status).toBe(400);
    expect((await as('patch', `/api/admin/promotions/${id}`, { type: 'FREE_DELIVERY' })).status).toBe(400);
    expect((await as('patch', `/api/admin/promotions/${id}`, { budgetSpent: 0 })).status).toBe(400);
    expect((await as('patch', `/api/admin/promotions/${id}`, { value: 800 })).body.data.value).toBe(800);
    const sim = await as('post', '/api/admin/pricing/simulate', { distance_km: 1, cart_amount: 5000, promo_code: 'mptest700' });
    expect(sim.body.data.step3_marketing.cartDiscount).toBe(800);
    expect((await as('get', `/api/admin/promotions/${id}/stats`)).body.data).toMatchObject({ uses: 0, budgetLeft: null });
    expect((await as('patch', '/api/admin/promotions/' + 'x'.repeat(80), { value: 1 })).status).toBe(400);
    await as('patch', `/api/admin/promotions/${id}`, { isActive: false });
    expect((await as('post', '/api/admin/pricing/simulate', { distance_km: 1, cart_amount: 5000, promo_code: 'MPTEST700' })).body.data.step3_marketing.cartDiscount).toBe(0);
  });

  test('simulator refuses unknown overrides/fields and writes nothing', async () => {
    const counts = async () => [await prisma.order.count(), await prisma.promotionRedemption.count(), await prisma.pricingParityLog.count()];
    const before = await counts();
    expect((await as('post', '/api/admin/pricing/simulate', { distance_km: 1, cart_amount: 5000, overrides: { 'nope.x': true } })).status).toBe(400);
    expect((await as('post', '/api/admin/pricing/simulate', { distance_km: 1, cart_amount: 5000, overrides: { marketing: 'yes' } })).status).toBe(400);
    expect((await as('post', '/api/admin/pricing/simulate', { distance_km: -1, cart_amount: 5000 })).status).toBe(400);
    expect((await as('post', '/api/admin/pricing/simulate', { distance_km: 1, cart_amount: 5000, sql: 'drop' })).status).toBe(400);
    expect((await as('post', '/api/admin/pricing/simulate', { distance_km: 1000, cart_amount: 5000 })).status).toBe(400);
    const far = await as('post', '/api/admin/pricing/simulate', { distance_km: 150, cart_amount: 5000 });
    expect([far.status, far.body.code]).toEqual([400, 'OUT_OF_RANGE']);
    const ok = await as('post', '/api/admin/pricing/simulate', { distance_km: 4, cart_amount: 10000, overrides: { 'marketing.free_delivery': true } });
    expect(ok.status).toBe(200);
    expect(ok.body.data.margin).toMatchObject({ deficit: expect.any(Boolean) });
    expect(await counts()).toEqual(before);
  });

  test('redeemPromotion: the budget is spent atomically (two concurrent checkouts cannot overspend) and is idempotent per order', async () => {
    const p = await prisma.promotion.create({ data: { moduleCode: 'marketing.promo_codes', name: 'MPTEST budget', description: 'x', code: 'MPBUDGET', type: 'FIXED_OFF_CART', value: 800, budgetTotal: 1000, maxUsesPerUser: 5 } });
    const go = (user: string, ref: string) => prisma.$transaction((tx) => redeemPromotion(tx, { promotionId: p.id, userId: user, orderRef: ref, discountAmount: 800, platformShare: 800, merchantShare: 0 })).then(() => 'ok', (e) => e.code ?? e.message);
    const results = await Promise.all([go(W.customers[0].id, 'mp-ref-1'), go(W.customers[1].id, 'mp-ref-2')]);
    expect(results.sort()).toEqual(['PROMOTION_EXHAUSTED', 'ok']);
    expect((await prisma.promotion.findUniqueOrThrow({ where: { id: p.id } })).budgetSpent).toBe(800);
    expect(await prisma.promotionRedemption.count({ where: { promotionId: p.id } })).toBe(1);
    const winner = (await prisma.promotionRedemption.findFirstOrThrow({ where: { promotionId: p.id } }));
    await prisma.$transaction((tx) => redeemPromotion(tx, { promotionId: p.id, userId: winner.userId, orderRef: winner.orderRef, discountAmount: 800, platformShare: 800, merchantShare: 0 }));
    expect((await prisma.promotion.findUniqueOrThrow({ where: { id: p.id } })).budgetSpent).toBe(800); // replay did not spend twice
    await expect(prisma.$transaction((tx) => redeemPromotion(tx, { promotionId: p.id, userId: 'u', orderRef: 'r', discountAmount: 800, platformShare: 500, merchantShare: 100 }))).rejects.toMatchObject({ code: 'BAD_REDEMPTION' });
  });

  test('subscription quota is consumed atomically', async () => {
    const plan = await prisma.subscriptionPlan.create({ data: { name: 'MPTEST plan', description: 'x', price: 1000, freeDeliveriesQuota: 2 } });
    const sub = await prisma.subscription.create({ data: { userId: W.customers[0].id, planId: plan.id, startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 86_400_000) } });
    const take = () => prisma.$transaction((tx) => consumeSubscriptionDelivery(tx, sub.id, new Date()));
    const r = await Promise.all([take(), take(), take(), take()]);
    expect(r.filter(Boolean)).toHaveLength(2);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).deliveriesUsed).toBe(2);
    await prisma.subscription.delete({ where: { id: sub.id } });
  });

  test('coin ledger: one credit per order even when replayed in parallel, balance is the sum, cap and overdraft are enforced', async () => {
    const u = W.customers[1].id;
    await prisma.user.update({ where: { id: u }, data: { kraveoCoins: 0 } });
    const earn = () => prisma.$transaction((tx) => addLedgerEntry(tx, { userId: u, amount: 10, reason: 'EARNED_ORDER', orderRef: 'mp-order-1' }));
    const r = await Promise.all([earn(), earn(), earn()]);
    expect(r.filter((x) => !x.duplicate)).toHaveLength(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u } })).kraveoCoins).toBe(10);
    const capped = await prisma.$transaction((tx) => addLedgerEntry(tx, { userId: u, amount: 50, reason: 'ADMIN', maxBalance: 30 }));
    expect([capped.applied, capped.balance]).toEqual([20, 30]);
    await expect(prisma.$transaction((tx) => addLedgerEntry(tx, { userId: u, amount: -31, reason: 'REDEEMED_COUPON' }))).rejects.toMatchObject({ code: 'INSUFFICIENT_COINS' });
    const rows = await prisma.loyaltyTransaction.findMany({ where: { userId: u }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((x) => x.balanceAfter)).toEqual([10, 30]);
  });

  test('shadow mode: the legacy price decides, the module pipeline is compared and its snapshot is written once', async () => {
    await prisma.pricingParityLog.deleteMany({});
    const c = W.customers[0];
    const v = W.vendors[0];
    const res = await api.place(c, v, {}, 2, 1); // one dish at 4000
    expect(res.status).toBe(201);
    const order = await prisma.order.findFirstOrThrow({ where: { customerId: c.id }, orderBy: { createdAt: 'desc' } });
    await runShadow({ kind: 'order', refId: order.id, customerId: c.id, vendors: [{ id: v.vendorId, lat: 14.79, lng: -16.93 }], cartAmount: order.subtotal, dropoffHostel: order.dropoffHostel, dropoffLat: null, dropoffLng: null, couponCode: null, legacy: { fee: order.deliveryFee, discount: order.discount, total: order.totalAmount }, orderIds: [order.id] });
    await __waitForShadow();
    const log = await prisma.pricingParityLog.findFirstOrThrow({ where: { orderRef: order.id } });
    expect(log).toMatchObject({ hasDiff: false, diffFields: [] });
    const after = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.deliveryFeeCustomer).toBe(order.deliveryFee);
    expect(after.courierPayout).toBeGreaterThanOrEqual(700); // the courier payout exists and does not come from the customer fee
    expect((after.pricingSnapshot as any).modules_enabled).toContain('delivery.base_pricing');
    const first = JSON.stringify(after.pricingSnapshot);
    await runShadow({ kind: 'order', refId: order.id, customerId: c.id, vendors: [{ id: v.vendorId, lat: 14.79, lng: -16.93 }], cartAmount: order.subtotal, dropoffHostel: order.dropoffHostel, dropoffLat: null, dropoffLng: null, couponCode: null, legacy: { fee: order.deliveryFee, discount: order.discount, total: order.totalAmount }, orderIds: [order.id] });
    expect(JSON.stringify((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).pricingSnapshot)).toBe(first); // immutable
  });

  test('CRUD: plans, loyalty rules, bonuses and promotions can be read, edited and deleted; used ones are protected', async () => {
    const plan = (await as('post', '/api/admin/subscription-plans', { name: 'MPTEST Plus', description: 'test', price: 2000, freeDeliveriesQuota: 10 })).body.data;
    expect((await as('get', `/api/admin/subscription-plans/${plan.id}`)).body.data.name).toBe('MPTEST Plus');
    const edited = await as('patch', `/api/admin/subscription-plans/${plan.id}`, { price: 2500, isActive: false });
    expect(edited.body.data).toMatchObject({ price: 2500, isActive: false, freeDeliveriesQuota: 10 });
    expect((await as('patch', `/api/admin/subscription-plans/${plan.id}`, { price: -1 })).status).toBe(400);
    const sub = await prisma.subscription.create({ data: { userId: W.customers[0].id, planId: plan.id, startsAt: new Date(), endsAt: new Date(Date.now() + 86_400_000) } });
    expect((await as('delete', `/api/admin/subscription-plans/${plan.id}`)).body.code).toBe('PLAN_HAS_SUBSCRIBERS');
    await prisma.subscription.delete({ where: { id: sub.id } });
    expect((await as('delete', `/api/admin/subscription-plans/${plan.id}`)).status).toBe(200);
    expect((await as('get', `/api/admin/subscription-plans/${plan.id}`)).status).toBe(404);

    const rule = (await as('post', '/api/admin/loyalty-rules', { name: 'MPTEST rule', description: 'test', triggerType: 'SIGNUP', coinsAmount: 5 })).body.data;
    expect((await as('patch', `/api/admin/loyalty-rules/${rule.id}`, { coinsAmount: 8, isActive: false })).body.data).toMatchObject({ coinsAmount: 8, isActive: false });
    expect((await as('post', '/api/admin/loyalty-rules', { name: 'x', description: 'y', triggerType: 'SIGNUP' })).status).toBe(400);
    expect((await as('delete', `/api/admin/loyalty-rules/${rule.id}`)).status).toBe(200);

    const bonus = (await as('post', '/api/admin/courier-bonuses', { name: 'MPTEST nuit', description: 'test', triggerType: 'NIGHT', amount: 300, conditions: { from: '22:00', to: '06:00' } })).body.data;
    expect((await as('patch', `/api/admin/courier-bonuses/${bonus.id}`, { amount: 400 })).body.data).toMatchObject({ amount: 400, triggerType: 'NIGHT' });
    expect((await as('patch', `/api/admin/courier-bonuses/${bonus.id}`, { conditions: { from: '25:00', to: '06:00' } })).status).toBe(400);
    expect((await as('delete', `/api/admin/courier-bonuses/${bonus.id}`)).status).toBe(200);

    const used = (await as('post', '/api/admin/promotions', { moduleCode: 'marketing.promo_codes', type: 'FIXED_OFF_CART', value: 100, name: 'MPTEST used', description: 'test', code: 'MPUSED' })).body.data;
    await prisma.promotionRedemption.create({ data: { promotionId: used.id, userId: W.customers[0].id, orderRef: 'mp-del-1', discountAmount: 100, platformShare: 100, merchantShare: 0 } });
    expect((await as('delete', `/api/admin/promotions/${used.id}`)).body.code).toBe('PROMOTION_USED');
    const fresh = (await as('post', '/api/admin/promotions', { moduleCode: 'marketing.promo_codes', type: 'FIXED_OFF_CART', value: 100, name: 'MPTEST fresh', description: 'test', code: 'MPFRESH' })).body.data;
    expect((await as('get', `/api/admin/promotions/${fresh.id}`)).body.data.code).toBe('MPFRESH');
    expect((await as('delete', `/api/admin/promotions/${fresh.id}`)).status).toBe(200);
    expect((await as('get', `/api/admin/promotions/${fresh.id}`)).status).toBe(404);
  });

  describe('campaigns', () => {
    const sentMessages: PushMessage[] = [];
    const marketing = () => sentMessages.filter((m) => m.data.event === 'MARKETING');
    const device = (userId: string, token: string) => prisma.deviceToken.create({ data: { userId, token, app: 'CUSTOMER' } });
    const mk = async (o: Record<string, unknown> = {}) => (await as('post', '/api/admin/campaigns', { name: 'MPTEST campagne', description: 'test', title: 'Bonjour', body: 'Une offre pour vous', segment: {}, ...o })).body.data;
    beforeAll(() => setPushProvider({ enabled: true, send: async (m) => { sentMessages.push(m); } }));
    afterAll(async () => { setPushProvider(null); await prisma.campaignDelivery.deleteMany({ where: { userId: { startsWith: 'mp-' } } }); await prisma.deviceToken.deleteMany({ where: { userId: { startsWith: 'mp-' } } }); });
    beforeEach(async () => {
      sentMessages.length = 0;
      await prisma.campaignDelivery.deleteMany({ where: { userId: { startsWith: 'mp-' } } });
      await prisma.deviceToken.deleteMany({ where: { userId: { startsWith: 'mp-' } } });
      await prisma.user.updateMany({ where: { id: { startsWith: 'mp-' } }, data: { marketingOptOut: false } });
      await prisma.moduleSetting.update({ where: { moduleCode_key: { moduleCode: 'marketing.campaigns', key: 'quiet_hours' } }, data: { value: { from: '03:00', to: '03:01' } } });
      await prisma.moduleSetting.update({ where: { moduleCode_key: { moduleCode: 'marketing.campaigns', key: 'daily_push_cap' } }, data: { value: 2 } });
      invalidateModuleCache();
      await prisma.platformModule.update({ where: { code: 'marketing.campaigns' }, data: { isEnabled: true } });
      invalidateModuleCache();
    });

    test('CRUD, validation, and no deletion once it went out', async () => {
      const c = await mk();
      expect((await as('get', `/api/admin/campaigns/${c.id}`)).body.data.status).toBe('DRAFT');
      expect((await as('patch', `/api/admin/campaigns/${c.id}`, { title: 'x'.repeat(66) })).status).toBe(400);
      expect((await as('patch', `/api/admin/campaigns/${c.id}`, { segment: { sql: 1 } })).status).toBe(400);
      expect((await as('patch', `/api/admin/campaigns/${c.id}`, { title: 'Nouveau titre' })).body.data.title).toBe('Nouveau titre');
      expect((await as('delete', `/api/admin/campaigns/${c.id}`)).status).toBe(200);
      const sentOne = await mk();
      await prisma.campaign.update({ where: { id: sentOne.id }, data: { status: 'SENT' } });
      expect((await as('delete', `/api/admin/campaigns/${sentOne.id}`)).body.code).toBe('CAMPAIGN_NOT_DELETABLE');
      expect((await as('patch', `/api/admin/campaigns/${sentOne.id}`, { title: 'late' })).body.code).toBe('CAMPAIGN_SENT');
    });

    test('sends once per customer, skips opted-out and device-less customers, and a second send is refused', async () => {
      const [a, b] = W.customers;
      await device(a.id, 'mp-token-a');
      await device(b.id, 'mp-token-b');
      await prisma.user.update({ where: { id: b.id }, data: { marketingOptOut: true } });
      const c = await mk({ segment: {} });
      const r = await as('post', `/api/admin/campaigns/${c.id}/send`);
      expect(r.status).toBe(200);
      const mine = sentMessages.filter((m) => m.token.startsWith('mp-token'));
      expect(mine.map((m) => m.token)).toEqual(['mp-token-a']); // the opted-out customer got nothing
      expect(mine[0]).toMatchObject({ title: 'Bonjour', channelId: 'marketing', data: { event: 'MARKETING', campaignId: c.id } });
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).status).toBe('SENT');
      expect((await as('post', `/api/admin/campaigns/${c.id}/send`)).body.code).toBe('CAMPAIGN_NOT_SENDABLE');
      expect(mine).toHaveLength(1);
    });

    test('daily cap, quiet hours and the module switch hold the campaign back', async () => {
      const a = W.customers[0];
      await device(a.id, 'mp-token-cap');
      await prisma.moduleSetting.update({ where: { moduleCode_key: { moduleCode: 'marketing.campaigns', key: 'daily_push_cap' } }, data: { value: 1 } });
      invalidateModuleCache();
      const first = await mk({ name: 'MPTEST cap 1' });
      const second = await mk({ name: 'MPTEST cap 2' });
      await sendCampaign(first.id);
      const out = await sendCampaign(second.id);
      expect(out).toMatchObject({ sent: 0, skipped: expect.any(Number) });
      expect((await prisma.campaignDelivery.findFirstOrThrow({ where: { campaignId: second.id, userId: a.id } })).reason).toBe('DAILY_CAP');

      const quiet = await mk({ name: 'MPTEST quiet' });
      const now = new Date();
      await prisma.moduleSetting.update({ where: { moduleCode_key: { moduleCode: 'marketing.campaigns', key: 'quiet_hours' } }, data: { value: { from: '00:00', to: '00:00' } } }); // whole day
      invalidateModuleCache();
      expect((await sendCampaign(quiet.id, now)).deferred).toBe('QUIET_HOURS');
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: quiet.id } })).status).toBe('DRAFT');

      await prisma.platformModule.update({ where: { code: 'marketing.campaigns' }, data: { isEnabled: false } });
      invalidateModuleCache();
      await expect(sendCampaign(quiet.id)).rejects.toMatchObject({ code: 'MODULE_DISABLED' });
      expect(await runCampaignMaintenance()).toBe(0);
    });

    test('segment filters by orders, "opened" counts once, conversion is measured from real orders', async () => {
      const [a, b] = W.customers;
      await device(a.id, 'mp-token-s1');
      await device(b.id, 'mp-token-s2');
      const placed = await api.place(a, W.vendors[0], { dropoffHostel: 'Cité Lamy' });
      expect(placed.status).toBe(201);
      const c = await mk({ name: 'MPTEST segment', segment: { max_orders: 0 } }); // customers who never ordered
      await sendCampaign(c.id);
      expect(marketing().map((m) => m.token)).toEqual(['mp-token-s2']); // order-status pushes (the replaced order) are a different circuit
      expect((await request.post(`/api/campaigns/${c.id}/opened`).set('Authorization', `Bearer ${a.token}`)).status).toBe(200); // not a recipient: nothing counted
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).openedCount).toBe(0);
      await request.post(`/api/campaigns/${c.id}/opened`).set('Authorization', `Bearer ${b.token}`);
      await request.post(`/api/campaigns/${c.id}/opened`).set('Authorization', `Bearer ${b.token}`);
      expect((await prisma.campaign.findUniqueOrThrow({ where: { id: c.id } })).openedCount).toBe(1);
      expect((await request.post(`/api/campaigns/${c.id}/opened`).set('Authorization', `Bearer ${W.vendors[0].token}`)).status).toBe(403);
      await api.place(b, W.vendors[0], { dropoffHostel: 'Cité Lamy' }); // b orders right after the push
      const stats = (await as('get', `/api/admin/campaigns/${c.id}/stats`)).body.data;
      expect(stats).toMatchObject({ sent: 1, opened: 1, converted: 1, conversionRate: 100 });
    });
  });
});
