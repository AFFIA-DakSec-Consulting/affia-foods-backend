// Parsers for the back-office endpoints of the modular platform, support and reviews
// (backend/docs/MODULES_RECAP_FRONT.md and ADMIN_SUPPORT_STATS.md). Raw server data never reaches a component: it comes through here.
// Amounts are whole FCFA. Every parser tolerates missing fields; a row without an id is dropped.

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown, fallback = false): boolean => (typeof v === 'boolean' ? v : fallback);
const strList = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');

export interface Paged<T> { data: T[]; total: number; page: number; pageSize: number }

export const parsePaged = <T>(body: unknown, row: (raw: unknown) => T | null): Paged<T> => {
  const b = rec(body);
  const data = arr(b.data).map(row).filter((x): x is T => x !== null);
  return { data, total: num(b.total, data.length), page: num(b.page, 1), pageSize: num(b.pageSize, data.length || 25) };
};

export const parseList = <T>(body: unknown, row: (raw: unknown) => T | null): T[] => arr(rec(body).data ?? body).map(row).filter((x): x is T => x !== null);

// ───────────────────────── Modules ─────────────────────────

export type ModuleCategory = 'delivery' | 'courier' | 'marketing' | 'analytics' | string;

export interface PlatformModule {
  code: string;
  parentCode: string | null;
  name: string;
  description: string;
  category: ModuleCategory;
  isEnabled: boolean;
  isCore: boolean;
  /** Really active: its parent is on and its dependencies are met. */
  effective: boolean;
  requires: string[];
  requiresMode: string;
  settingsCount: number;
  blockedBy: string[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export const parseModule = (raw: unknown): PlatformModule | null => {
  const r = rec(raw);
  const code = str(r.code);
  if (!code) return null;
  return {
    code, parentCode: strOrNull(r.parentCode), name: str(r.name, code), description: str(r.description), category: str(r.category, 'other'),
    isEnabled: bool(r.isEnabled), isCore: bool(r.isCore), effective: bool(r.effective), requires: strList(r.requires), requiresMode: str(r.requiresMode, 'ALL'),
    settingsCount: num(r.settingsCount), blockedBy: strList(r.blockedBy), updatedAt: strOrNull(r.updatedAt), updatedBy: strOrNull(r.updatedBy),
  };
};

export interface ToggleResult { changed: string[]; modules: PlatformModule[] }
export const parseToggle = (body: unknown): ToggleResult => ({ changed: strList(rec(body).changed), modules: parseList(body, parseModule) });

export type SettingType = 'number' | 'money' | 'boolean' | 'string' | 'json';
export interface ModuleSetting {
  key: string;
  value: unknown;
  valueType: SettingType;
  unit: string | null;
  label: string;
  description: string;
  min: number | null;
  max: number | null;
  options: string[];
}

export const parseSetting = (raw: unknown): ModuleSetting | null => {
  const r = rec(raw);
  const key = str(r.key);
  if (!key) return null;
  const t = str(r.valueType);
  const valueType: SettingType = t === 'number' || t === 'money' || t === 'boolean' || t === 'string' ? t : 'json';
  return { key, value: r.value, valueType, unit: strOrNull(r.unit), label: str(r.label, key), description: str(r.description), min: numOrNull(r.min), max: numOrNull(r.max), options: strList(r.options) };
};

export interface SettingSaved { key: string; value: unknown; previous: unknown; changed: boolean }
export const parseSettingSaved = (body: unknown): SettingSaved => {
  const b = rec(body); const d = rec(b.data);
  return { key: str(d.key), value: d.value, previous: d.previous, changed: bool(b.changed) };
};

export interface AuditEntry { id: string; moduleCode: string | null; settingKey: string | null; action: string; oldValue: unknown; newValue: unknown; changedBy: string | null; changedAt: string }
export const parseAuditEntry = (raw: unknown): AuditEntry | null => {
  const r = rec(raw);
  const id = str(r.id);
  if (!id) return null;
  return { id, moduleCode: strOrNull(r.moduleCode), settingKey: strOrNull(r.settingKey), action: str(r.action), oldValue: r.oldValue ?? null, newValue: r.newValue ?? null, changedBy: strOrNull(r.changedBy), changedAt: str(r.changedAt) };
};

// ───────────────────────── Delivery zones ─────────────────────────

export interface Zone { label: string; minKm: number; maxKm: number | null; fee: number | null; courierPayout: number | null }
export interface ZoneRow extends Zone { id: string; city: string }

export const parseZone = (raw: unknown): ZoneRow | null => {
  const r = rec(raw);
  const id = str(r.id);
  if (!id) return null;
  return { id, city: str(r.city, 'default'), label: str(r.label), minKm: num(r.minKm), maxKm: numOrNull(r.maxKm), fee: numOrNull(r.fee), courierPayout: numOrNull(r.courierPayout) };
};

// ───────────────────────── Promotions ─────────────────────────

export const PROMO_TYPES = ['FREE_DELIVERY', 'PERCENT_OFF_DELIVERY', 'FIXED_OFF_DELIVERY', 'PERCENT_OFF_CART', 'FIXED_OFF_CART'] as const;
export type PromoType = (typeof PROMO_TYPES)[number];
export const PROMO_MODULES = ['marketing.promo_codes', 'marketing.first_order', 'marketing.free_delivery'] as const;
export type PromoFunding = 'PLATFORM' | 'MERCHANT' | 'SPLIT';

export interface Promotion {
  id: string;
  moduleCode: string;
  name: string;
  description: string;
  code: string | null;
  type: PromoType;
  value: number | null;
  fundedBy: PromoFunding;
  merchantSharePct: number;
  minCartAmount: number | null;
  maxDistanceKm: number | null;
  maxDiscountAmount: number | null;
  firstOrderOnly: boolean;
  eligibleMerchants: string[];
  maxUsesTotal: number | null;
  maxUsesPerUser: number | null;
  budgetTotal: number | null;
  budgetSpent: number;
  startsAt: string | null;
  endsAt: string | null;
  isActive: boolean;
  priority: number;
  stackable: boolean;
}

export const parsePromotion = (raw: unknown): Promotion | null => {
  const r = rec(raw);
  const id = str(r.id);
  if (!id) return null;
  const type = PROMO_TYPES.find((t) => t === r.type) ?? 'FIXED_OFF_CART';
  const funded = r.fundedBy === 'MERCHANT' || r.fundedBy === 'SPLIT' ? r.fundedBy : 'PLATFORM';
  return {
    id, moduleCode: str(r.moduleCode), name: str(r.name), description: str(r.description), code: strOrNull(r.code), type, value: numOrNull(r.value), fundedBy: funded,
    merchantSharePct: num(r.merchantSharePct), minCartAmount: numOrNull(r.minCartAmount), maxDistanceKm: numOrNull(r.maxDistanceKm), maxDiscountAmount: numOrNull(r.maxDiscountAmount),
    firstOrderOnly: bool(r.firstOrderOnly), eligibleMerchants: strList(r.eligibleMerchants), maxUsesTotal: numOrNull(r.maxUsesTotal), maxUsesPerUser: numOrNull(r.maxUsesPerUser), budgetTotal: numOrNull(r.budgetTotal),
    budgetSpent: num(r.budgetSpent), startsAt: strOrNull(r.startsAt), endsAt: strOrNull(r.endsAt), isActive: bool(r.isActive, true), priority: num(r.priority), stackable: bool(r.stackable),
  };
};

export interface PromotionStats { uses: number; distinctUsers: number; discountTotal: number; platformCost: number; merchantCost: number; budgetTotal: number | null; budgetSpent: number; budgetLeft: number | null }
export const parsePromotionStats = (body: unknown): PromotionStats => {
  const d = rec(rec(body).data ?? body);
  return { uses: num(d.uses), distinctUsers: num(d.distinctUsers), discountTotal: num(d.discountTotal), platformCost: num(d.platformCost), merchantCost: num(d.merchantCost), budgetTotal: numOrNull(d.budgetTotal), budgetSpent: num(d.budgetSpent), budgetLeft: numOrNull(d.budgetLeft) };
};

/** The body the server accepts to create or change a promotion (empty fields are left out so the server applies its defaults). */
export interface PromotionForm {
  moduleCode: string; type: PromoType; name: string; description: string; code: string; value: string;
  fundedBy: PromoFunding; merchantSharePct: string; minCartAmount: string; maxDistanceKm: string; maxDiscountAmount: string;
  firstOrderOnly: boolean; maxUsesTotal: string; maxUsesPerUser: string; budgetTotal: string; startsAt: string; endsAt: string;
  isActive: boolean; priority: string; stackable: boolean;
}

export const emptyPromotionForm = (): PromotionForm => ({
  moduleCode: 'marketing.promo_codes', type: 'PERCENT_OFF_CART', name: '', description: '', code: '', value: '', fundedBy: 'PLATFORM', merchantSharePct: '',
  minCartAmount: '', maxDistanceKm: '', maxDiscountAmount: '', firstOrderOnly: false, maxUsesTotal: '', maxUsesPerUser: '1', budgetTotal: '', startsAt: '', endsAt: '',
  isActive: true, priority: '0', stackable: false,
});

const dateInput = (iso: string | null): string => (iso ? iso.slice(0, 16) : '');
export const promotionToForm = (p: Promotion): PromotionForm => ({
  moduleCode: p.moduleCode, type: p.type, name: p.name, description: p.description, code: p.code ?? '', value: p.value === null ? '' : String(p.value), fundedBy: p.fundedBy,
  merchantSharePct: p.merchantSharePct ? String(p.merchantSharePct) : '', minCartAmount: p.minCartAmount === null ? '' : String(p.minCartAmount),
  maxDistanceKm: p.maxDistanceKm === null ? '' : String(p.maxDistanceKm), maxDiscountAmount: p.maxDiscountAmount === null ? '' : String(p.maxDiscountAmount),
  firstOrderOnly: p.firstOrderOnly, maxUsesTotal: p.maxUsesTotal === null ? '' : String(p.maxUsesTotal), maxUsesPerUser: p.maxUsesPerUser === null ? '' : String(p.maxUsesPerUser),
  budgetTotal: p.budgetTotal === null ? '' : String(p.budgetTotal), startsAt: dateInput(p.startsAt), endsAt: dateInput(p.endsAt), isActive: p.isActive, priority: String(p.priority), stackable: p.stackable,
});

const toNum = (s: string): number | undefined => { const t = s.trim().replace(',', '.'); return t === '' || !Number.isFinite(Number(t)) ? undefined : Number(t); };
const toNull = (s: string): number | null => toNum(s) ?? null;
const toIso = (s: string): string | null => { if (!s) return null; const d = new Date(s); return Number.isFinite(d.getTime()) ? d.toISOString() : null; };

/** Create body (code, type and module only on creation: the server refuses them on update). */
export const promotionBody = (f: PromotionForm, mode: 'create' | 'update'): Record<string, unknown> => {
  const body: Record<string, unknown> = {
    name: f.name.trim(), description: f.description.trim(), fundedBy: f.fundedBy,
    minCartAmount: toNull(f.minCartAmount), maxDistanceKm: toNull(f.maxDistanceKm), maxDiscountAmount: toNull(f.maxDiscountAmount),
    firstOrderOnly: f.firstOrderOnly, maxUsesTotal: toNull(f.maxUsesTotal), maxUsesPerUser: toNull(f.maxUsesPerUser), budgetTotal: toNull(f.budgetTotal),
    startsAt: toIso(f.startsAt), endsAt: toIso(f.endsAt), isActive: f.isActive, priority: toNum(f.priority) ?? 0, stackable: f.stackable,
  };
  if (f.type !== 'FREE_DELIVERY') body.value = toNum(f.value);
  if (f.fundedBy !== 'PLATFORM') body.merchantSharePct = toNum(f.merchantSharePct);
  if (mode === 'create') {
    body.moduleCode = f.moduleCode; body.type = f.type;
    if (f.code.trim()) body.code = f.code.trim().toUpperCase();
  }
  return body;
};

export const promoValueLabel = (p: Pick<Promotion, 'type' | 'value'>): string => {
  if (p.type === 'FREE_DELIVERY') return 'Livraison offerte';
  const v = p.value ?? 0;
  const n = v.toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  return p.type === 'PERCENT_OFF_CART' ? `-${n} % sur le panier` : p.type === 'PERCENT_OFF_DELIVERY' ? `-${n} % sur la livraison` : p.type === 'FIXED_OFF_CART' ? `-${n} FCFA sur le panier` : `-${n} FCFA sur la livraison`;
};

export type PromoState = 'inactive' | 'scheduled' | 'expired' | 'exhausted' | 'live';
export const promotionState = (p: Pick<Promotion, 'isActive' | 'startsAt' | 'endsAt' | 'budgetTotal' | 'budgetSpent'>, now: number = Date.now()): PromoState => {
  if (!p.isActive) return 'inactive';
  if (p.startsAt && new Date(p.startsAt).getTime() > now) return 'scheduled';
  if (p.endsAt && new Date(p.endsAt).getTime() <= now) return 'expired';
  if (p.budgetTotal !== null && p.budgetSpent >= p.budgetTotal) return 'exhausted';
  return 'live';
};

// ───────────────────────── Subscription plans, loyalty rules, courier bonuses ─────────────────────────

export interface SubscriptionPlan { id: string; name: string; description: string; price: number; durationDays: number; freeDeliveriesQuota: number | null; minCartAmount: number | null; maxDistanceKm: number | null; isActive: boolean }
export const parsePlan = (raw: unknown): SubscriptionPlan | null => {
  const r = rec(raw); const id = str(r.id);
  if (!id) return null;
  return { id, name: str(r.name), description: str(r.description), price: num(r.price), durationDays: num(r.durationDays, 30), freeDeliveriesQuota: numOrNull(r.freeDeliveriesQuota), minCartAmount: numOrNull(r.minCartAmount), maxDistanceKm: numOrNull(r.maxDistanceKm), isActive: bool(r.isActive, true) };
};

export const LOYALTY_TRIGGERS = ['ORDER_COMPLETED', 'SIGNUP', 'REFERRAL', 'REVIEW'] as const;
export type LoyaltyTrigger = (typeof LOYALTY_TRIGGERS)[number];
export const LOYALTY_TRIGGER_LABEL: Record<LoyaltyTrigger, string> = { ORDER_COMPLETED: 'Commande livrée', SIGNUP: 'Inscription', REFERRAL: 'Parrainage', REVIEW: 'Avis laissé' };
export interface LoyaltyRule { id: string; name: string; description: string; triggerType: LoyaltyTrigger; coinsAmount: number | null; coinsPercent: number | null; minCart: number | null; maxCoins: number | null; isActive: boolean }
export const parseLoyaltyRule = (raw: unknown): LoyaltyRule | null => {
  const r = rec(raw); const id = str(r.id);
  if (!id) return null;
  return { id, name: str(r.name), description: str(r.description), triggerType: LOYALTY_TRIGGERS.find((t) => t === r.triggerType) ?? 'ORDER_COMPLETED', coinsAmount: numOrNull(r.coinsAmount), coinsPercent: numOrNull(r.coinsPercent), minCart: numOrNull(r.minCart), maxCoins: numOrNull(r.maxCoins), isActive: bool(r.isActive, true) };
};

export const BONUS_TRIGGERS = ['RAIN', 'NIGHT', 'RUSH_HOUR', 'ZONE', 'MANUAL'] as const;
export type BonusTrigger = (typeof BONUS_TRIGGERS)[number];
export const BONUS_TRIGGER_LABEL: Record<BonusTrigger, string> = { RAIN: 'Pluie', NIGHT: 'Nuit', RUSH_HOUR: 'Heures de pointe', ZONE: 'Zone précise', MANUAL: 'Manuel' };
export interface CourierBonus { id: string; name: string; description: string; triggerType: BonusTrigger; amount: number; from: string; to: string; zoneId: string; isActive: boolean }
export const parseBonus = (raw: unknown): CourierBonus | null => {
  const r = rec(raw); const id = str(r.id);
  if (!id) return null;
  const c = rec(r.conditions);
  return { id, name: str(r.name), description: str(r.description), triggerType: BONUS_TRIGGERS.find((t) => t === r.triggerType) ?? 'MANUAL', amount: num(r.amount), from: str(c.from), to: str(c.to), zoneId: str(c.zoneId), isActive: bool(r.isActive, true) };
};

// ───────────────────────── Campaigns ─────────────────────────

export type CampaignStatus = 'DRAFT' | 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED';
export interface CampaignSegment { last_order_days_gt?: number; min_orders?: number; max_orders?: number; city?: string }
export interface Campaign { id: string; name: string; description: string; channel: string; segment: CampaignSegment; title: string; body: string; scheduledAt: string | null; status: CampaignStatus; sentCount: number; openedCount: number; convertedCount: number; createdAt: string }

export const parseCampaign = (raw: unknown): Campaign | null => {
  const r = rec(raw); const id = str(r.id);
  if (!id) return null;
  const s = rec(r.segment);
  const segment: CampaignSegment = {};
  if (numOrNull(s.last_order_days_gt) !== null) segment.last_order_days_gt = s.last_order_days_gt as number;
  if (numOrNull(s.min_orders) !== null) segment.min_orders = s.min_orders as number;
  if (numOrNull(s.max_orders) !== null) segment.max_orders = s.max_orders as number;
  if (typeof s.city === 'string' && s.city) segment.city = s.city;
  const status = (['DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED'] as const).find((x) => x === r.status) ?? 'DRAFT';
  return { id, name: str(r.name), description: str(r.description), channel: str(r.channel, 'PUSH'), segment, title: str(r.title), body: str(r.body), scheduledAt: strOrNull(r.scheduledAt), status, sentCount: num(r.sentCount), openedCount: num(r.openedCount), convertedCount: num(r.convertedCount), createdAt: str(r.createdAt) };
};

export interface CampaignStats { sent: number; failed: number; skipped: number; opened: number; converted: number; conversionRate: number }
export const parseCampaignStats = (body: unknown): CampaignStats => {
  const d = rec(rec(body).data ?? body);
  return { sent: num(d.sent), failed: num(d.failed), skipped: num(d.skipped), opened: num(d.opened), converted: num(d.converted), conversionRate: num(d.conversionRate) };
};

export interface CampaignSendResult { recipients: number; sent: number; skipped: number; failed: number; deferred: string | null }
export const parseSendResult = (body: unknown): CampaignSendResult => {
  const d = rec(rec(body).data ?? body);
  return { recipients: num(d.recipients), sent: num(d.sent), skipped: num(d.skipped), failed: num(d.failed), deferred: strOrNull(d.deferred) };
};

// ───────────────────────── Pricing simulator ─────────────────────────

export interface SimulationResult {
  customerPays: { food: number; delivery: number; total: number };
  courierPayout: number;
  deliverySubsidy: number;
  merchantContribution: number;
  margin: { commission: number; value: number; formula: string; deficit: boolean };
  marketingApplied: boolean;
  promotions: Array<{ name: string; discount: number }>;
  warnings: string[];
  /** Why a typed promo code gave nothing, or null. */
  codeProblem: string | null;
}

export const parseSimulation = (body: unknown): SimulationResult => {
  const d = rec(rec(body).data ?? body);
  const pays = rec(d.customerPays); const m = rec(d.margin);
  const marketing = d.step3_marketing;
  const applied = rec(marketing).applied ?? rec(marketing).promotions;
  const promotions = arr(applied).map((x) => { const p = rec(x); return { name: str(p.name, str(p.code, 'Promotion')), discount: num(p.discount ?? p.discountAmount ?? p.amount) }; });
  const snap = rec(d.snapshot);
  return {
    customerPays: { food: num(pays.food), delivery: num(pays.delivery), total: num(pays.total) },
    courierPayout: num(d.courierPayout), deliverySubsidy: num(d.deliverySubsidy), merchantContribution: num(d.merchantContribution),
    margin: { commission: num(m.commission), value: num(m.value), formula: str(m.formula), deficit: bool(m.deficit) },
    marketingApplied: marketing !== null && marketing !== undefined, promotions, warnings: strList(snap.warnings), codeProblem: strOrNull(rec(marketing).codeProblem),
  };
};

// ───────────────────────── Support tickets ─────────────────────────

export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export const TICKET_CATEGORIES = ['ORDER', 'PAYMENT', 'DELIVERY', 'FOOD_QUALITY', 'ACCOUNT', 'APP', 'OTHER'] as const;

export interface TicketUser { id: string; name: string; phone: string; role: string }
export interface TicketMessage { id: string; authorRole: string; body: string; internal: boolean; createdAt: string }
export interface Ticket {
  id: string; category: string; subject: string; status: TicketStatus; priority: TicketPriority; orderId: string | null; openedByRole: string;
  resolution: string | null; assignedTo: string | null; createdAt: string; lastMessageAt: string; firstResponseAt: string | null; messageCount: number;
  user: TicketUser | null; messages: TicketMessage[];
}

const parseTicketUser = (raw: unknown): TicketUser | null => { const r = rec(raw); const id = str(r.id); return id ? { id, name: str(r.name, 'Sans nom'), phone: str(r.phone), role: str(r.role) } : null; };
export const parseTicketMessage = (raw: unknown): TicketMessage | null => {
  const r = rec(raw); const id = str(r.id);
  return id ? { id, authorRole: str(r.authorRole), body: str(r.body), internal: bool(r.internal), createdAt: str(r.createdAt) } : null;
};
export const parseTicket = (raw: unknown): Ticket | null => {
  const r = rec(raw); const id = str(r.id);
  if (!id) return null;
  const messages = arr(r.messages).map(parseTicketMessage).filter((m): m is TicketMessage => m !== null);
  return {
    id, category: str(r.category, 'OTHER'), subject: str(r.subject), status: TICKET_STATUSES.find((s) => s === r.status) ?? 'OPEN', priority: TICKET_PRIORITIES.find((p) => p === r.priority) ?? 'NORMAL',
    orderId: strOrNull(r.orderId), openedByRole: str(r.openedByRole), resolution: strOrNull(r.resolution), assignedTo: strOrNull(r.assignedTo), createdAt: str(r.createdAt),
    lastMessageAt: str(r.lastMessageAt), firstResponseAt: strOrNull(r.firstResponseAt), messageCount: num(r.messageCount, messages.length), user: parseTicketUser(r.user), messages,
  };
};

export interface SupportStats { open: number; inProgress: number; resolved: number; closed: number; total: number; avgFirstResponseMinutes: number | null; avgResolutionHours: number | null }
export const parseSupportStats = (body: unknown): SupportStats => {
  const d = rec(rec(body).data ?? body);
  return { open: num(d.open), inProgress: num(d.inProgress), resolved: num(d.resolved), closed: num(d.closed), total: num(d.total), avgFirstResponseMinutes: numOrNull(d.avgFirstResponseMinutes), avgResolutionHours: numOrNull(d.avgResolutionHours) };
};

// ───────────────────────── Reviews ─────────────────────────

export interface DishReview { name: string; rating: number | null; comment: string }
export interface Review {
  id: string; orderId: string; createdAt: string; driverRating: number; driverTags: string[]; driverNotes: string | null; restaurantNotes: string | null;
  dishReviews: DishReview[]; customer: string; restaurant: string; restaurantId: string; driver: string | null;
  flagged: boolean; flagReason: string | null; flaggedBy: string | null; flaggedAt: string | null;
}

export const parseReview = (raw: unknown): Review | null => {
  const r = rec(raw); const id = str(r.id);
  if (!id) return null;
  const dishes = arr(r.dishReviews).map((x): DishReview => { const d = rec(x); return { name: str(d.name ?? d.dishName, 'Plat'), rating: numOrNull(d.rating), comment: str(d.comment ?? d.notes) }; });
  return {
    id, orderId: str(r.orderId), createdAt: str(r.createdAt), driverRating: num(r.driverRating), driverTags: strList(r.driverTags), driverNotes: strOrNull(r.driverNotes), restaurantNotes: strOrNull(r.restaurantNotes),
    dishReviews: dishes, customer: str(rec(r.customer).name, 'Client'), restaurant: str(rec(r.restaurant).name, 'Restaurant'), restaurantId: str(rec(r.restaurant).id), driver: strOrNull(rec(r.driver).name),
    flagged: bool(r.flagged), flagReason: strOrNull(r.flagReason), flaggedBy: strOrNull(r.flaggedBy), flaggedAt: strOrNull(r.flaggedAt),
  };
};

export interface ReviewStats { count: number; averageDriverRating: number | null; averageDishRating: number | null; lowRated: number; flaggedOpen: number; distribution: Record<string, number>; countChangePct: number | null }
export const parseReviewStats = (body: unknown): ReviewStats => {
  const d = rec(rec(body).data ?? body);
  const dist: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(d.distribution))) dist[k] = num(v);
  return { count: num(d.count), averageDriverRating: numOrNull(d.averageDriverRating), averageDishRating: numOrNull(d.averageDishRating), lowRated: num(d.lowRated), flaggedOpen: num(d.flaggedOpen), distribution: dist, countChangePct: numOrNull(d.countChangePct) };
};

