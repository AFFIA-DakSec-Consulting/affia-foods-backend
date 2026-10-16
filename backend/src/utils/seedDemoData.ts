/**
 * Demo data for local development (Thies, Senegal): 6 restaurants with menus in FCFA, 3 riders, 6 customers and a week of orders.
 * Safe to run again (every row has a fixed id and is upserted; existing orders are left alone).
 *
 *   npm run seed:demo
 *   SEED_IMAGE_BASE=http://10.0.2.2:5001/static/seed-images npm run seed:demo   # Android emulator
 *
 * Images are the files in public/seed-images, served by the backend under /static (see src/index.ts).
 * Partner passwords are written to DEMO_ACCOUNTS.local.txt (mode 600). Refuses to run when NODE_ENV=production.
 */
import 'dotenv/config';
import { chmodSync, writeFileSync } from 'fs';
import { DutyStatus, OrderStatus, PaymentStatus, Role } from '@prisma/client';
import { prisma } from '../db';
import { hashPassword } from '../services/password';
import { DROP_POINTS } from '../config/campus';
import { ensureTestClient, TEST_CLIENT } from '../services/phoneOtp';

const IMAGE_BASE = (process.env.SEED_IMAGE_BASE || 'http://localhost:5001/static/seed-images').replace(/\/+$/, '');
const img = (name: string) => `${IMAGE_BASE}/${name}.jpg`;
const PASSWORD = 'Kraveo@2026';

/** Representative pin of a quartier (config/campus.ts), nudged a little so restaurants of one quartier do not sit on the same point. */
const pinOf = (quartier: string, n: number) => {
  const p = DROP_POINTS.find((d) => d.name === quartier)!;
  return { lat: Math.round((p.lat + 0.0008 * n) * 1e6) / 1e6, lng: Math.round((p.lng - 0.0006 * n) * 1e6) / 1e6 };
};
const DELIVERY_FEE = 500; // FCFA: the default all-in fee (settings group "fees")

type Dish = { key: string; name: string; price: number; category: string; description: string; veg: boolean; rating: number; ratingCount: number };
type Restaurant = {
  key: string; name: string; category: string; address: string; quartier: string; banner: string; eta: string;
  rating: number; ratings: number; owner: { name: string; phone: string }; ninea: string; dishes: Dish[];
};

