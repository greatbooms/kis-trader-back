import { getMarketHours, isUsMarketDst } from './kis-config.types';

describe('kis-config market hours', () => {
  it('should use US standard-time hours in January', () => {
    const date = new Date('2026-01-15T12:00:00+09:00');

    expect(isUsMarketDst(date)).toBe(false);
    expect(getMarketHours('NASD', date)).toEqual({
      open: { hour: 23, minute: 30 },
      close: { hour: 6, minute: 0 },
      overnight: true,
    });
  });

  it('should use US daylight-saving hours in April', () => {
    const date = new Date('2026-04-15T12:00:00+09:00');

    expect(isUsMarketDst(date)).toBe(true);
    expect(getMarketHours('NASD', date)).toEqual({
      open: { hour: 22, minute: 30 },
      close: { hour: 5, minute: 0 },
      overnight: true,
    });
  });

  it('should keep non-US exchange hours unchanged', () => {
    const date = new Date('2026-04-15T12:00:00+09:00');

    expect(getMarketHours('SEHK', date)).toEqual({
      open: { hour: 10, minute: 30 },
      close: { hour: 17, minute: 0 },
      overnight: false,
    });
  });
});
