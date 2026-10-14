import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bell, BellOff, Check, ChefHat, CheckCircle2, Circle, Clock3, FileText, Flame, ImageIcon, Loader2, MapPin, Phone, PackageCheck, ShoppingBag, Store, Utensils, Wallet, X } from 'lucide-react';
import { Order, OrderStatus, Vendor } from '../types';
import { SLA, orderCode } from '../lib/orders';
import { dakarDay } from '../lib/homeStats';
import { DAYS, dayText, isOpenNow } from '../lib/vendorProfile';
import { ProfileStep, RestaurantBoard, boardOf, waitLabel, dayFigures, firstName, hourlySales, minutesSince, profileProgress, restaurantOrders, topDishes } from '../lib/restaurantStats';
import { inr } from '../lib/tokens';
import { TabType } from '../lib/navigation';
import { AnimatedNumber } from './ui/AnimatedNumber';
import { EmptyState } from './ui/EmptyState';
import { KpiTile } from './ui/KpiTile';
import { Switch } from './ui/Switch';

interface Props {
  vendors: Vendor[];
  orders: Order[];
  vendorId: string;
  onVendorChange: (id: string) => void;
  now: number;
  /** Moves an order forward. Same handler as the admin's. */
  onAdvance: (orderId: string, status: OrderStatus) => Promise<boolean> | boolean | void;
  onToggleOpen: (vendorId: string) => void;
  openBusy?: boolean;
  /** Opens the order panel (details, refuse with a reason). */
  onOpenOrder: (orderId: string) => void;
  onNavigate: (tab: TabType) => void;
  loading?: boolean;
}

const SOUND_KEY = 'kraveo_restaurant_sound';
const readSound = (): boolean => { try { return localStorage.getItem(SOUND_KEY) === '1'; } catch { return false; } };

/** A short, friendly two-note beep. Needs the page to have been touched once, which the sound switch does. */
const beep = () => {
  try {
    const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [660, 880].forEach((freq, i) => {
      const osc = ctx.createOscillator(); const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq; osc.connect(gain); gain.connect(ctx.destination);
      const start = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start); gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.start(start); osc.stop(start + 0.18);
    });
    window.setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch { /* no sound: the banner is still there */ }
};

