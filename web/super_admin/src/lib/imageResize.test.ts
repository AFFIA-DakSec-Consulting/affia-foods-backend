import { describe, expect, it } from 'vitest';
import { fitWithin } from './imageResize';

describe('fitWithin', () => {
  it('keeps small pictures as they are', () => { expect(fitWithin(500, 300, 600)).toEqual({ width: 500, height: 300 }); });
  it('shrinks the longest side to the limit and keeps the proportions', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });
  it('never returns a zero side', () => { expect(fitWithin(10000, 1, 100).height).toBe(1); });
});