// Prices are whole FCFA. The restaurants and people are fictional; the quartiers are the real delivery quartiers of config/campus.ts.
const RESTAURANTS: Restaurant[] = [
  {
    key: 'tatafatou', name: 'Chez Tata Fatou', category: 'Cuisine sénégalaise • Thiéboudienne • Yassa', address: 'Randoulène, près du marché', quartier: 'Randoulène',
    banner: 'banner-traditionnel', eta: '30-40 min', rating: 4.8, ratings: 214,
    owner: { name: 'Fatou Diop', phone: '+221 770000201' }, ninea: '0045218',
    dishes: [
      { key: 'thieboudienne', name: 'Thiéboudienne (riz au poisson)', price: 2000, category: 'Plats', description: 'Le plat national : riz rouge, poisson frais, chou, carotte, manioc et aubergine', veg: false, rating: 4.9, ratingCount: 120 },
      { key: 'yassa-poulet', name: 'Yassa poulet', price: 2500, category: 'Plats', description: 'Poulet mariné au citron, oignons caramélisés et riz blanc', veg: false, rating: 4.8, ratingCount: 96 },
      { key: 'mafe', name: 'Mafé (sauce arachide)', price: 2000, category: 'Plats', description: 'Ragoût de viande à la sauce d\'arachide, servi avec du riz', veg: false, rating: 4.6, ratingCount: 58 },
      { key: 'soupou-kandja', name: 'Soupou kandja', price: 2500, category: 'Plats', description: 'Sauce de gombo à l\'huile de palme, poisson fumé et riz', veg: false, rating: 4.5, ratingCount: 31 },
      { key: 'domoda', name: 'Domoda', price: 2000, category: 'Plats', description: 'Sauce onctueuse arachide et tomate, viande et riz', veg: false, rating: 4.4, ratingCount: 24 },
      { key: 'thiou', name: 'Thiou au poisson', price: 2000, category: 'Plats', description: 'Poisson mijoté en sauce tomate, légumes et riz', veg: false, rating: 4.5, ratingCount: 27 },
      { key: 'poisson-oignon', name: 'Poisson frit à l\'oignon', price: 3000, category: 'Plats', description: 'Poisson frit, oignons, légumes et riz aux petits pois', veg: false, rating: 4.6, ratingCount: 19 },
      { key: 'bissap', name: 'Jus de bissap (50 cl)', price: 500, category: 'Boissons', description: 'Jus frais de fleurs d\'hibiscus, menthe et sucre', veg: true, rating: 4.7, ratingCount: 88 },
    ],
  },
  {
    key: 'dibiterie', name: 'Dibiterie Chez Modou', category: 'Grillades • Dibi • Brochettes', address: 'Escale, près de la gare', quartier: 'Escale',
    banner: 'banner-dibiterie', eta: '20-30 min', rating: 4.7, ratings: 356,
    owner: { name: 'Modou Fall', phone: '+221 770000202' }, ninea: '0051234',
    dishes: [
      { key: 'dibi-frites', name: 'Dibi d\'agneau + frites', price: 2500, category: 'Grillades', description: 'Agneau grillé au feu de bois, oignons, moutarde, salade et frites', veg: false, rating: 4.9, ratingCount: 140 },
      { key: 'brochettes', name: 'Brochettes de bœuf (5 pièces)', price: 1500, category: 'Grillades', description: 'Brochettes marinées, grillées minute, sauce pimentée à part', veg: false, rating: 4.7, ratingCount: 82 },
      { key: 'poisson-braise-frites', name: 'Poisson braisé + frites', price: 3500, category: 'Grillades', description: 'Poisson entier braisé, oignons, salade, tomates et frites', veg: false, rating: 4.8, ratingCount: 64 },
      { key: 'poisson-fume', name: 'Kéthiakh (poisson fumé)', price: 2000, category: 'Grillades', description: 'Poisson braisé, salé et séché, à la sauce oignon', veg: false, rating: 4.3, ratingCount: 17 },
      { key: 'cafe-beignets', name: 'Café Touba + beignets', price: 700, category: 'Boissons', description: 'Café épicé au poivre de Guinée avec des beignets chauds', veg: true, rating: 4.6, ratingCount: 73 },
      { key: 'bissap', name: 'Jus de bissap (50 cl)', price: 500, category: 'Boissons', description: 'Jus frais de fleurs d\'hibiscus', veg: true, rating: 4.6, ratingCount: 41 },
    ],
  },
  {
    key: 'fataya', name: 'Fataya Express', category: 'Street food • Fataya • Sandwichs', address: 'Cité Ndiaye, carrefour', quartier: 'Cité Ndiaye',
    banner: 'banner-fataya', eta: '15-25 min', rating: 4.5, ratings: 188,
    owner: { name: 'Ibou Sy', phone: '+221 770000203' }, ninea: '0067845',
    dishes: [
      { key: 'fataya', name: 'Fataya (3 pièces)', price: 500, category: 'Snacks', description: 'Chaussons frits farcis au poisson épicé et à l\'oignon', veg: false, rating: 4.7, ratingCount: 210 },
      { key: 'sandwich-poulet', name: 'Sandwich poulet', price: 1500, category: 'Sandwichs', description: 'Baguette croustillante, poulet, oignons, mayonnaise et frites', veg: false, rating: 4.5, ratingCount: 76 },
      { key: 'chawarma', name: 'Chawarma poulet', price: 2000, category: 'Sandwichs', description: 'Pain pita, poulet émincé, crudités et sauce blanche', veg: false, rating: 4.6, ratingCount: 55 },
      { key: 'burger', name: 'Burger poulet', price: 2500, category: 'Burgers', description: 'Poulet croustillant, salade, tomate et sauce maison', veg: false, rating: 4.4, ratingCount: 38 },
      { key: 'jus-gingembre', name: 'Jus de gingembre', price: 500, category: 'Boissons', description: 'Gingembre pressé, citron et sucre, bien frais', veg: true, rating: 4.5, ratingCount: 49 },
    ],
  },
  {
    key: 'thiakry', name: 'Le Palais du Thiakry', category: 'Desserts • Jus naturels • Boissons', address: 'Médina Fall, rue principale', quartier: 'Médina Fall',
    banner: 'banner-desserts', eta: '15-20 min', rating: 4.7, ratings: 129,
    owner: { name: 'Aïssatou Ba', phone: '+221 770000204' }, ninea: '0073312',
    dishes: [
      { key: 'thiakry', name: 'Thiakry (bol)', price: 1000, category: 'Desserts', description: 'Couscous de mil, lait caillé sucré, vanille et raisins secs', veg: true, rating: 4.8, ratingCount: 92 },
      { key: 'lakh', name: 'Lakh (bouillie de mil)', price: 1000, category: 'Desserts', description: 'Bouillie de mil à la crème, parfumée et sucrée', veg: true, rating: 4.6, ratingCount: 45 },
      { key: 'jus-bouye', name: 'Jus de bouye (pain de singe)', price: 500, category: 'Boissons', description: 'Jus onctueux de fruit de baobab', veg: true, rating: 4.7, ratingCount: 66 },
      { key: 'jus-gingembre', name: 'Jus de gingembre', price: 500, category: 'Boissons', description: 'Gingembre pressé, citron et sucre', veg: true, rating: 4.5, ratingCount: 58 },
      { key: 'bissap', name: 'Jus de bissap (50 cl)', price: 500, category: 'Boissons', description: 'Jus frais de fleurs d\'hibiscus, menthe', veg: true, rating: 4.7, ratingCount: 71 },
      { key: 'cafe-beignets', name: 'Café Touba + beignets', price: 700, category: 'Boissons', description: 'Café épicé et beignets chauds', veg: true, rating: 4.4, ratingCount: 22 },
    ],
  },
  {
    key: 'snack', name: 'Snack Escale', category: 'Fast-food • Burgers • Pizza', address: 'Escale, avenue Caporal Famara Sagna', quartier: 'Escale',
    banner: 'banner-snack', eta: '20-30 min', rating: 4.4, ratings: 97,
    owner: { name: 'Cheikh Gueye', phone: '+221 770000205' }, ninea: '0081120',
    dishes: [
      { key: 'burger', name: 'Burger poulet', price: 2500, category: 'Burgers', description: 'Poulet croustillant, salade, tomate et sauce maison', veg: false, rating: 4.5, ratingCount: 61 },
      { key: 'burger-fries', name: 'Burger + frites', price: 3500, category: 'Menus', description: 'Double steak, fromage et une barquette de frites', veg: false, rating: 4.6, ratingCount: 48 },
      { key: 'pizza', name: 'Pizza (grande)', price: 4000, category: 'Pizzas', description: 'Pizza à la tomate et au fromage, garniture au choix', veg: false, rating: 4.3, ratingCount: 33 },
      { key: 'chawarma', name: 'Chawarma bœuf', price: 2000, category: 'Sandwichs', description: 'Pain pita, bœuf émincé, crudités et sauce blanche', veg: false, rating: 4.4, ratingCount: 29 },
      { key: 'sandwich-poulet', name: 'Sandwich baguette poulet', price: 1500, category: 'Sandwichs', description: 'Baguette, poulet, oignons et frites', veg: false, rating: 4.3, ratingCount: 26 },
      { key: 'cold-coffee', name: 'Café glacé', price: 1000, category: 'Boissons', description: 'Café, lait et glaçons mixés', veg: true, rating: 4.4, ratingCount: 18 },
    ],
  },
  {
    key: 'aissatou', name: 'Chez Maman Aïssatou', category: 'Petit déjeuner • Pâtisserie • Café', address: 'Cité Lamy, près de l\'école', quartier: 'Cité Lamy',
    banner: 'banner-petitdej', eta: '15-25 min', rating: 4.6, ratings: 84,
    owner: { name: 'Aïssatou Ndiaye', phone: '+221 770000206' }, ninea: '0092271',
    dishes: [
      { key: 'petit-dejeuner', name: 'Petit déjeuner (pain, beurre, café)', price: 1000, category: 'Petit déjeuner', description: 'Baguette fraîche, beurre, omelette et café au lait', veg: false, rating: 4.7, ratingCount: 70 },
      { key: 'pancakes', name: 'Crêpes au miel (3 pièces)', price: 1500, category: 'Petit déjeuner', description: 'Crêpes moelleuses, miel et beurre', veg: true, rating: 4.5, ratingCount: 28 },
      { key: 'chocolate-cake', name: 'Gâteau au chocolat (part)', price: 1500, category: 'Pâtisserie', description: 'Génoise moelleuse et glaçage au chocolat', veg: true, rating: 4.9, ratingCount: 44 },
      { key: 'strawberry-pastry', name: 'Pâtisserie à la fraise', price: 1200, category: 'Pâtisserie', description: 'Crème légère et fraises fraîches', veg: true, rating: 4.6, ratingCount: 21 },
      { key: 'lakh', name: 'Lakh (bouillie de mil)', price: 1000, category: 'Petit déjeuner', description: 'Bouillie de mil à la crème', veg: true, rating: 4.4, ratingCount: 15 },
      { key: 'cold-coffee', name: 'Café au lait glacé', price: 1000, category: 'Boissons', description: 'Café au lait sur glace', veg: true, rating: 4.5, ratingCount: 23 },
    ],
  },
];

