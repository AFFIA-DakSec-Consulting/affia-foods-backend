import { describe, expect, it } from 'vitest';
import {
  emptyPromotionForm, parseBonus, parseCampaign, parseModule, parsePaged, parsePromotion, parseSetting, parseSimulation, parseTicket, parseToggle,
  promoValueLabel, promotionBody, promotionState, promotionToForm,
} from './platformParse';

describe('platformParse', () => {
  it('drops rows without an id and keeps the server page', () => {
    const page = parsePaged({ data: [{ id: 'a', name: 'x', type: 'FREE_DELIVERY' }, { name: 'no id' }, null], total: 7, page: 2, pageSize: 25 }, parsePromotion);
    expect(page.data.map((p) => p.id)).toEqual(['a']);
    expect(page).toMatchObject({ total: 7, page: 2, pageSize: 25 });
  });

  it('reads a module with its blockers and an unknown setting type as json', () => {
    const m = parseModule({ code: 'marketing.promo_codes', parentCode: 'marketing', name: 'Codes', isEnabled: true, effective: false, blockedBy: ['marketing'], requires: [] });
    expect(m).toMatchObject({ isEnabled: true, effective: false, blockedBy: ['marketing'], parentCode: 'marketing' });
    expect(parseSetting({ key: 'rush_hours', valueType: 'weird', value: [] })?.valueType).toBe('json');
    expect(parseToggle({ changed: ['a', 'b'], data: [{ code: 'a' }] })).toMatchObject({ changed: ['a', 'b'] });
  });

  it('builds a create body: no value for free delivery, code upper-cased, empty numbers null', () => {
    const form = { ...emptyPromotionForm(), name: ' Bienvenue ', description: 'Offre', code: 'bienvenue', type: 'FREE_DELIVERY' as const, minCartAmount: '2500' };
    const body = promotionBody(form, 'create');
    expect(body).toMatchObject({ name: 'Bienvenue', code: 'BIENVENUE', type: 'FREE_DELIVERY', moduleCode: 'marketing.promo_codes', maxDiscountAmount: null, minCartAmount: 2500 });
    expect('value' in body).toBe(false);
  });

  it('never sends code, type or module on update', () => {
    const body = promotionBody({ ...emptyPromotionForm(), name: 'A', description: 'B', code: 'X', value: '10' }, 'update');
    expect(body).not.toHaveProperty('code');
    expect(body).not.toHaveProperty('type');
    expect(body).not.toHaveProperty('moduleCode');
    expect(body.value).toBe(10);
  });

  it('round-trips a promotion through the form', () => {
    const p = parsePromotion({ id: '1', moduleCode: 'marketing.promo_codes', name: 'N', description: 'D', code: 'KRAVEO20', type: 'PERCENT_OFF_CART', value: 20, budgetTotal: 50000, isActive: true })!;
    expect(promotionBody(promotionToForm(p), 'update')).toMatchObject({ value: 20, budgetTotal: 50000, isActive: true, fundedBy: 'PLATFORM' });
  });

  it('describes a promotion and its state', () => {
    expect(promoValueLabel({ type: 'FREE_DELIVERY', value: null })).toBe('Livraison offerte');
    expect(promoValueLabel({ type: 'PERCENT_OFF_CART', value: 20 })).toBe('-20 % sur le panier');
    const now = Date.parse('2026-10-16T12:00:00Z');
    const base = { isActive: true, startsAt: null, endsAt: null, budgetTotal: null, budgetSpent: 0 };
    expect(promotionState(base, now)).toBe('live');
    expect(promotionState({ ...base, isActive: false }, now)).toBe('inactive');
    expect(promotionState({ ...base, startsAt: '2026-11-01T00:00:00Z' }, now)).toBe('scheduled');
    expect(promotionState({ ...base, endsAt: '2026-10-01T00:00:00Z' }, now)).toBe('expired');
    expect(promotionState({ ...base, budgetTotal: 1000, budgetSpent: 1000 }, now)).toBe('exhausted');
  });

  it('reads bonus conditions and campaign segments', () => {
    expect(parseBonus({ id: 'b', triggerType: 'NIGHT', amount: 200, conditions: { from: '22:00', to: '05:00' } })).toMatchObject({ from: '22:00', to: '05:00' });
    expect(parseCampaign({ id: 'c', status: 'SCHEDULED', segment: { last_order_days_gt: 30, junk: 1 } })!.segment).toEqual({ last_order_days_gt: 30 });
    expect(parseCampaign({ id: 'c', status: 'WHATEVER' })?.status).toBe('DRAFT');
  });

  it('reads a ticket thread and a simulation', () => {
    const t = parseTicket({ id: 't', status: 'IN_PROGRESS', priority: 'URGENT', user: { id: 'u', name: 'Awa' }, messages: [{ id: 'm', body: 'Bonjour', internal: true, authorRole: 'ADMIN' }, { body: 'no id' }] })!;
    expect(t.messages).toHaveLength(1);
    expect(t.messages[0].internal).toBe(true);
    const sim = parseSimulation({ data: { customerPays: { food: 9000, delivery: 500, total: 9500 }, courierPayout: 700, margin: { commission: 1500, value: 800, deficit: false }, step3_marketing: { applied: [{ name: 'KRAVEO20', discount: 1000 }], codeProblem: null } } });
    expect(sim.customerPays.total).toBe(9500);
    expect(sim.promotions).toEqual([{ name: 'KRAVEO20', discount: 1000 }]);
    expect(parseSimulation({ data: { step3_marketing: null } }).marketingApplied).toBe(false);
  });
});

