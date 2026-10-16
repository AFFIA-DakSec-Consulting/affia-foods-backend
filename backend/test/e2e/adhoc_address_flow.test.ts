/** Delivery address selection: saved profile address, a recent address, or a one-off address with an optional GPS pin. Real PostgreSQL, in-process server. */
import supertest from 'supertest';
import { startTestServer, stopTestServer, TestServerInstance } from '../harness/app';
import { World, createWorld, purgeWorld, createApi, Api, cartOf } from '../harness/journey';
import { prisma } from '../harness/db';

jest.setTimeout(30_000);

describe('Ad-hoc address and history flow', () => {
  let server: TestServerInstance;
  let request: ReturnType<typeof supertest>;
  let W: World;
  let api: Api;
  const ADDRESS = '123 Custom Street, Thiès';
  const get = (token: string, url: string) => request.get(url).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    W = await createWorld('ah', '6', { customers: 2, vendors: 1, riders: 0 });
    server = await startTestServer(0);
    request = supertest(server.app);
    api = createApi(server.baseUrl);
  });
  afterAll(async () => { await purgeWorld('ah'); await stopTestServer(server); });

  test('/api/campus has no default drop points', async () => {
    const res = await get(W.customers[0].token, '/api/campus');
    expect(res.status).toBe(200);
    expect(res.body.data.dropPoints).toEqual([]);
    expect(res.body.data.city).toBe('Thiès');
  });

  test('a one-off address with a GPS pin and a note is accepted and stored', async () => {
    const c = W.customers[0];
    const res = await api.place(c, W.vendors[0], { dropoffHostel: ADDRESS, lat: 14.79, lng: -16.93, dropoffNotes: 'Near the blue gate' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ dropoffHostel: ADDRESS, dropoff: { name: ADDRESS, lat: 14.79, lng: -16.93 } });
  });

  test('recent addresses: the latest first, with pin and note, and no duplicates', async () => {
    const c = W.customers[0];
    await api.place(c, W.vendors[0], { dropoffHostel: ADDRESS, lat: 14.79, lng: -16.93 });
    await api.place(c, W.vendors[0], { dropoffHostel: 'Cité Lamy' });
    const res = await get(c.token, '/api/auth/recent-addresses');
    expect(res.status).toBe(200);
    const mine = res.body.data.filter((a: any) => a.address === ADDRESS);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ lat: 14.79, lng: -16.93 });
    expect(res.body.data[0].address).toBe('Cité Lamy');
  });

  test('a customer never sees another customer\'s addresses; vendors and riders have no such list', async () => {
    const other = await get(W.customers[1].token, '/api/auth/recent-addresses');
    expect(other.body.data).toEqual([]);
    expect((await get(W.vendors[0].token, '/api/auth/recent-addresses')).status).toBe(403);
    expect((await request.get('/api/auth/recent-addresses')).status).toBe(401);
  });

  test('without an address in the request the profile address is used', async () => {
    const c = W.customers[1];
    await prisma.user.update({ where: { id: c.id }, data: { hostelBlock: 'Randoulène' } });
    const res = await request.post('/api/orders').set('Authorization', `Bearer ${c.token}`).send({ ...cartOf(W.vendors[0]), clientRequestId: 'ah-profile-1' });
    expect(res.status).toBe(201);
    expect(res.body.data.dropoffHostel).toBe('Randoulène');
  });

  test('saved addresses: validated like order addresses (no markup, real pin, 200 characters)', async () => {
    const c = W.customers[1];
    const post = (body: unknown) => request.post('/api/auth/addresses').set('Authorization', `Bearer ${c.token}`).send(body as object);
    const ok = await post({ label: 'Maison', address: '  12 Rue   des Fleurs, Thiès ', lat: 14.79, lng: -16.93 });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ label: 'Maison', address: '12 Rue des Fleurs, Thiès', lat: 14.79, lng: -16.93, isDefault: true });
    expect((await post({ label: '<b>x</b>', address: 'Rue 1' })).body.field).toBe('label');
    expect((await post({ label: 'Bureau', address: '<script>' })).body.field).toBe('address');
    expect((await post({ label: 'Bureau', address: 'x'.repeat(201) })).body.field).toBe('address');
    expect((await post({ label: 'Bureau', address: 'Rue 2', lat: 95, lng: 0 })).body.field).toBe('lat');
    expect((await post({ label: 'Bureau', address: 'Rue 2', lat: 14.79 })).body.field).toBe('lat');
    const id = ok.body.data.id;
    const put = (body: unknown) => request.put(`/api/auth/addresses/${id}`).set('Authorization', `Bearer ${c.token}`).send(body as object);
    expect((await put({ address: 'a\nb' })).status).toBe(400);
    expect((await put({ lat: null, lng: null })).body.data).toMatchObject({ lat: null, lng: null });
    // a saved address can be used as-is for an order
    const placed = await request.post('/api/orders').set('Authorization', `Bearer ${c.token}`).send({ ...cartOf(W.vendors[0]), dropoffHostel: ok.body.data.address, clientRequestId: 'ah-saved-1' });
    expect(placed.status).toBe(201);
  });
});
