// Main towns of Senegal, to fill a service area in one click (name, centre, a sensible radius). The admin can still type any point.
export interface City { name: string; lat: number; lng: number; radiusKm: number }

export const SENEGAL_CITIES: readonly City[] = [
  { name: 'Dakar', lat: 14.6937, lng: -17.4441, radiusKm: 25 },
  { name: 'Pikine', lat: 14.7645, lng: -17.391, radiusKm: 8 },
  { name: 'Guédiawaye', lat: 14.7769, lng: -17.3981, radiusKm: 6 },
  { name: 'Rufisque', lat: 14.7167, lng: -17.2667, radiusKm: 10 },
  { name: 'Thiès', lat: 14.7886, lng: -16.926, radiusKm: 8 },
  { name: 'Mbour', lat: 14.4167, lng: -16.9667, radiusKm: 10 },
  { name: 'Saly', lat: 14.4486, lng: -17.0168, radiusKm: 6 },
  { name: 'Joal-Fadiouth', lat: 14.1667, lng: -16.8333, radiusKm: 5 },
  { name: 'Touba', lat: 14.85, lng: -15.8833, radiusKm: 12 },
  { name: 'Mbacké', lat: 14.79, lng: -15.9083, radiusKm: 6 },
  { name: 'Diourbel', lat: 14.6553, lng: -16.2314, radiusKm: 8 },
  { name: 'Kaolack', lat: 14.1652, lng: -16.0753, radiusKm: 10 },
  { name: 'Fatick', lat: 14.339, lng: -16.4111, radiusKm: 6 },
  { name: 'Kaffrine', lat: 14.1056, lng: -15.55, radiusKm: 6 },
  { name: 'Louga', lat: 15.6144, lng: -16.2246, radiusKm: 8 },
  { name: 'Saint-Louis', lat: 16.0179, lng: -16.4896, radiusKm: 10 },
  { name: 'Richard-Toll', lat: 16.4625, lng: -15.7007, radiusKm: 6 },
  { name: 'Matam', lat: 15.6559, lng: -13.2554, radiusKm: 6 },
  { name: 'Tambacounda', lat: 13.7707, lng: -13.6673, radiusKm: 10 },
  { name: 'Kédougou', lat: 12.5578, lng: -12.1814, radiusKm: 6 },
  { name: 'Kolda', lat: 12.8833, lng: -14.95, radiusKm: 8 },
  { name: 'Sédhiou', lat: 12.7081, lng: -15.5569, radiusKm: 6 },
  { name: 'Ziguinchor', lat: 12.5681, lng: -16.2719, radiusKm: 10 },
];

export const cityByName = (name: string): City | undefined => SENEGAL_CITIES.find((c) => c.name === name);