// ───────────────────────── Dashboard statistics (ADMIN_SUPPORT_STATS.md) ─────────────────────────

export type StatsRange = 'today' | '7d' | '30d' | '90d';
export interface Compare { current: number; previous: number; change: number; changePct: number | null }
const parseCompare = (raw: unknown): Compare => { const r = rec(raw); return { current: num(r.current), previous: num(r.previous), change: num(r.change), changePct: numOrNull(r.changePct) }; };

export interface LiveCounts { inProgress: number; awaitingRestaurant: number; preparing: number; readyForPickup: number; onTheWay: number; withoutRider: number; stuck: number; awaitingPayment: number }
export const parseLiveCounts = (raw: unknown): LiveCounts => {
  const r = rec(rec(raw).counts ?? raw);
  return { inProgress: num(r.inProgress), awaitingRestaurant: num(r.awaitingRestaurant), preparing: num(r.preparing), readyForPickup: num(r.readyForPickup), onTheWay: num(r.onTheWay), withoutRider: num(r.withoutRider), stuck: num(r.stuck), awaitingPayment: num(r.awaitingPayment) };
};

export interface PartnerCounts { total: number; approved: number; pending: number; suspended: number; rejected: number; active: number }
const parsePartners = (raw: unknown, activeKey: string): PartnerCounts => { const r = rec(raw); return { total: num(r.total), approved: num(r.approved), pending: num(r.pending), suspended: num(r.suspended), rejected: num(r.rejected), active: num(r[activeKey]) }; };