import { parseLiveCounts, parseOrphanReport, parseOverview, parseTeamAudit } from './platformParse';
import { changeNote } from '../components/OverviewStats';

describe('dashboard statistics', () => {
  it('reads the overview, with the previous period and the partner counts', () => {
    const o = parseOverview({ data: {
      range: { from: '2026-10-09', to: '2026-10-15', days: 7 },
      orders: { total: 120, delivered: 88, cancelled: 14, rejectedByRestaurant: 5, cancelledBy: { VENDOR: 5 }, previous: { total: 100, delivered: 70 }, totalChangePct: 20 },
      live: { inProgress: 6, withoutRider: 1 }, signups: { clients: { current: 40, previous: 32, change: 8, changePct: 25 } },
      partners: { restaurants: { total: 6, approved: 5, pending: 1, acceptingOrders: 4 }, drivers: { total: 3, approved: 3, onDuty: 2 } },
      reviews: { count: 30, averageDriverRating: 4.6, lowRated: 2 }, support: { open: 3, avgFirstResponseMinutes: 14.5 },
    } });
    expect(o.orders).toMatchObject({ total: 120, previousTotal: 100, totalChangePct: 20, rejectedByRestaurant: 5 });
    expect(o.restaurants).toMatchObject({ approved: 5, active: 4, pending: 1 });
    expect(o.drivers.active).toBe(2);
    expect(o.signups.clients.changePct).toBe(25);
    expect(o.live.withoutRider).toBe(1);
    expect(o.support.avgFirstResponseMinutes).toBe(14.5);
  });

  it('survives an empty answer', () => {
    const o = parseOverview({});
    expect(o.orders.total).toBe(0);
    expect(o.reviews.averageDriverRating).toBeNull();
    expect(parseLiveCounts({ counts: { stuck: 2 } }).stuck).toBe(2);
  });

  it('never divides by zero in the wording', () => {
    expect(changeNote(20, 12, 10)).toBe('+20 % vs période précédente');
    expect(changeNote(-5.5, 9, 10)).toBe('-5,5 % vs période précédente');
    expect(changeNote(null, 3, 0)).toBe('Rien sur la période précédente');
    expect(changeNote(null, 0, 0)).toBe('');
  });

  it('reads orphan payments (backend scale: 100 "paise" = 1 FCFA) and team log rows', () => {
    const r = parseOrphanReport({ scanned: 40, truncated: false, data: [{ paymentId: 'pay_1', amountPaise: 150000, kraveoOrderId: null }, { amountPaise: 1 }] });
    expect(r.orphans).toEqual([{ paymentId: 'pay_1', orderId: null, amount: 1500, createdAt: null, kraveoOrderId: null, kraveoPaymentStatus: null }]);
    expect(parseTeamAudit({ id: 'a', action: 'REVIEW_FLAGGED', summary: 's' })?.action).toBe('REVIEW_FLAGGED');
    expect(parseTeamAudit({ action: 'x' })).toBeNull();
  });
});

import { parseReferral, parseReferralStats } from './platformParse';
describe('referral', () => {
  it('reads a sponsorship and its stats', () => {
    const r = parseReferral({ id: 'r', code: 'AWA', status: 'REWARDED', createdAt: 'x', referrer: { id: 'a', name: 'Awa' }, referee: { name: 'no id' } })!;
    expect(r).toMatchObject({ status: 'REWARDED', referrer: { name: 'Awa', phone: null }, referee: null });
    expect(parseReferral({ id: 'r', status: 'WEIRD' })?.status).toBe('PENDING');
    const s = parseReferralStats({ data: { total: 6, rewarded: 3, conversionRate: 50, topReferrers: [{ id: 'a', name: 'Awa', referrals: 3, rewarded: 2 }, { name: 'no id' }] } });
    expect(s.topReferrers).toHaveLength(1);
    expect(s.conversionRate).toBe(50);
  });
});
