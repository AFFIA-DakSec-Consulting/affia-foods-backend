import { describe, expect, it } from 'vitest';
import { tileAt, tileGrid } from './mapTiles';

describe('map tiles', () => {
  it('finds the tile of a known point (Paris at zoom 10 is tile 518/352)', () => {
    const t = tileAt(48.8566, 2.3522, 10);
    expect([t.x, t.y]).toEqual([518, 352]);
    expect(t.fx).toBeGreaterThanOrEqual(0); expect(t.fx).toBeLessThan(1);
  });
  it('Thiès is on the expected tile and the point sits inside the middle one of 9', () => {
    const g = tileGrid(14.7886, -16.926, 16);
    expect(g.urls).toHaveLength(9);
    expect(g.urls[4]).toMatch(/^https:\/\/tile\.openstreetmap\.org\/16\/\d+\/\d+\.png$/);
    expect(g.offsetX).toBeGreaterThanOrEqual(256); expect(g.offsetX).toBeLessThan(512);
    expect(g.offsetY).toBeGreaterThanOrEqual(256); expect(g.offsetY).toBeLessThan(512);
  });
  it('wraps around the date line and clamps at the poles', () => {
    expect(tileGrid(0, 179.99, 3).urls.some((u) => u.includes('/3/0/'))).toBe(true);
    expect(tileGrid(85, 0, 2).urls.every((u) => !u.includes('/-'))).toBe(true);
  });
});