export interface Overview {
  range: { from: string; to: string; days: number };
  orders: { total: number; delivered: number; cancelled: number; inProgress: number; rejectedByRestaurant: number; cancelledBy: Record<string, number>; totalChangePct: number | null; deliveredChangePct: number | null; previousTotal: number; previousDelivered: number };
  live: LiveCounts;
  signups: { clients: Compare; restaurants: Compare; drivers: Compare };
  restaurants: PartnerCounts;
  drivers: PartnerCounts;
  reviews: ReviewStats;
  support: SupportStats;
}

export const parseOverview = (body: unknown): Overview => {
  const d = rec(rec(body).data ?? body);
  const o = rec(d.orders); const prev = rec(o.previous); const sg = rec(d.signups); const pt = rec(d.partners); const rg = rec(d.range);
  const by: Record<string, number> = {};
  for (const [k, v] of Object.entries(rec(o.cancelledBy))) by[k] = num(v);
  return {
    range: { from: str(rg.from), to: str(rg.to), days: num(rg.days) },
    orders: { total: num(o.total), delivered: num(o.delivered), cancelled: num(o.cancelled), inProgress: num(o.inProgress), rejectedByRestaurant: num(o.rejectedByRestaurant), cancelledBy: by, totalChangePct: numOrNull(o.totalChangePct), deliveredChangePct: numOrNull(o.deliveredChangePct), previousTotal: num(prev.total), previousDelivered: num(prev.delivered) },
    live: parseLiveCounts(d.live),
    signups: { clients: parseCompare(sg.clients), restaurants: parseCompare(sg.restaurants), drivers: parseCompare(sg.drivers) },
    restaurants: parsePartners(pt.restaurants, 'acceptingOrders'), drivers: parsePartners(pt.drivers, 'onDuty'),
    reviews: parseReviewStats({ data: d.reviews }), support: parseSupportStats({ data: d.support }),
  };
};

