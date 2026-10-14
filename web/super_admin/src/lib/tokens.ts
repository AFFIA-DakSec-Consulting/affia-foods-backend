// Raw design-token hex values for places where a Tailwind class cannot be used (Recharts, SVG, inline style).
// Mirrors tailwind.config.js and packages/kraveo_ui (KraveoPalette, KStatus).

export const palette = {
  g400: '#5F84EC',
  g500: '#2F5BE0',
  g800: '#1C3A9A',
  yellow: '#F5B70A',
  night: '#F7F8FB',
  surface: '#FFFFFF',
  surface2: '#F1F3F8',
  line: '#E7EAF1',
  ink: '#141A30',
  ink2: '#4A5168',
  ink3: '#6B7391',
  danger: '#D92D3A',
} as const;

export type KStatusKey = 'placed' | 'accepted' | 'preparing' | 'ready' | 'pickedUp' | 'atGate' | 'delivered' | 'cancelled';

export interface StatusMeta {
  key: KStatusKey;
  label: string;
  hex: string;
  /** Terminal states do not pulse. */
  live: boolean;
  // Literal class strings so Tailwind's scanner picks them up.
  dot: string;
  text: string;
  bg: string;
  border: string;
}

export const STATUS_META: Record<KStatusKey, StatusMeta> = {
  placed: { key: 'placed', label: 'Nouvelle', hex: '#B7791F', live: true, dot: 'bg-kraveo-status-placed', text: 'text-kraveo-status-placed', bg: 'bg-kraveo-status-placed/15', border: 'border-kraveo-status-placed/30' },
  accepted: { key: 'accepted', label: 'Acceptée', hex: '#0F766E', live: true, dot: 'bg-kraveo-status-accepted', text: 'text-kraveo-status-accepted', bg: 'bg-kraveo-status-accepted/15', border: 'border-kraveo-status-accepted/30' },
  preparing: { key: 'preparing', label: 'En préparation', hex: '#C2410C', live: true, dot: 'bg-kraveo-status-preparing', text: 'text-kraveo-status-preparing', bg: 'bg-kraveo-status-preparing/15', border: 'border-kraveo-status-preparing/30' },
  ready: { key: 'ready', label: 'Prête', hex: '#4D7C0F', live: true, dot: 'bg-kraveo-status-ready', text: 'text-kraveo-status-ready', bg: 'bg-kraveo-status-ready/15', border: 'border-kraveo-status-ready/30' },
  pickedUp: { key: 'pickedUp', label: 'En route', hex: '#2F5BE0', live: true, dot: 'bg-kraveo-status-pickedUp', text: 'text-kraveo-status-pickedUp', bg: 'bg-kraveo-status-pickedUp/15', border: 'border-kraveo-status-pickedUp/30' },
  atGate: { key: 'atGate', label: 'Au portail', hex: '#6D28D9', live: true, dot: 'bg-kraveo-status-atGate', text: 'text-kraveo-status-atGate', bg: 'bg-kraveo-status-atGate/15', border: 'border-kraveo-status-atGate/30' },
  delivered: { key: 'delivered', label: 'Livrée', hex: '#15803D', live: false, dot: 'bg-kraveo-status-delivered', text: 'text-kraveo-status-delivered', bg: 'bg-kraveo-status-delivered/15', border: 'border-kraveo-status-delivered/30' },
  cancelled: { key: 'cancelled', label: 'Annulée', hex: '#D92D3A', live: false, dot: 'bg-kraveo-status-cancelled', text: 'text-kraveo-status-cancelled', bg: 'bg-kraveo-status-cancelled/15', border: 'border-kraveo-status-cancelled/30' },
};

/** Ordered pipeline (live lanes), same order as the Flutter apps. */
export const PIPELINE_ORDER: KStatusKey[] = ['placed', 'accepted', 'preparing', 'ready', 'pickedUp', 'atGate'];

/** Tolerant parser, same rules as KStatusX.parse in kraveo_ui. */
export const parseStatus = (raw: string): KStatusKey => {
  const s = raw.toUpperCase().replace(/ /g, '_');
  if (s.includes('CANCEL')) return 'cancelled';
  if (s.includes('DELIVERED')) return 'delivered';
  if (s.includes('GATE')) return 'atGate';
  if (s.includes('PICKED') || s.includes('TRANSIT') || s.includes('WAY')) return 'pickedUp';
  if (s.includes('READY')) return 'ready';
  if (s.includes('PREPAR')) return 'preparing';
  if (s.includes('ACCEPT') || s.includes('ASSIGN')) return 'accepted';
  return 'placed';
};

export const statusMeta = (raw: string): StatusMeta => STATUS_META[parseStatus(raw)];

/** Exact backend wording for a status, used in the quick-override menu. */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  PLACED: 'Nouvelle',
  ACCEPTED: 'Acceptée',
  PREPARING: 'En préparation',
  READY_FOR_PICKUP: 'Prête à récupérer',
  PICKED_UP: 'En route',
  ARRIVED_AT_GATE: 'Au portail',
  DELIVERED: 'Livrée',
  CANCELLED: 'Annulée',
};

/** The server stores the vehicle in English (Bike, Scooter, Cycle, On foot); this is the French label shown to the admin. */
export const VEHICLE_LABEL: Record<string, string> = { Bike: 'Moto', Scooter: 'Scooter', Cycle: 'Vélo', 'On foot': 'À pied' };
export const vehicleLabel = (value?: string | null): string => (value ? VEHICLE_LABEL[value] ?? value : '');

export const inr = (value: number): string => `${value.toLocaleString('fr-FR', { maximumFractionDigits: 0 }).replace(/[\u202f\u00a0]/g, ' ')} FCFA`;

export const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export const timeAgo = (iso?: string | number | Date, now: number = Date.now()): string => {
  if (!iso) return '-';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '-';
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 10) return 'à l’instant';
  if (s < 60) return `il y a ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
};
