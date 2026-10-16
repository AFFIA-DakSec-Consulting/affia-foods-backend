/** Shapes shared by the pricing pipeline and the module engines (all money = whole FCFA). */
export type RushWindow = { from: string; to: string };

export type ZoneRow = { id: string; label: string; minKm: number; maxKm: number | null; fee: number | null; courierPayout: number | null };

export type DeliveryConfig = {
  baseFee: number;
  pricePerKm: number;
  minFee: number;
  maxFee: number;
  maxDeliveryDistance: number;
  rounding: number;
  smallOrderBelow: number;
  smallOrderFee: number;
  zones: { enabled: boolean; rows: ZoneRow[]; fallbackToFormula: boolean };
  surge: { enabled: boolean; rainMode: boolean; rainSurcharge: number; rushMultiplier: number; rushHours: RushWindow[]; maxSurgeTotal: number };
  multi: { enabled: boolean; extraStopFee: number; maxRestaurants: number; maxDetourKm: number };
};

export type BonusRow = { id: string; name: string; triggerType: string; amount: number; conditions: Record<string, unknown> | null };

export type CourierConfig = {
  mode: 'per_zone' | 'per_km' | 'flat';
  flatAmount: number;
  baseAmount: number;
  perKm: number;
  minPayout: number;
  maxPayout: number;
  batch: { enabled: boolean; extraStopPayout: number; splitStrategy: 'equal' | 'proportional_to_distance' };
  bonuses: { enabled: boolean; rows: BonusRow[]; rainMode: boolean };
};

export type PricingContext = {
  /** Food total before any discount (customer prices). */
  cartAmount: number;
  /** Straight-line km restaurant -> customer for a single order; for a group, the km of the whole tour (see tourKm). */
  distanceKm: number;
  /** Number of restaurants (1 = single order). */
  restaurantsCount: number;
  /** Distance between the two farthest restaurants of a group (0 for one). */
  maxDetourKm: number;
  /** Local time (Dakar) of the calculation. */
  now: Date;
  /** Zone grid used for the order (the city's, or 'default'). */
  city: string;
};

export type DeliveryResult = {
  deliveryFeeOriginal: number;
  baseFee: number;
  smallOrderFee: number;
  extraStopsFee: number;
  surge: number;
  zone: { id: string; label: string } | null;
  warnings: string[];
};

export type CourierResult = {
  courierPayout: number;
  base: number;
  extraStops: number;
  bonuses: number;
  bonusNames: string[];
  zone: { id: string; label: string } | null;
};