// ───────────────────────── Team activity log and payment reconciliation ─────────────────────────

export interface TeamAuditEntry { id: string; action: string; targetType: string; targetId: string; summary: string; createdAt: string }
export const parseTeamAudit = (raw: unknown): TeamAuditEntry | null => {
  const r = rec(raw); const id = str(r.id);
  return id ? { id, action: str(r.action), targetType: str(r.targetType), targetId: str(r.targetId), summary: str(r.summary), createdAt: str(r.createdAt) } : null;
};

export interface OrphanPayment { paymentId: string; orderId: string | null; amount: number; createdAt: string | null; kraveoOrderId: string | null; kraveoPaymentStatus: string | null }
export interface OrphanReport { from: string; to: string; scanned: number; truncated: boolean; orphans: OrphanPayment[] }
// `amountPaise` is the backend's internal scale: 100 "paise" = 1 FCFA (backend config/currency.ts).
export const parseOrphanReport = (body: unknown): OrphanReport => {
  const b = rec(body);
  const orphans = arr(b.data).map((x): OrphanPayment | null => {
    const r = rec(x); const paymentId = str(r.paymentId);
    return paymentId ? { paymentId, orderId: strOrNull(r.razorpayOrderId), amount: num(r.amountPaise) / 100, createdAt: strOrNull(r.createdAt), kraveoOrderId: strOrNull(r.kraveoOrderId), kraveoPaymentStatus: strOrNull(r.kraveoPaymentStatus) } : null;
  }).filter((x): x is OrphanPayment => x !== null);
  return { from: str(b.from), to: str(b.to), scanned: num(b.scanned), truncated: bool(b.truncated), orphans };
};

