/** Support tickets, admin reviews and the one-call stats overview. Real PostgreSQL, in-process server. */
import supertest from 'supertest';
import { startTestServer, stopTestServer, TestServerInstance } from '../harness/app';
import { prisma } from '../harness/db';
import { World, createWorld, purgeWorld, createApi, Api } from '../harness/journey';

jest.setTimeout(60_000);

describe('support and admin stats', () => {
  let server: TestServerInstance;
  let request: ReturnType<typeof supertest>;
  let W: World;
  let api: Api;
  const [bearer, adminBearer] = [(t: string) => `Bearer ${t}`, () => `Bearer ${W.admin.token}`];
  const call = (method: 'get' | 'post' | 'patch', url: string, token: string, body?: unknown) => {
    const r = (request as any)[method](url).set('Authorization', bearer(token));
    return body === undefined ? r : r.send(body);
  };
  const admin = (method: 'get' | 'post' | 'patch', url: string, body?: unknown) => call(method, url, W.admin.token, body);

  beforeAll(async () => {
    W = await createWorld('sp', '4', { customers: 3, vendors: 2, riders: 1 });
    server = await startTestServer(0);
    request = supertest(server.app);
    api = createApi(server.baseUrl);
    await prisma.supportTicket.deleteMany({ where: { userId: { startsWith: 'sp-' } } });
  });
  afterAll(async () => {
    await prisma.supportTicket.deleteMany({ where: { userId: { startsWith: 'sp-' } } });
    await prisma.reviewRecord.deleteMany({ where: { customerId: { startsWith: 'sp-' } } });
    await purgeWorld('sp');
    await stopTestServer(server);
  });

  describe('tickets', () => {
    const open = (token: string, o: Record<string, unknown> = {}) => call('post', '/api/support/tickets', token, { category: 'DELIVERY', subject: 'Livraison en retard', message: 'Ma commande n\'est pas arrivée.', ...o });

    test('anonymous callers and admins cannot open tickets; every admin route refuses other roles', async () => {
      expect((await request.post('/api/support/tickets').send({})).status).toBe(401);
      expect((await open(W.admin.token)).status).toBe(403);
      for (const [m, u] of [['get', '/api/admin/support/tickets'], ['get', '/api/admin/support/stats'], ['get', '/api/admin/stats/overview'], ['get', '/api/admin/orders/live'], ['get', '/api/admin/reviews'], ['get', '/api/admin/reviews/stats']] as const) {
        expect([u, (await (request as any)[m](u)).status]).toEqual([u, 401]);
        expect([u, (await call(m, u, W.customers[0].token)).status]).toEqual([u, 403]);
        expect([u, (await call(m, u, W.vendors[0].token)).status]).toEqual([u, 403]);
      }
    });

    test('a customer opens, reads and answers a ticket; invalid input is refused', async () => {
      const c = W.customers[0];
      const res = await open(c.token);
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ status: 'OPEN', category: 'DELIVERY', priority: 'NORMAL', openedByRole: 'CLIENT' });
      for (const bad of [{ category: 'NOPE' }, { subject: 'ab' }, { message: '<script>x</script>' }, { message: 'a\u0000b c d e' }, { subject: 'x'.repeat(121) }, { extra: 1 }, { orderId: 'does-not-exist' }]) {
        expect([JSON.stringify(bad).slice(0, 30), (await open(c.token, bad)).status]).toEqual([JSON.stringify(bad).slice(0, 30), 400]);
      }
      const id = res.body.data.id;
      expect((await call('post', `/api/support/tickets/${id}/messages`, c.token, { message: 'Toujours rien.' })).status).toBe(201);
      const one = await call('get', `/api/support/tickets/${id}`, c.token);
      expect(one.body.data.messages.map((m: any) => m.body)).toEqual(["Ma commande n'est pas arrivée.", 'Toujours rien.']);
      expect((await call('get', '/api/support/tickets', c.token)).body.total).toBe(1);
    });

    test('nobody sees or writes in somebody else\'s ticket; a ticket about an order needs that order to be yours', async () => {
      const [a, b] = W.customers;
      const t = (await open(a.token)).body.data;
      expect((await call('get', `/api/support/tickets/${t.id}`, b.token)).status).toBe(404);
      expect((await call('post', `/api/support/tickets/${t.id}/messages`, b.token, { message: 'hello' })).status).toBe(404);
      expect((await call('get', '/api/support/tickets', b.token)).body.total).toBe(0);
      const placed = await api.place(a, W.vendors[0], {});
      expect((await open(a.token, { orderId: placed.body.data.id })).status).toBe(201);
      expect((await open(b.token, { orderId: placed.body.data.id })).status).toBe(400); // not b's order
      expect((await open(W.vendors[1].token, { orderId: placed.body.data.id })).status).toBe(400); // not that restaurant's order
      expect((await open(W.vendors[0].token, { orderId: placed.body.data.id, category: 'ORDER' })).status).toBe(201); // the restaurant of that order
      await prisma.supportTicket.deleteMany({ where: { userId: W.vendors[0].id } });
    });

    test('at most 5 open tickets per person, even in parallel', async () => {
      const c = W.customers[2];
      const results = await Promise.all(Array.from({ length: 8 }, (_, i) => open(c.token, { subject: `Problème numéro ${i}` })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(5);
      expect(results.filter((r) => r.status === 429).every((r) => r.body.code === 'TOO_MANY_TICKETS')).toBe(true);
    });

    test('admin: list, filter, assign, answer (first response), internal note hidden from the customer, resolve, reopen by the customer, close', async () => {
      const c = W.customers[1];
      const t = (await open(c.token, { category: 'PAYMENT', subject: 'Double paiement' })).body.data;
      const list = await admin('get', '/api/admin/support/tickets?status=OPEN&category=PAYMENT');
      expect(list.body.data.find((x: any) => x.id === t.id)).toMatchObject({ status: 'OPEN', user: { id: c.id, role: 'CLIENT' }, messageCount: 1 });
      expect((await admin('get', '/api/admin/support/tickets?status=BAD')).status).toBe(400);
      expect((await admin('patch', `/api/admin/support/tickets/${t.id}`, { assignedTo: c.id })).status).toBe(400); // not an admin
      expect((await admin('patch', `/api/admin/support/tickets/${t.id}`, { assignedTo: W.admin.id, priority: 'URGENT' })).body.data.priority).toBe('URGENT');
      expect((await admin('post', `/api/admin/support/tickets/${t.id}/messages`, { message: 'Note: vérifier Wave.', internal: true })).status).toBe(201);
      expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('OPEN'); // an internal note changes nothing
      expect((await admin('post', `/api/admin/support/tickets/${t.id}/messages`, { message: 'Nous regardons.' })).status).toBe(201);
      const after = await prisma.supportTicket.findUniqueOrThrow({ where: { id: t.id } });
      expect([after.status, !!after.firstResponseAt]).toEqual(['IN_PROGRESS', true]);
      const asCustomer = await call('get', `/api/support/tickets/${t.id}`, c.token);
      expect(asCustomer.body.data.messages.map((m: any) => m.body)).toEqual(['Mon commande n\'est pas arrivée.'.replace('Mon commande', 'Ma commande'), 'Nous regardons.']);
      expect(JSON.stringify(asCustomer.body)).not.toContain('Wave');
      expect((await admin('get', `/api/admin/support/tickets/${t.id}`)).body.data.messages).toHaveLength(3);
      expect((await admin('patch', `/api/admin/support/tickets/${t.id}`, { status: 'RESOLVED' })).body.field).toBe('resolution');
      expect((await admin('patch', `/api/admin/support/tickets/${t.id}`, { status: 'RESOLVED', resolution: 'Remboursé.' })).body.data).toMatchObject({ status: 'RESOLVED', resolution: 'Remboursé.' });
      await call('post', `/api/support/tickets/${t.id}/messages`, c.token, { message: 'Non, rien reçu.' });
      expect((await prisma.supportTicket.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('OPEN'); // the customer's answer reopens it
      expect((await admin('patch', `/api/admin/support/tickets/${t.id}`, { status: 'CLOSED', resolution: 'Réglé par téléphone.' })).status).toBe(200);
      expect((await call('post', `/api/support/tickets/${t.id}/messages`, c.token, { message: 'encore' })).body.code).toBe('TICKET_CLOSED');
      expect((await admin('post', `/api/admin/support/tickets/${t.id}/messages`, { message: 'encore' })).body.code).toBe('TICKET_CLOSED');
      expect((await admin('patch', `/api/admin/support/tickets/${t.id}`, { hack: 1 })).status).toBe(400);
      const stats = (await admin('get', '/api/admin/support/stats')).body.data;
      expect(stats).toMatchObject({ open: expect.any(Number), inProgress: expect.any(Number), resolved: expect.any(Number), closed: expect.any(Number) });
      expect(stats.avgFirstResponseMinutes).not.toBeNull();
    });
  });

  describe('reviews', () => {
    let reviewIds: string[] = [];
    beforeAll(async () => {
      const mk = async (i: number, rating: number, orderStatus = 'DELIVERED') => {
        const o = await prisma.order.create({ data: { customerId: W.customers[0].id, vendorId: W.vendors[0].vendorId, totalAmount: 100, status: orderStatus as any, dropoffHostel: 'x', clientRequestId: `sp-rev-${i}` } });
        const r = await prisma.reviewRecord.create({ data: { orderId: o.id, customerId: W.customers[0].id, vendorId: W.vendors[0].vendorId, driverId: W.riders[0].id, driverRating: rating, driverTags: ['Rapide'], dishReviews: [{ dishId: 'd', rating: rating === 1 ? 2 : 4 }], dhabaNotes: 'ok' } });
        return r.id;
      };
      reviewIds = [await mk(1, 5), await mk(2, 4), await mk(3, 1)];
    });

    test('list with filters, stats with distribution and comparison, flag by admin and report by the restaurant', async () => {
      const all = await admin('get', `/api/admin/reviews?vendorId=${W.vendors[0].vendorId}`);
      expect(all.status).toBe(200);
      expect(all.body.total).toBe(3);
      expect(all.body.data[0]).toMatchObject({ restaurant: { id: W.vendors[0].vendorId }, customer: { id: W.customers[0].id }, flagged: false });
      expect((await admin('get', `/api/admin/reviews?vendorId=${W.vendors[0].vendorId}&rating=1`)).body.total).toBe(1);
      expect((await admin('get', '/api/admin/reviews?rating=9')).status).toBe(400);
      expect((await admin('get', '/api/admin/reviews?flagged=maybe')).status).toBe(400);

      const stats = (await admin('get', '/api/admin/reviews/stats?range=7d')).body.data;
      expect(stats.count).toBeGreaterThanOrEqual(3);
      expect(stats.distribution).toMatchObject({ 1: expect.any(Number), 5: expect.any(Number) });
      expect(stats).toMatchObject({ lowRated: expect.any(Number), previous: { count: expect.any(Number) } });
      expect(stats.averageDishRating).not.toBeNull();

      const lowId = reviewIds[2];
      expect((await admin('patch', `/api/admin/reviews/${lowId}/flag`, { flagged: true })).status).toBe(400); // a reason is needed
      const flagged = await admin('patch', `/api/admin/reviews/${lowId}/flag`, { flagged: true, reason: 'Propos injurieux' });
      expect(flagged.body.data).toMatchObject({ flagged: true, flagReason: 'Propos injurieux' });
      expect((await admin('get', '/api/admin/reviews?flagged=true')).body.data.some((r: any) => r.id === lowId)).toBe(true);

      const rep = await call('post', `/api/reviews/${reviewIds[1]}/report`, W.vendors[0].token, { reason: 'Faux avis' });
      expect(rep.status).toBe(200);
      expect((await prisma.reviewRecord.findUniqueOrThrow({ where: { id: reviewIds[1] } })).flaggedBy).toBe(`VENDOR:${W.vendors[0].id}`);
      expect((await call('post', `/api/reviews/${reviewIds[0]}/report`, W.vendors[1].token, { reason: 'Faux avis' })).status).toBe(404); // another restaurant's review
      expect((await call('post', `/api/reviews/${reviewIds[0]}/report`, W.customers[0].token, { reason: 'Faux avis' })).status).toBe(403);
      expect((await call('post', `/api/reviews/${reviewIds[0]}/report`, W.vendors[0].token, { reason: '<b>' })).status).toBe(400);
      expect((await admin('patch', `/api/admin/reviews/${lowId}/flag`, { flagged: false })).body.data.flagged).toBe(false);
      expect((await admin('patch', '/api/admin/reviews/nope-nope/flag', { flagged: false })).status).toBe(404);
    });
  });

  describe('live orders and overview', () => {
    test('live counts and list: in progress, without rider, stuck; filters', async () => {
      const c = W.customers[0];
      const mk = (i: number, data: Record<string, unknown>) => prisma.order.create({ data: { customerId: c.id, vendorId: W.vendors[1].vendorId, totalAmount: 100, dropoffHostel: 'x', paymentStatus: 'PAID', paidAt: new Date(Date.now() - 3_600_000), clientRequestId: `sp-live-${i}`, ...data } as any });
      const old = new Date(Date.now() - 3 * 3_600_000);
      await mk(1, { status: 'READY_FOR_PICKUP', updatedAt: old }); // ready, no rider, waiting long: stuck + without rider
      await mk(2, { status: 'PREPARING' });
      await mk(3, { status: 'PICKED_UP', driverId: W.riders[0].id, pickedUpAt: old }); // overdue delivery: stuck
      const before = (await admin('get', '/api/admin/orders/live?list=false')).body.counts;
      expect(before).toMatchObject({ inProgress: expect.any(Number), withoutRider: expect.any(Number), stuck: expect.any(Number) });
      expect(before.withoutRider).toBeGreaterThanOrEqual(1);
      expect(before.stuck).toBeGreaterThanOrEqual(2);
      expect(before.inProgress).toBeGreaterThanOrEqual(3);
      const stuck = await admin('get', '/api/admin/orders/live?problem=stuck&limit=20');
      expect(stuck.status).toBe(200);
      expect(stuck.body.data.length).toBeGreaterThanOrEqual(2);
      expect(stuck.body.data.every((o: any) => ['READY_FOR_PICKUP', 'PICKED_UP', 'ARRIVED_AT_GATE', 'PLACED'].includes(o.status))).toBe(true);
      expect((await admin('get', '/api/admin/orders/live?problem=bogus')).status).toBe(400);
      expect((await admin('get', '/api/admin/orders/live?list=false')).body.data).toEqual([]);
    });

    test('overview: everything in one call, with the previous period, and a bad range is refused', async () => {
      const res = await admin('get', '/api/admin/stats/overview?range=7d');
      expect(res.status).toBe(200);
      const d = res.body.data;
      expect(Object.keys(d).sort()).toEqual(['finance', 'generatedAt', 'live', 'orders', 'partners', 'previousRange', 'range', 'reviews', 'signups', 'support'].sort());
      expect(d.range).toMatchObject({ days: 7, preset: '7d' });
      expect(d.previousRange.days).toBe(7);
      expect(d.previousRange.to < d.range.from).toBe(true);
      expect(d.orders).toMatchObject({ total: expect.any(Number), delivered: expect.any(Number), cancelled: expect.any(Number), rejectedByRestaurant: expect.any(Number), cancelledBy: { CUSTOMER: expect.any(Number), VENDOR: expect.any(Number), ADMIN: expect.any(Number), SYSTEM: expect.any(Number) } });
      expect(d.signups.clients).toMatchObject({ current: expect.any(Number), previous: expect.any(Number), change: expect.any(Number) });
      expect(d.partners.restaurants).toMatchObject({ total: expect.any(Number), approved: expect.any(Number), pending: expect.any(Number) });
      expect(d.partners.drivers).toHaveProperty('onDuty');
      expect(d.support).toHaveProperty('open');
      expect(d.reviews).toHaveProperty('flaggedOpen');
      expect(d.live).toHaveProperty('withoutRider');
      for (const bad of ['range=1y', 'from=nope', 'from=2026-10-10&to=2026-10-01', 'from=2020-01-01&to=2026-10-01']) expect([bad, (await admin('get', `/api/admin/stats/overview?${bad}`)).status]).toEqual([bad, 400]);
      expect((await admin('get', '/api/admin/stats/overview?from=2026-10-01&to=2026-10-15')).body.data.range).toMatchObject({ days: 15, preset: 'custom' });
    });

    test('orders by status in a period: cancelled by the restaurant counts as rejected, sign-ups are counted by role', async () => {
      const c = W.customers[0];
      const base = (await admin('get', '/api/admin/stats/overview?range=today')).body.data;
      await prisma.order.create({ data: { customerId: c.id, vendorId: W.vendors[0].vendorId, totalAmount: 100, dropoffHostel: 'x', status: 'CANCELLED', cancelledBy: 'VENDOR', cancelledAt: new Date(), clientRequestId: 'sp-rej-1' } });
      await prisma.order.create({ data: { customerId: c.id, vendorId: W.vendors[0].vendorId, totalAmount: 100, dropoffHostel: 'x', status: 'DELIVERED', deliveredAt: new Date(), clientRequestId: 'sp-del-1' } });
      const next = (await admin('get', '/api/admin/stats/overview?range=today')).body.data;
      expect(next.orders.rejectedByRestaurant).toBe(base.orders.rejectedByRestaurant + 1);
      expect(next.orders.cancelled).toBe(base.orders.cancelled + 1);
      expect(next.orders.delivered).toBe(base.orders.delivered + 1);
      expect(next.signups.clients.current).toBeGreaterThanOrEqual(3); // the 3 test customers were created today
      expect(next.signups.restaurants.current).toBeGreaterThanOrEqual(2);
      expect(next.signups.drivers.current).toBeGreaterThanOrEqual(1);
    });
  });
});
