// A small map picture without a map library: the OpenStreetMap tiles around a point (Web Mercator "slippy map" maths).

export const TILE = 256;

/** Tile column/row at a zoom, with the fraction (0..1) of the point inside that tile. */
export const tileAt = (lat: number, lng: number, zoom: number): { x: number; y: number; fx: number; fy: number } => {
  const n = 2 ** zoom;
  const latRad = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180;
  const xf = ((lng + 180) / 360) * n;
  const yf = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  const x = Math.floor(xf); const y = Math.floor(yf);
  return { x, y, fx: xf - x, fy: yf - y };
};

/** The 3 x 3 tiles around the point, row by row, so the point sits in the middle tile. */
export const tileGrid = (lat: number, lng: number, zoom: number): { urls: string[]; offsetX: number; offsetY: number } => {
  const { x, y, fx, fy } = tileAt(lat, lng, zoom);
  const n = 2 ** zoom;
  const urls: string[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) urls.push(`https://tile.openstreetmap.org/${zoom}/${(((x + dx) % n) + n) % n}/${Math.max(0, Math.min(n - 1, y + dy))}.png`);
  // Pixel position of the point inside the 3 x 3 block.
  return { urls, offsetX: TILE + fx * TILE, offsetY: TILE + fy * TILE };
};