// ───────────────────────── Referral (sponsorship) ─────────────────────────

export type ReferralStatus = 'PENDING' | 'REWARDED' | 'CANCELLED';
export interface Person { id: string; name: string; phone: string | null }
export interface Referral { id: string; code: string; status: ReferralStatus; createdAt: string; rewardedAt: string | null; referrer: Person | null; referee: Person | null }

const parsePerson = (raw: unknown): Person | null => { const r = rec(raw); const id = str(r.id); return id ? { id, name: str(r.name, 'Client'), phone: strOrNull(r.phone) } : null; };
export const parseReferral = (raw: unknown): Referral | null => {
  const r = rec(raw); const id = str(r.id);
  if (!id) return null;
  const status = (['PENDING', 'REWARDED', 'CANCELLED'] as const).find((s) => s === r.status) ?? 'PENDING';
  return { id, code: str(r.code), status, createdAt: str(r.createdAt), rewardedAt: strOrNull(r.rewardedAt), referrer: parsePerson(r.referrer), referee: parsePerson(r.referee) };
};

export interface ReferralStats { total: number; pending: number; rewarded: number; cancelled: number; conversionRate: number; topReferrers: Array<{ id: string; name: string; referrals: number; rewarded: number }> }
export const parseReferralStats = (body: unknown): ReferralStats => {
  const d = rec(rec(body).data ?? body);
  const topReferrers = arr(d.topReferrers).map((x) => { const t = rec(x); return { id: str(t.id), name: str(t.name, 'Client'), referrals: num(t.referrals), rewarded: num(t.rewarded) }; }).filter((t) => t.id);
  return { total: num(d.total), pending: num(d.pending), rewarded: num(d.rewarded), cancelled: num(d.cancelled), conversionRate: num(d.conversionRate), topReferrers };
};

