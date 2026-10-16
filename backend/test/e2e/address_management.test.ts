import supertest from 'supertest';
import { startTestServer, stopTestServer, TestServerInstance } from '../harness/app';
import { prisma, cleanTestOrders, cleanTestUsers } from '../harness/db';
import { getClientToken, getAuthHeader } from '../harness/auth';

describe('Address Management API', () => {
  let server: TestServerInstance;
  let request: ReturnType<typeof supertest>;
  let clientToken: string;
  let clientHeader: { Authorization: string };

  beforeAll(async () => {
    await cleanTestOrders();
    await cleanTestUsers();
    
    // Create a test client
    const user = await prisma.user.create({
      data: {
        id: 'client-addr-test',
        name: 'Test Client',
        email: 'addr-test@kraveo.test',
        role: 'CLIENT',
      }
    });
    
    clientToken = getClientToken(user.id, '+221770000001');
    clientHeader = getAuthHeader(clientToken);
    
    server = await startTestServer(0);
    request = supertest(server.app);
  });

  afterAll(async () => {
    await cleanTestOrders();
    await cleanTestUsers();
    await stopTestServer(server);
    await prisma.$disconnect();
  });

  test('POST /api/auth/addresses - create address', async () => {
    const res = await request
      .post('/api/auth/addresses')
      .set(clientHeader)
      .send({
        label: 'Maison',
        address: '123 Rue de la Paix',
        lat: 14.7,
        lng: -17.4
      });
    
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.label).toBe('Maison');
    expect(res.body.data.isDefault).toBe(true); // First address is default
  });

  test('POST /api/auth/addresses - create second address', async () => {
    const res = await request
      .post('/api/auth/addresses')
      .set(clientHeader)
      .send({
        label: 'Bureau',
        address: '456 Avenue Tech',
        isDefault: false
      });
    
    expect(res.status).toBe(201);
    expect(res.body.data.label).toBe('Bureau');
    expect(res.body.data.isDefault).toBe(false);
  });

  test('GET /api/auth/addresses - list addresses', async () => {
    const res = await request
      .get('/api/auth/addresses')
      .set(clientHeader);
    
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data[0].label).toBe('Bureau'); // Ordered by desc
  });

  test('PUT /api/auth/addresses/:id - update address and set default', async () => {
    const listRes = await request.get('/api/auth/addresses').set(clientHeader);
    const bureau = listRes.body.data.find((a: any) => a.label === 'Bureau');
    
    const res = await request
      .put(`/api/auth/addresses/${bureau.id}`)
      .set(clientHeader)
      .send({
        isDefault: true,
        address: '789 New Office'
      });
    
    expect(res.status).toBe(200);
    expect(res.body.data.isDefault).toBe(true);
    expect(res.body.data.address).toBe('789 New Office');
    
    // Check that others are no longer default
    const maison = listRes.body.data.find((a: any) => a.label === 'Maison');
    const maisonCheck = await prisma.address.findUnique({ where: { id: maison.id } });
    expect(maisonCheck?.isDefault).toBe(false);
  });

  test('DELETE /api/auth/addresses/:id - delete address', async () => {
    const listRes = await request.get('/api/auth/addresses').set(clientHeader);
    const bureau = listRes.body.data.find((a: any) => a.isDefault === true);
    
    const res = await request
      .delete(`/api/auth/addresses/${bureau.id}`)
      .set(clientHeader);
    
    expect(res.status).toBe(200);
    
    // Check that another address became default
    const remaining = await prisma.address.findFirst({ where: { userId: 'client-addr-test' } });
    expect(remaining?.isDefault).toBe(true);
  });
});