const CUSTOMERS = [
  { id: 'demo-cus-1', name: 'Awa Diop', phone: '+221 771000001', email: 'awa.diop@kraveo-demo.test', quartier: 'Randoulène', coins: 30 },
  { id: 'demo-cus-2', name: 'Moussa Sall', phone: '+221 771000002', email: 'moussa.sall@kraveo-demo.test', quartier: 'Escale', coins: 40 },
  { id: 'demo-cus-3', name: 'Khadija Ndao', phone: '+221 771000003', email: 'khadija.ndao@kraveo-demo.test', quartier: 'Cité Lamy', coins: 10 },
  { id: 'demo-cus-4', name: 'Pape Cissé', phone: '+221 771000004', email: 'pape.cisse@kraveo-demo.test', quartier: 'Thiès Nord', coins: 55 },
  { id: 'demo-cus-5', name: 'Mame Diarra Faye', phone: '+221 771000005', email: 'mame.faye@kraveo-demo.test', quartier: 'Médina Fall', coins: 0 },
  { id: 'demo-cus-6', name: 'Ousmane Thiam', phone: '+221 771000006', email: 'ousmane.thiam@kraveo-demo.test', quartier: 'Nguinth', coins: 20 },
];

const DRIVERS = [
  { id: 'demo-drv-1', name: 'Mamadou Ndiaye', phone: '+221 770000301', code: 'RUN-7001', vehicle: 'Bike', plate: 'AA-482-DK', avatar: 'driver-1', duty: DutyStatus.ONLINE, rating: 4.8, quartier: 'Escale' },
  { id: 'demo-drv-2', name: 'Ibrahima Sarr', phone: '+221 770000302', code: 'RUN-7002', vehicle: 'Scooter', plate: 'AB-117-TH', avatar: 'driver-2', duty: DutyStatus.IN_TRANSIT, rating: 4.9, quartier: 'Cité Ndiaye' },
  { id: 'demo-drv-3', name: 'Awa Thiam', phone: '+221 770000303', code: 'RUN-7003', vehicle: 'Cycle', plate: null as string | null, avatar: 'driver-3', duty: DutyStatus.OFFLINE, rating: 4.7, quartier: 'Cité Lamy' },
];

