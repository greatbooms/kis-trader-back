import { applyAccumulatedQuota } from './infinite-buy-quota.util';

describe('applyAccumulatedQuota', () => {
  it('returns baseQuota when no carry-over', () => {
    const result = applyAccumulatedQuota({
      baseQuota: 100,
      params: {},
      remainingQuota: 1000,
    });
    expect(result.carriedIn).toBe(0);
    expect(result.combinedQuota).toBe(100);
    expect(result.cappedQuota).toBe(100);
  });

  it('adds accumulated carry-over to baseQuota', () => {
    const result = applyAccumulatedQuota({
      baseQuota: 100,
      params: { accumulatedQuota: 150 },
      remainingQuota: 1000,
    });
    expect(result.carriedIn).toBe(150);
    expect(result.combinedQuota).toBe(250);
    expect(result.cappedQuota).toBe(250);
  });

  it('caps combined quota at remainingQuota', () => {
    const result = applyAccumulatedQuota({
      baseQuota: 100,
      params: { accumulatedQuota: 500 },
      remainingQuota: 300,
    });
    expect(result.carriedIn).toBe(500);
    expect(result.combinedQuota).toBe(600);
    expect(result.cappedQuota).toBe(300);
  });

  it('treats negative accumulated as zero', () => {
    const result = applyAccumulatedQuota({
      baseQuota: 100,
      params: { accumulatedQuota: -50 },
      remainingQuota: 1000,
    });
    expect(result.carriedIn).toBe(0);
    expect(result.combinedQuota).toBe(100);
  });

  it('handles zero remainingQuota', () => {
    const result = applyAccumulatedQuota({
      baseQuota: 100,
      params: { accumulatedQuota: 50 },
      remainingQuota: 0,
    });
    expect(result.cappedQuota).toBe(0);
  });

  it('handles missing params', () => {
    const result = applyAccumulatedQuota({
      baseQuota: 100,
      remainingQuota: 1000,
    });
    expect(result.carriedIn).toBe(0);
    expect(result.cappedQuota).toBe(100);
  });
});