// ───────────────────────── Legal documents and help articles ─────────────────────────

export const LEGAL_TYPES = ['TERMS', 'PRIVACY', 'REFUNDS', 'CONTRACT_VENDOR', 'CONTRACT_DRIVER'] as const;
export type LegalType = (typeof LEGAL_TYPES)[number];
export const LEGAL_TYPE_LABEL: Record<LegalType, string> = {
  TERMS: 'Conditions d’utilisation', PRIVACY: 'Politique de confidentialité', REFUNDS: 'Politique de remboursement',
  CONTRACT_VENDOR: 'Contrat restaurant', CONTRACT_DRIVER: 'Contrat livreur',
};
/** The two screens share one list: "Documents légaux" shows the first three, "Contrats" the last two. */
export const LEGAL_SCOPES = { legal: ['TERMS', 'PRIVACY', 'REFUNDS'], contracts: ['CONTRACT_VENDOR', 'CONTRACT_DRIVER'] } as const satisfies Record<string, readonly LegalType[]>;

export interface LegalDocument {
  id: string; type: LegalType; locale: string; version: number; title: string; content: string;
  status: 'DRAFT' | 'PUBLISHED'; isActive: boolean; publishedAt: string | null; createdAt: string; updatedAt: string;
}
export const parseLegalDocument = (raw: unknown): LegalDocument | null => {
  const r = rec(raw); const id = str(r.id);
  const type = LEGAL_TYPES.find((t) => t === r.type);
  if (!id || !type) return null;
  return { id, type, locale: str(r.locale, 'fr'), version: num(r.version, 1), title: str(r.title), content: str(r.content), status: r.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT', isActive: bool(r.isActive), publishedAt: strOrNull(r.publishedAt), createdAt: str(r.createdAt), updatedAt: str(r.updatedAt) };
};

export const HELP_AUDIENCES = ['ALL', 'CLIENT', 'VENDOR', 'DRIVER'] as const;
export type HelpAudience = (typeof HELP_AUDIENCES)[number];
export const HELP_AUDIENCE_LABEL: Record<HelpAudience, string> = { ALL: 'Tout le monde', CLIENT: 'Clients', VENDOR: 'Restaurants', DRIVER: 'Livreurs' };
export interface HelpArticle { id: string; slug: string; theme: string; audience: HelpAudience; title: string; content: string; isPublished: boolean; sortOrder: number; updatedAt: string }
export const parseHelpArticle = (raw: unknown): HelpArticle | null => {
  const r = rec(raw); const id = str(r.id);
  if (!id) return null;
  return { id, slug: str(r.slug), theme: str(r.theme, 'Autres'), audience: HELP_AUDIENCES.find((a) => a === r.audience) ?? 'ALL', title: str(r.title), content: str(r.content), isPublished: bool(r.isPublished), sortOrder: num(r.sortOrder), updatedAt: str(r.updatedAt) };
};

/** A slug from a title: lowercase, no accents, single dashes. */
export const slugify = (title: string): string => title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

// ───────────────────────── Team ─────────────────────────

export interface TeamMember { id: string; name: string; phone: string | null; role: string; isOwner: boolean; dormant: boolean; disabled: boolean; twoFactor: boolean; lastLoginAt: string | null; createdAt: string }
export const parseTeamMember = (raw: unknown): TeamMember | null => {
  const r = rec(raw); const id = str(r.id);
  return id ? { id, name: str(r.name, 'Sans nom'), phone: strOrNull(r.phone), role: str(r.role, 'SUPER_ADMIN'), isOwner: bool(r.isOwner), dormant: bool(r.dormant), disabled: bool(r.disabled), twoFactor: bool(r.twoFactor), lastLoginAt: strOrNull(r.lastLoginAt), createdAt: str(r.createdAt) } : null;
};
export type AccessLevel = 'read' | 'write';
export interface TeamMe { role: string; permissions: string[]; access: Record<string, AccessLevel>; twoFactor: boolean; backupCodesLeft: number }
export const parseTeamMe = (body: unknown): TeamMe | null => {
  const d = rec(rec(body).data ?? body);
  if (typeof d.role !== 'string') return null;
  const access: Record<string, AccessLevel> = {};
  for (const [k, v] of Object.entries(rec(d.access))) if (v === 'read' || v === 'write') access[k] = v;
  return { role: d.role, permissions: strList(d.permissions), access, twoFactor: bool(d.twoFactor), backupCodesLeft: num(d.backupCodesLeft) };
};

export interface AdminSessionRow { id: string; ip: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; current: boolean }
export const parseAdminSession = (raw: unknown): AdminSessionRow | null => {
  const r = rec(raw); const id = str(r.id);
  return id ? { id, ip: strOrNull(r.ip), userAgent: strOrNull(r.userAgent), createdAt: str(r.createdAt), lastSeenAt: str(r.lastSeenAt), current: bool(r.current) } : null;
};
export interface TwoFactorSetup { secret: string; otpauthUrl: string }
export const parseTwoFactorSetup = (body: unknown): TwoFactorSetup | null => {
  const d = rec(rec(body).data ?? body);
  return typeof d.secret === 'string' && d.secret ? { secret: d.secret, otpauthUrl: str(d.otpauthUrl) } : null;
};

/** A readable name for a browser, from its user-agent text ("Chrome sur macOS"). Unknown agents are shown as "Navigateur". */
export const describeAgent = (ua: string | null): string => {
  if (!ua) return 'Navigateur inconnu';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navigateur';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} sur ${os}` : browser;
};

/** The secret in groups of four, easier to type in an authenticator app. */
export const groupSecret = (secret: string): string => secret.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();

// ───────────────────────── Prospecting ─────────────────────────

export const PROSPECT_STAGES = ['TO_CONTACT', 'CONTACTED', 'FOLLOW_UP', 'INTERESTED', 'SIGNED', 'REJECTED'] as const;
export type ProspectStage = (typeof PROSPECT_STAGES)[number];
export const STAGE_LABEL: Record<ProspectStage, string> = { TO_CONTACT: 'À contacter', CONTACTED: 'Contactés', FOLLOW_UP: 'À relancer', INTERESTED: 'Intéressés', SIGNED: 'Signés', REJECTED: 'Refusés' };
export type ProspectKind = 'RESTAURANT' | 'DRIVER';
export const EVENT_TYPES = ['NOTE', 'CALL', 'VISIT', 'WHATSAPP'] as const;
export const EVENT_LABEL: Record<string, string> = { NOTE: 'Note', CALL: 'Appel', VISIT: 'Visite', WHATSAPP: 'WhatsApp', STAGE: 'Étape' };

export interface Prospect {
  id: string; kind: ProspectKind; businessName: string; contactName: string | null; phone: string | null; email: string | null; city: string; district: string | null;
  category: string | null; source: string | null; fit: 'A' | 'B' | 'C' | null; stage: ProspectStage; nextFollowUpAt: string | null; lastContactedAt: string | null; createdAt: string;
}
export interface ProspectEvent { id: string; type: string; body: string; createdAt: string }
export interface ProspectDetail extends Prospect { events: ProspectEvent[] }

export const parseProspect = (raw: unknown): Prospect | null => {
  const r = rec(raw); const id = str(r.id);
  if (!id) return null;
  return {
    id, kind: r.kind === 'DRIVER' ? 'DRIVER' : 'RESTAURANT', businessName: str(r.businessName), contactName: strOrNull(r.contactName), phone: strOrNull(r.phone), email: strOrNull(r.email),
    city: str(r.city, 'Thiès'), district: strOrNull(r.district), category: strOrNull(r.category), source: strOrNull(r.source),
    fit: r.fit === 'A' || r.fit === 'B' || r.fit === 'C' ? r.fit : null, stage: PROSPECT_STAGES.find((s) => s === r.stage) ?? 'TO_CONTACT',
    nextFollowUpAt: strOrNull(r.nextFollowUpAt), lastContactedAt: strOrNull(r.lastContactedAt), createdAt: str(r.createdAt),
  };
};
export const parseProspectDetail = (raw: unknown): ProspectDetail | null => {
  const base = parseProspect(raw);
  if (!base) return null;
  const events = arr(rec(raw).events).map((x): ProspectEvent | null => { const e = rec(x); const id = str(e.id); return id ? { id, type: str(e.type, 'NOTE'), body: str(e.body), createdAt: str(e.createdAt) } : null; }).filter((e): e is ProspectEvent => e !== null);
  return { ...base, events };
};

export interface ProspectStats { total: number; counts: Record<ProspectStage, number>; overdue: number; conversionRate: number }
export const parseProspectStats = (body: unknown): ProspectStats => {
  const d = rec(rec(body).data ?? body); const c = rec(d.counts);
  const counts = Object.fromEntries(PROSPECT_STAGES.map((s) => [s, num(c[s])])) as Record<ProspectStage, number>;
  return { total: num(d.total), counts, overdue: num(d.overdue), conversionRate: num(d.conversionRate) };
};

/** A follow-up date that is already past, for a contact that is still being worked. */
export const isOverdue = (p: Pick<Prospect, 'stage' | 'nextFollowUpAt'>, now: number = Date.now()): boolean =>
  p.stage !== 'SIGNED' && p.stage !== 'REJECTED' && p.nextFollowUpAt !== null && new Date(p.nextFollowUpAt).getTime() < now;

// ───────────────────────── Service areas (where the app is available) ─────────────────────────

export interface ServiceArea { id: string; name: string; lat: number; lng: number; radiusKm: number; isActive: boolean }
export const parseServiceArea = (raw: unknown): ServiceArea | null => {
  const r = rec(raw); const id = str(r.id);
  return id ? { id, name: str(r.name), lat: num(r.lat), lng: num(r.lng), radiusKm: num(r.radiusKm), isActive: bool(r.isActive, true) } : null;
};

export interface ServiceAreasInfo { areas: ServiceArea[]; restricted: boolean; maxAreas: number }
export const parseServiceAreas = (body: unknown): ServiceAreasInfo => {
  const b = rec(body); const meta = rec(b.meta);
  return { areas: parseList(body, parseServiceArea), restricted: bool(meta.restricted), maxAreas: num(meta.maxAreas, 50) };
};

export interface PointVerdict { served: boolean; area: string | null; message: string | null }
export interface PointCheck { restricted: boolean; inCountry: boolean; vendor: PointVerdict; customer: PointVerdict }
const parseVerdict = (raw: unknown): PointVerdict => { const r = rec(raw); return { served: bool(r.served), area: strOrNull(rec(r.area).name), message: strOrNull(r.message) }; };
export const parsePointCheck = (body: unknown): PointCheck => {
  const d = rec(rec(body).data ?? body);
  return { restricted: bool(d.restricted), inCountry: bool(d.inCountry), vendor: parseVerdict(d.vendor), customer: parseVerdict(d.customer) };
};

/** The form of a zone, as typed. Coordinates keep every decimal the admin gave. */
export interface AreaForm { name: string; lat: string; lng: string; radiusKm: string; isActive: boolean }
export const areaBody = (f: AreaForm): { ok: true; body: Record<string, unknown> } | { ok: false; field: keyof AreaForm; message: string } => {
  const n = (v: string) => (v.trim() === '' ? NaN : Number(v.trim().replace(',', '.')));
  if (f.name.trim().length < 2) return { ok: false, field: 'name', message: 'Donnez un nom (2 caractères minimum).' };
  const lat = n(f.lat); const lng = n(f.lng); const radius = n(f.radiusKm);
  if (!Number.isFinite(lat) || Math.abs(lat) > 90) return { ok: false, field: 'lat', message: 'La latitude est un nombre entre -90 et 90 (par exemple 14.7886).' };
  if (!Number.isFinite(lng) || Math.abs(lng) > 180) return { ok: false, field: 'lng', message: 'La longitude est un nombre entre -180 et 180 (par exemple -16.926).' };
  if (!Number.isFinite(radius) || radius < 0.5 || radius > 500) return { ok: false, field: 'radiusKm', message: 'Le rayon est entre 0,5 et 500 km.' };
  return { ok: true, body: { name: f.name.trim(), lat, lng, radiusKm: radius, isActive: f.isActive } };
};