type Plan = { vendor: string; customer: number; driver: number | null; status: OrderStatus; ageHours: number; items: [string, number][]; review?: number; note?: string };
// ageHours = how long ago the order was placed. Delivered ones spread over the last 7 days.
const ORDERS: Plan[] = [
  { vendor: 'tatafatou', customer: 0, driver: 0, status: 'DELIVERED', ageHours: 150, items: [['thieboudienne', 2], ['bissap', 2]], review: 5 },
  { vendor: 'dibiterie', customer: 1, driver: 1, status: 'DELIVERED', ageHours: 132, items: [['dibi-frites', 1], ['cafe-beignets', 1]], review: 5 },
  { vendor: 'fataya', customer: 2, driver: 0, status: 'DELIVERED', ageHours: 120, items: [['fataya', 3], ['chawarma', 1]], review: 4 },
  { vendor: 'thiakry', customer: 3, driver: 2, status: 'DELIVERED', ageHours: 100, items: [['thiakry', 2], ['jus-bouye', 2]], review: 5 },
  { vendor: 'snack', customer: 4, driver: 1, status: 'DELIVERED', ageHours: 96, items: [['burger-fries', 1], ['cold-coffee', 1]] },
  { vendor: 'aissatou', customer: 5, driver: 2, status: 'DELIVERED', ageHours: 80, items: [['chocolate-cake', 2], ['cold-coffee', 1]], review: 5 },
  { vendor: 'tatafatou', customer: 1, driver: 0, status: 'DELIVERED', ageHours: 72, items: [['yassa-poulet', 1], ['mafe', 1]], review: 4 },
  { vendor: 'dibiterie', customer: 0, driver: 1, status: 'DELIVERED', ageHours: 55, items: [['poisson-braise-frites', 1], ['brochettes', 1]] },
  { vendor: 'tatafatou', customer: 3, driver: 1, status: 'DELIVERED', ageHours: 48, items: [['soupou-kandja', 1], ['thiou', 1]], review: 5 },
  { vendor: 'snack', customer: 4, driver: 0, status: 'DELIVERED', ageHours: 30, items: [['pizza', 1]] },
  { vendor: 'fataya', customer: 2, driver: 2, status: 'DELIVERED', ageHours: 26, items: [['sandwich-poulet', 2], ['jus-gingembre', 2]], review: 4 },
  { vendor: 'aissatou', customer: 0, driver: 1, status: 'DELIVERED', ageHours: 8, items: [['petit-dejeuner', 2], ['pancakes', 1]], review: 5 },
  { vendor: 'tatafatou', customer: 5, driver: null, status: 'CANCELLED', ageHours: 60, items: [['domoda', 1]], note: 'Le restaurant ne peut pas préparer la commande' },
  // live orders (for the vendor and rider apps)
  { vendor: 'tatafatou', customer: 0, driver: null, status: 'PREPARING', ageHours: 0.3, items: [['thieboudienne', 1], ['bissap', 1]] },
  { vendor: 'dibiterie', customer: 3, driver: null, status: 'READY_FOR_PICKUP', ageHours: 0.6, items: [['dibi-frites', 2], ['brochettes', 1]] },
  { vendor: 'snack', customer: 1, driver: 1, status: 'PICKED_UP', ageHours: 0.8, items: [['burger', 2], ['cold-coffee', 2]] },
  { vendor: 'fataya', customer: 4, driver: null, status: 'PLACED', ageHours: 0.05, items: [['fataya', 6]] },
];
const PAYMENT_METHODS = ['WAVE', 'ORANGE_MONEY', 'CASH'] as const;