/** How long an order has waited, with a colour that gets louder when it drags. */
const Wait: React.FC<{ minutes: number; limit: number }> = ({ minutes, limit }) => {
  const late = minutes >= limit;
  const tone = late ? 'bg-kraveo-danger/10 text-kraveo-danger' : minutes >= Math.ceil(limit / 2) ? 'bg-kraveo-status-placed/15 text-kraveo-status-placed' : 'bg-kraveo-surface2 text-kraveo-ink2';
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${tone}`} title={late ? 'Le délai est dépassé' : 'Temps d’attente'}>
      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{waitLabel(minutes)}
    </span>
  );
};

const OrderCard: React.FC<{
  order: Order; now: number; limit: number; busy: boolean; accent: string;
  /** Where the wait is counted from: the order, its acceptance or its being ready. */
  since?: string | null;
  primary?: { label: string; icon: React.ElementType; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  footer?: React.ReactNode;
}> = ({ order, now, limit, busy, accent, since, primary, secondary, footer }) => {
  const waited = minutesSince(since ?? order.createdAt, now);
  return (
    <article className="overflow-hidden rounded-k-lg border border-kraveo-line bg-kraveo-surface shadow-k-soft" aria-label={`Commande ${orderCode(order.id)}`}>
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 font-mono text-[11px] font-bold uppercase tracking-wider text-kraveo-ink3"><span className={`h-2 w-2 rounded-full ${accent}`} aria-hidden="true" />{orderCode(order.id)}</p>
          <Wait minutes={waited} limit={limit} />
        </div>
        <h3 className="mt-2 font-display text-lg font-bold leading-tight text-kraveo-ink">{firstName(order.customerName)}</h3>
        <p className="mt-0.5 flex items-center gap-1 text-sm text-kraveo-ink3"><MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{order.dropoffHostel}</p>
      </div>

      <ul className="divide-y divide-kraveo-line/70 border-y border-kraveo-line/70 bg-kraveo-night/50 px-4" aria-label="Plats commandés">
        {(order.items ?? []).map((item, i) => (
          <li key={`${item.name}-${i}`} className="flex items-baseline gap-3 py-2.5">
            <span className="w-7 shrink-0 text-right font-display text-base font-extrabold tabular-nums text-kraveo-g600">{item.quantity}×</span>
            <span className="min-w-0 text-[15px] font-semibold leading-snug text-kraveo-ink [overflow-wrap:anywhere]">{item.name}</span>
          </li>
        ))}
      </ul>

      <div className="space-y-3 p-4 pt-3">
        {order.dropoffNotes && <p className="rounded-k-sm bg-kraveo-yellow/15 px-3 py-2 text-xs leading-relaxed text-kraveo-ink2"><b className="text-kraveo-ink">Note du client</b> · {order.dropoffNotes}</p>}
        {typeof order.vendorSubtotal === 'number' && (
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm text-kraveo-ink3">Vous gagnez</span>
            <span className="font-display text-lg font-extrabold tabular-nums text-kraveo-ink">{inr(order.vendorSubtotal)}</span>
          </div>
        )}
        {(primary || secondary) && (
          <div className="flex gap-2">
            {secondary && <button type="button" onClick={secondary.onClick} disabled={busy} className="k-btn-ghost flex-1 !min-h-[48px] text-sm text-kraveo-danger hover:!bg-kraveo-danger/10">{secondary.label}</button>}
            {primary && (
              <button type="button" onClick={primary.onClick} disabled={busy} aria-busy={busy} className="k-btn-primary flex-[2] !min-h-[48px] text-base">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <primary.icon className="h-5 w-5" aria-hidden="true" />}{primary.label}
              </button>
            )}
          </div>
        )}
        {footer}
      </div>
    </article>
  );
};

const Column: React.FC<{ title: string; hint: string; count: number; dot: string; empty: string; emptyIcon: React.ElementType; children: React.ReactNode }> = ({ title, hint, count, dot, empty, emptyIcon, children }) => (
  <section className="flex min-w-0 flex-col rounded-k-xl border border-kraveo-line bg-kraveo-night/70 p-3 sm:p-4" aria-label={title}>
    <header className="mb-3 flex items-center justify-between gap-2 px-1">
      <div>
        <h2 className="flex items-center gap-2 font-display text-base font-bold text-kraveo-ink"><span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden="true" />{title}</h2>
        <p className="text-xs text-kraveo-ink3">{hint}</p>
      </div>
      <span className="grid h-8 min-w-[2rem] place-items-center rounded-full bg-kraveo-surface px-2 text-sm font-extrabold tabular-nums text-kraveo-ink shadow-k-soft">{count}</span>
    </header>
    <div className="flex-1 space-y-3">
      {count === 0 ? <EmptyState icon={emptyIcon} title={empty} description="" className="py-8" /> : children}
    </div>
  </section>
);

const STEP_ICON: Record<string, React.ElementType> = { logo: ImageIcon, description: FileText, phone: Phone, hours: Clock3, pin: MapPin };
const HIDE_KEY = 'kraveo_restaurant_fiche_hidden';
const hiddenFor = (vendorId: string): boolean => { try { return localStorage.getItem(`${HIDE_KEY}_${vendorId}`) === '1'; } catch { return false; } };

/** "Complete your page": a progress ring and one tap per missing step. Sits right under the welcome card until the page is complete. */
const ProfileProgressCard: React.FC<{ vendorId: string; percent: number; steps: ProfileStep[]; onNavigate: (tab: TabType) => void }> = ({ vendorId, percent, steps, onNavigate }) => {
  const [hidden, setHidden] = useState(() => hiddenFor(vendorId));
  useEffect(() => setHidden(hiddenFor(vendorId)), [vendorId]);
  if (percent >= 100 || hidden) return null;
  const hide = () => { setHidden(true); try { localStorage.setItem(`${HIDE_KEY}_${vendorId}`, '1'); } catch { /* hidden for this visit only */ } };
  const radius = 26; const circ = 2 * Math.PI * radius;
  const left = steps.filter((s) => !s.done);
  return (
    <section aria-label="Compléter votre fiche" className="relative overflow-hidden rounded-k-xl border border-kraveo-line bg-gradient-to-r from-kraveo-yellow/15 via-kraveo-surface to-kraveo-surface p-4 shadow-k-soft sm:p-5">
      <button type="button" onClick={hide} className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-full text-kraveo-ink3 transition-colors hover:bg-kraveo-surface2 hover:text-kraveo-ink" aria-label="Masquer ce rappel" title="Masquer"><X className="h-4 w-4" aria-hidden="true" /></button>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4 pr-8">
        <div className="flex items-center gap-4">
          <div className="relative h-16 w-16 shrink-0" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Fiche complétée">
            <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90" aria-hidden="true">
              <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="7" className="stroke-kraveo-line" />
              <circle cx="32" cy="32" r={radius} fill="none" strokeWidth="7" strokeLinecap="round" className="stroke-kraveo-g500 transition-all duration-500" strokeDasharray={circ} strokeDashoffset={circ * (1 - percent / 100)} />
            </svg>
            <span className="absolute inset-0 grid place-items-center font-display text-sm font-extrabold tabular-nums text-kraveo-ink">{percent}%</span>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold text-kraveo-ink sm:text-lg">Complétez votre fiche</h2>
            <p className="text-sm text-kraveo-ink2">Plus elle est complète, plus on a envie de commander chez vous. Il reste {left.length} étape{left.length > 1 ? 's' : ''}.</p>
          </div>
        </div>
        <ul className="flex flex-1 flex-wrap gap-2">
          {left.map((step) => {
            const Icon = STEP_ICON[step.key] ?? Circle;
            return (
              <li key={step.key}>
                <button type="button" onClick={() => onNavigate(step.tab)} className="group inline-flex items-center gap-2 rounded-full border border-kraveo-line bg-kraveo-surface px-3.5 py-2 text-sm font-semibold text-kraveo-ink shadow-k-soft transition-all hover:-translate-y-0.5 hover:border-kraveo-g400/60 hover:bg-kraveo-g500/5">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-kraveo-yellow/30 text-kraveo-ink"><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>
                  {step.label}
                  <ArrowRight className="h-3.5 w-3.5 text-kraveo-ink3 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
};

export const RestaurantDashboard: React.FC<Props> = ({ vendors, orders, vendorId, onVendorChange, now, onAdvance, onToggleOpen, openBusy = false, onOpenOrder, onNavigate, loading = false }) => {
  const sorted = useMemo(() => [...vendors].sort((a, b) => a.name.localeCompare(b.name, 'fr')), [vendors]);
  const vendor = sorted.find((v) => v.id === vendorId) ?? sorted[0];
  const mine = useMemo(() => (vendor ? restaurantOrders(orders, vendor.id) : []), [orders, vendor]);
  const board: RestaurantBoard = useMemo(() => boardOf(mine), [mine]);
  const today = dakarDay(now) as string;
  const yesterday = dakarDay(now - 86_400_000) as string;
  const figures = useMemo(() => dayFigures(mine, today), [mine, today]);
  const before = useMemo(() => dayFigures(mine, yesterday), [mine, yesterday]);
  const hours = useMemo(() => hourlySales(mine, today), [mine, today]);
  const dishes = useMemo(() => topDishes(mine, today), [mine, today]);
  const progress = useMemo(() => (vendor ? profileProgress(vendor) : { steps: [], percent: 0 }), [vendor]);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [sound, setSound] = useState(readSound);
  const seenFresh = useRef<number | null>(null);
  const freshCount = board.fresh.length;
  useEffect(() => {
    if (seenFresh.current !== null && freshCount > seenFresh.current && sound) beep();
    seenFresh.current = freshCount;
  }, [freshCount, sound]);
  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    try { localStorage.setItem(SOUND_KEY, next ? '1' : '0'); } catch { /* kept for this visit only */ }
    if (next) beep();
  };

  const advance = async (order: Order, status: OrderStatus) => {
    setBusyId(order.id);
    try { await onAdvance(order.id, status); } finally { setBusyId(null); }
  };

  if (!vendor) {
    return <div className="k-card mx-auto max-w-2xl"><EmptyState icon={Store} title="Aucun restaurant pour l’instant" description="Ajoutez ou validez un restaurant pour voir son tableau de bord." /></div>;
  }

  const openNow = isOpenNow(vendor.openingHours, now);
  const todayKey = DAYS[(new Date(now).getUTCDay() + 6) % 7];
  const hoursToday = vendor.openingHours ? dayText(vendor.openingHours[todayKey]) : null;
  const maxHour = Math.max(1, ...hours);
  const firstHour = Math.max(0, Math.min(...hours.map((v, h) => (v > 0 ? h : 24)), 10));
  const shownHours = hours.slice(Math.min(firstHour, 8), 24).map((value, i) => ({ hour: Math.min(firstHour, 8) + i, value }));
  const compare = (now: number, before: number, unit: string) => (before === 0 ? (now === 0 ? 'Pas encore de commande' : 'Premier jour de comparaison') : now === before ? 'Comme hier' : `${now > before ? '+' : '−'}${Math.abs(now - before)} ${unit} par rapport à hier`);
  const date = new Date(now).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const hello = new Date(now).getUTCHours() < 18 && new Date(now).getUTCHours() >= 5 ? 'Bonjour' : 'Bonsoir';

  return (
    <div className="mx-auto max-w-[1280px] space-y-6">
      {/* Welcome + open/closed */}
      <section aria-label="Bienvenue" className="relative overflow-hidden rounded-k-xl border border-kraveo-line bg-gradient-to-br from-kraveo-g800 via-kraveo-g700 to-kraveo-g500 p-5 text-white shadow-k-soft sm:p-8">
        <div className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-kraveo-yellow/25 blur-3xl" aria-hidden="true" />
        <div className="pointer-events-none absolute -bottom-20 left-1/3 h-48 w-48 rounded-full bg-white/10 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-wrap items-center justify-between gap-5">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-white/70">{date}</p>
            <h1 className="mt-2 font-display text-2xl font-extrabold tracking-tight sm:text-4xl">{hello}, {vendor.name}</h1>
            <p className="mt-2 max-w-xl text-sm text-white/80 sm:text-base">
              {freshCount > 0
                ? <><b className="text-white">{freshCount} nouvelle{freshCount > 1 ? 's' : ''} commande{freshCount > 1 ? 's' : ''}</b> {freshCount > 1 ? 'attendent' : 'attend'} votre réponse.</>
                : board.cooking.length + board.ready.length > 0 ? <>Tout est sous contrôle : <b className="text-white">{board.cooking.length + board.ready.length} commande{board.cooking.length + board.ready.length > 1 ? 's' : ''} en cours</b>.</>
                  : 'Aucune commande pour le moment. Les nouvelles apparaîtront ici.'}
            </p>
            {sorted.length > 1 && (
              <label className="mt-4 inline-flex items-center gap-2 text-xs text-white/70">
                Aperçu du restaurant
                <select className="k-select !min-h-[36px] !w-auto border-white/30 !bg-white/95 py-1 text-sm text-kraveo-ink" value={vendor.id} onChange={(e) => onVendorChange(e.target.value)} aria-label="Restaurant affiché">
                  {sorted.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
            )}
          </div>

          <div className={`flex items-center gap-4 rounded-k-xl bg-white px-5 py-4 text-kraveo-ink shadow-k-lift`}>
            <div>
              <p className={`flex items-center gap-2 font-display text-lg font-extrabold ${vendor.isAcceptingOrders ? 'text-kraveo-g700' : 'text-kraveo-danger'}`}>
                <span className={`k-dot ${vendor.isAcceptingOrders ? 'bg-kraveo-g400 k-dot-live' : 'bg-kraveo-danger'}`} aria-hidden="true" />
                {vendor.isAcceptingOrders ? 'Vous prenez des commandes' : 'Vous êtes fermé'}
              </p>
              <p className="mt-0.5 text-xs text-kraveo-ink3">
                {hoursToday ? `Aujourd’hui : ${hoursToday}` : 'Horaires non renseignés'}{openNow === false && vendor.isAcceptingOrders ? ' · hors des horaires' : ''}
              </p>
            </div>
            <Switch checked={vendor.isAcceptingOrders} onChange={() => onToggleOpen(vendor.id)} disabled={openBusy} label={`${vendor.name} : prend des commandes`} />
          </div>
        </div>
      </section>

      <ProfileProgressCard vendorId={vendor.id} percent={progress.percent} steps={progress.steps} onNavigate={onNavigate} />

      {/* New orders alert */}
      {freshCount > 0 && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-k-xl bg-kraveo-yellow/20 px-5 py-4">
          <p className="flex items-center gap-3 font-display text-base font-bold text-kraveo-ink sm:text-lg"><span className="grid h-10 w-10 place-items-center rounded-full bg-kraveo-yellow text-kraveo-ink"><Bell className="h-5 w-5 animate-pulse" aria-hidden="true" /></span>{freshCount} nouvelle{freshCount > 1 ? 's' : ''} commande{freshCount > 1 ? 's' : ''} : répondez vite, le client attend.</p>
          <button type="button" onClick={toggleSound} aria-pressed={sound} className="k-btn-ghost !bg-kraveo-surface">{sound ? <Bell className="h-4 w-4" aria-hidden="true" /> : <BellOff className="h-4 w-4" aria-hidden="true" />}{sound ? 'Son activé' : 'Activer le son'}</button>
        </div>
      )}

      {/* Figures */}
      <section aria-label="Chiffres du jour" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiTile index={0} loading={loading} label="Commandes aujourd’hui" icon={ShoppingBag} value={<AnimatedNumber value={figures.orders} />} note={compare(figures.orders, before.orders, 'commande(s)')} />
        <KpiTile index={1} loading={loading} label="Vous gagnez aujourd’hui" icon={Wallet} tone="text-kraveo-status-delivered" toneBg="bg-kraveo-status-delivered/15"
          value={figures.knownSales ? <AnimatedNumber value={figures.sales} suffix=" FCFA" /> : <span>-</span>} note={figures.knownSales ? 'Votre part, commandes payées' : 'Montant indisponible pour le moment'} />
        <KpiTile index={2} loading={loading} label="Panier moyen" icon={Utensils} tone="text-kraveo-status-preparing" toneBg="bg-kraveo-status-preparing/15"
          value={figures.average !== null ? <AnimatedNumber value={figures.average} suffix=" FCFA" /> : <span>-</span>} note={figures.average !== null ? 'Par commande' : 'Pas encore de commande'} />
        <KpiTile index={3} loading={loading} label="En cours" icon={Flame} tone="text-kraveo-status-pickedUp" toneBg="bg-kraveo-status-pickedUp/15"
          value={<AnimatedNumber value={board.fresh.length + board.cooking.length + board.ready.length} />} note={`${board.cooking.length} en cuisine · ${board.ready.length} prête${board.ready.length > 1 ? 's' : ''}`} />
      </section>

      {/* Live board */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Column title="Nouvelles" hint="À accepter ou refuser" count={board.fresh.length} dot="bg-kraveo-yellow" empty="Aucune nouvelle commande" emptyIcon={Bell}>
          {board.fresh.map((o) => (
            <OrderCard key={o.id} order={o} now={now} limit={SLA.VENDOR_ACCEPT_WINDOW_MIN} busy={busyId === o.id} accent="bg-kraveo-yellow"
              primary={{ label: 'Accepter', icon: Check, onClick: () => advance(o, 'ACCEPTED') }} secondary={{ label: 'Refuser', onClick: () => onOpenOrder(o.id) }} />
          ))}
        </Column>
        <Column title="En cuisine" hint="À préparer" count={board.cooking.length} dot="bg-kraveo-status-preparing" empty="Rien en cuisine" emptyIcon={ChefHat}>
          {board.cooking.map((o) => (
            <OrderCard key={o.id} order={o} now={now} limit={25} since={o.acceptedAt} busy={busyId === o.id} accent="bg-kraveo-status-preparing"
              primary={o.status === 'ACCEPTED' ? { label: 'Commencer', icon: Flame, onClick: () => advance(o, 'PREPARING') } : { label: 'C’est prêt', icon: CheckCircle2, onClick: () => advance(o, 'READY_FOR_PICKUP') }} />
          ))}
        </Column>
        <Column title="Prêtes" hint="En attente du livreur" count={board.ready.length} dot="bg-kraveo-status-ready" empty="Aucune commande prête" emptyIcon={PackageCheck}>
          {board.ready.map((o) => (
            <OrderCard key={o.id} order={o} now={now} limit={SLA.PICKUP_WAIT_MIN} since={o.updatedAt} busy={false} accent="bg-kraveo-status-ready"
              footer={<p className="flex items-center gap-2 rounded-k-sm bg-kraveo-surface2 px-3 py-2.5 text-sm text-kraveo-ink2"><PackageCheck className="h-4 w-4 text-kraveo-status-ready" aria-hidden="true" />{o.driverName ? <>Le livreur <b>{firstName(o.driverName)}</b> vient la chercher</> : 'On cherche un livreur'}</p>} />
          ))}
        </Column>
      </div>

      {/* Insights */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="k-card p-5 lg:col-span-2" aria-label="Ventes par heure">
          <h2 className="font-display text-base font-bold text-kraveo-ink">Vos ventes heure par heure</h2>
          <p className="text-xs text-kraveo-ink3">Aujourd’hui, ce que vous gagnez à chaque heure.</p>
          {figures.orders === 0 ? <p className="mt-6 rounded-k-md bg-kraveo-surface2 px-4 py-8 text-center text-sm text-kraveo-ink3">Le graphique se remplit dès la première commande.</p> : (
            <div className="mt-5 flex h-40 items-end gap-1.5 sm:gap-2" role="img" aria-label="Ventes par heure aujourd’hui">
              {shownHours.map(({ hour, value }) => (
                <div key={hour} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5" title={`${hour} h : ${inr(value)}`}>
                  <div className={`w-full max-w-[28px] rounded-t-k-sm ${value > 0 ? 'bg-kraveo-g500' : 'bg-kraveo-line'}`} style={{ height: `${Math.max(3, (value / maxHour) * 100)}%` }} />
                  <span className="text-[10px] tabular-nums text-kraveo-ink3">{hour % 2 === 0 ? `${hour}h` : ''}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="k-card p-5" aria-label="Plats les plus commandés">
          <h2 className="font-display text-base font-bold text-kraveo-ink">Vos plats préférés aujourd’hui</h2>
          <p className="text-xs text-kraveo-ink3">Les plus commandés.</p>
          {dishes.length === 0 ? <p className="mt-6 rounded-k-md bg-kraveo-surface2 px-4 py-8 text-center text-sm text-kraveo-ink3">Pas encore de plat commandé.</p> : (
            <ol className="mt-4 space-y-3">
              {dishes.map((d, i) => (
                <li key={d.name}>
                  <div className="flex items-center justify-between gap-3 text-sm"><span className="flex min-w-0 items-center gap-2"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-kraveo-yellow/30 text-xs font-extrabold text-kraveo-ink">{i + 1}</span><span className="truncate font-semibold text-kraveo-ink">{d.name}</span></span><b className="tabular-nums text-kraveo-ink">{d.quantity}</b></div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-kraveo-line"><div className="h-full rounded-full bg-kraveo-g500" style={{ width: `${(d.quantity / dishes[0].quantity) * 100}%` }} /></div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

    </div>
  );
};
