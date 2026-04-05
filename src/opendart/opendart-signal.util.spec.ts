import { buildOpenDartDomesticSignals } from './opendart-signal.util';

describe('buildOpenDartDomesticSignals', () => {
  it('should summarize recent disclosures and insider ownership changes', () => {
    const today = new Date('2026-04-05T09:00:00+09:00');
    const signals = buildOpenDartDomesticSignals(
      [
        { rcept_dt: '20260401', report_nm: '분기보고서 (2026.03)' },
        { rcept_dt: '20260325', report_nm: '주요사항보고서(유상증자결정)' },
        { rcept_dt: '20260201', report_nm: '사업보고서 (2025.12)' },
      ],
      [
        {
          rcept_dt: '2026-04-02',
          sp_stock_lmp_rate: '12.34',
          sp_stock_lmp_irds_rate: '0.56',
        },
      ],
      today,
    );

    expect(signals.recentDisclosureCount30d).toBe(2);
    expect(signals.recentPeriodicDisclosureCount30d).toBe(1);
    expect(signals.recentMaterialDisclosureCount30d).toBe(1);
    expect(signals.lastDisclosureDate).toBe('20260401');
    expect(signals.insiderOwnershipRate).toBeCloseTo(12.34);
    expect(signals.insiderOwnershipChangeRate).toBeCloseTo(0.56);
  });
});