const MIN = 60_000;
const HOUR = 60 * MIN;

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data when NODE_ENV=production.');
  const passwordHash = await hashPassword(PASSWORD);
  const now = Date.now();

  // Customers (they sign in with Google; these rows give the orders their customers)
  for (const c of CUSTOMERS) {
    const data = { name: c.name, phone: c.phone, email: c.email, role: Role.CLIENT, hostelBlock: c.quartier, kraveoCoins: c.coins };
    await prisma.user.upsert({ where: { id: c.id }, update: data, create: { id: c.id, ...data } });
  }

  // The test client for phone + code sign-in (always gets the code 123456, nothing is sent)
  await ensureTestClient();

  // Riders
  for (const [n, d] of DRIVERS.entries()) {
    const user = { name: d.name, phone: d.phone, role: Role.DRIVER, passwordHash };
    await prisma.user.upsert({ where: { id: d.id }, update: user, create: { id: d.id, ...user } });
    const profile = {
      userId: d.id, name: d.name, phone: d.phone, runnerCode: d.code, avatarUrl: img(d.avatar), vehicleType: d.vehicle,
      vehicleRegNo: d.plate, emergencyPhone: d.phone, dutyStatus: d.duty, rating: d.rating, upiId: d.phone, // the rider's Wave / Orange Money number
    };
    await prisma.driverPartner.upsert({ where: { id: d.id }, update: profile, create: { id: d.id, ...profile } });
    if (d.duty !== DutyStatus.OFFLINE) {
      const pin = pinOf(d.quartier, n);
      const loc = { driverName: d.name, lat: pin.lat, lng: pin.lng, heading: 90, lastUpdated: new Date() };
      await prisma.driverLocation.upsert({ where: { driverId: d.id }, update: loc, create: { driverId: d.id, ...loc } });
    }
  }

  // Restaurants and menus
  const dishIds = new Map<string, string>(); // `${restaurant}/${dish}` -> MenuItem id
  const perQuartier = new Map<string, number>();
  for (const r of RESTAURANTS) {
    const nth = perQuartier.get(r.quartier) ?? 0;
    perQuartier.set(r.quartier, nth + 1);
    const pin = pinOf(r.quartier, nth);
    const ownerId = `demo-ven-user-${r.key}`;
    const owner = { name: `${r.owner.name} (${r.name})`, phone: r.owner.phone, role: Role.VENDOR, passwordHash };
    await prisma.user.upsert({ where: { id: ownerId }, update: owner, create: { id: ownerId, ...owner } });
    const vendor = {
      userId: ownerId, name: r.name, category: r.category, address: r.address, bannerImage: img(r.banner), eta: r.eta, lat: pin.lat, lng: pin.lng,
      locationSource: 'ADMIN', locationSetAt: new Date(),
      rating: r.rating, totalRatingsCount: r.ratings, isAcceptingOrders: true, fssaiNumber: r.ninea, // the column holds the NINEA
    };
    await prisma.vendor.upsert({ where: { id: `demo-ven-${r.key}` }, update: vendor, create: { id: `demo-ven-${r.key}`, ...vendor } });
    for (const d of r.dishes) {
      const id = `demo-item-${r.key}-${d.key}`;
      dishIds.set(`${r.key}/${d.key}`, id);
      const item = {
        vendorId: `demo-ven-${r.key}`, name: d.name, price: d.price, vendorPrice: d.price, category: d.category, description: d.description,
        imageUrl: img(d.key), isVeg: d.veg, isAvailable: true, rating: d.rating, ratingCount: d.ratingCount,
      };
      await prisma.menuItem.upsert({ where: { id }, update: item, create: { id, ...item } });
    }
  }

  // Orders (existing ones are left untouched)
  let created = 0;
  for (const [i, o] of ORDERS.entries()) {
    const id = `demo-ord-${i + 1}`;
    if (await prisma.order.findUnique({ where: { id }, select: { id: true } })) continue;
    const r = RESTAURANTS.find((x) => x.key === o.vendor)!;
    const customer = CUSTOMERS[o.customer];
    const lines = o.items.map(([key, qty]) => ({ dish: r.dishes.find((d) => d.key === key)!, qty }));
    const subtotal = lines.reduce((sum, l) => sum + l.dish.price * l.qty, 0);
    const total = subtotal + DELIVERY_FEE;
    const placed = new Date(now - o.ageHours * HOUR);
    const at = (min: number) => new Date(placed.getTime() + min * MIN);
    const paid = o.status !== 'PLACED' && o.status !== 'CANCELLED';
    const delivered = o.status === 'DELIVERED';
    const pickedUp = delivered || o.status === 'PICKED_UP';
    const reviewed = delivered && o.review !== undefined;

    await prisma.order.create({
      data: {
        id, customerId: customer.id, vendorId: `demo-ven-${o.vendor}`, driverId: o.driver !== null ? DRIVERS[o.driver].id : null,
        totalAmount: total, subtotal, vendorSubtotal: subtotal, deliveryFee: DELIVERY_FEE, dropoffHostel: customer.quartier,
        feeBreakdown: { version: 1, total: DELIVERY_FEE, baseFee: DELIVERY_FEE, baseWaived: false, smallOrderFee: 0, restaurants: 1, extraRestaurantFee: 0, extraRestaurants: 0, lines: [] },
        status: o.status, paymentStatus: paid ? PaymentStatus.PAID : PaymentStatus.PENDING, isReviewed: reviewed,
        createdAt: placed, paidAt: paid ? at(2) : null, acceptedAt: paid ? at(5) : null, pickedUpAt: pickedUp ? at(22) : null,
        deliveredAt: delivered ? at(38) : null, cancelledAt: o.status === 'CANCELLED' ? at(10) : null,
        cancelledBy: o.status === 'CANCELLED' ? 'VENDOR' : null, cancelReason: o.status === 'CANCELLED' ? o.note ?? null : null,
        items: { create: lines.map((l) => ({ menuItemId: dishIds.get(`${o.vendor}/${l.dish.key}`)!, name: l.dish.name, quantity: l.qty, price: l.dish.price, vendorUnitPrice: l.dish.price })) },
        ...(paid
          ? {
              payments: {
                create: {
                  razorpayOrderId: `rzp_order_sim_demo_${i + 1}`, razorpayPaymentId: `pay_sim_demo_${i + 1}`, amount: total, status: PaymentStatus.PAID,
                  capturedAmountPaise: Math.round(total * 100), method: PAYMENT_METHODS[i % PAYMENT_METHODS.length],
                },
              },
            }
          : {}),
      },
    });
    if (reviewed) {
      await prisma.reviewRecord.create({
        data: {
          orderId: id, customerId: customer.id, vendorId: `demo-ven-${o.vendor}`, driverId: o.driver !== null ? DRIVERS[o.driver].id : null,
          driverRating: o.review!, driverTags: o.review === 5 ? ['Polite', 'Fast'] : ['Polite'], driverNotes: '', dhabaNotes: '',
          dishReviews: lines.map((l) => ({ dishId: dishIds.get(`${o.vendor}/${l.dish.key}`)!, rating: o.review! })), createdAt: at(45),
        },
      });
    }
    created++;
  }

  const national = (phone: string) => phone.replace('+221 ', '');
  const text = [
    '# Kraveo DEMO accounts - Thies (local only - never commit, never share)',
    '',
    `Password for every restaurant and rider below: ${PASSWORD}`,
    '',
    'Restaurant app (phone -> restaurant):',
    ...RESTAURANTS.map((r) => `  ${national(r.owner.phone)}  ${r.name}`),
    '',
    'Rider app (phone -> rider):',
    ...DRIVERS.map((d) => `  ${national(d.phone)}  ${d.name} (${d.code})`),
    '',
    `Test client (phone + code sign-in): ${TEST_CLIENT.phone.replace('+221 ', '')}, code ${TEST_CLIENT.code}`,
    'Admin dashboard: the ADMIN_PASSCODE from .env.',
    'Customers sign in with Google (they have no password); the 6 demo customers only own the sample orders.',
    '',
  ];
  writeFileSync('DEMO_ACCOUNTS.local.txt', text.join('\n'), { mode: 0o600 });
  chmodSync('DEMO_ACCOUNTS.local.txt', 0o600);

  console.log(`Seed done: ${RESTAURANTS.length} restaurants, ${dishIds.size} dishes, ${DRIVERS.length} riders, ${CUSTOMERS.length} customers, ${created} new orders.`);
  console.log(`Image URLs use ${IMAGE_BASE}`);
  console.log('Accounts written to DEMO_ACCOUNTS.local.txt');
}

main()
  .catch((err) => {
    console.error('seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
