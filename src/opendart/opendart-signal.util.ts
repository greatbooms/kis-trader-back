import { OpenDartDisclosureItem, OpenDartDomesticSignals, OpenDartOwnershipItem } from './types';

const PERIODIC_REPORT_PATTERN = /(사업보고서|반기보고서|분기보고서)/;
const MATERIAL_DISCLOSURE_PATTERN = /(주요사항보고서|조회공시|공정공시|유상증자|무상증자|전환사채|신주인수권부사채|감자|합병|분할|영업양수도|단일판매|실적|잠정실적|자기주식|소송|횡령|배임)/;

function parseDartDate(value?: string): Date | undefined {
  if (!value) return undefined;
  const normalized = value.includes('-')
    ? value
    : value.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
  const parsed = new Date(`${normalized}T00:00:00+09:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function daysSince(value: Date, today: Date): number {
  return Math.floor((today.getTime() - value.getTime()) / (24 * 60 * 60 * 1000));
}

function toNumber(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function buildOpenDartDomesticSignals(
  disclosures: OpenDartDisclosureItem[],
  ownershipItems: OpenDartOwnershipItem[],
  today = new Date(),
): OpenDartDomesticSignals {
  const sortedDisclosures = [...disclosures]
    .filter((item) => parseDartDate(item.rcept_dt))
    .sort((a, b) => (parseDartDate(b.rcept_dt)?.getTime() ?? 0) - (parseDartDate(a.rcept_dt)?.getTime() ?? 0));
  const recent30d = sortedDisclosures.filter((item) => {
    const filedAt = parseDartDate(item.rcept_dt);
    return filedAt ? daysSince(filedAt, today) <= 30 : false;
  });

  const latestDisclosure = sortedDisclosures[0];
  const latestOwnership = [...ownershipItems]
    .filter((item) => parseDartDate(item.rcept_dt))
    .sort((a, b) => (parseDartDate(b.rcept_dt)?.getTime() ?? 0) - (parseDartDate(a.rcept_dt)?.getTime() ?? 0))[0];

  return {
    recentDisclosureCount30d: recent30d.length || undefined,
    recentPeriodicDisclosureCount30d: recent30d.filter((item) => PERIODIC_REPORT_PATTERN.test(item.report_nm ?? '')).length || undefined,
    recentMaterialDisclosureCount30d: recent30d.filter((item) => MATERIAL_DISCLOSURE_PATTERN.test(item.report_nm ?? '')).length || undefined,
    lastDisclosureDate: latestDisclosure?.rcept_dt,
    lastDisclosureTitle: latestDisclosure?.report_nm,
    insiderOwnershipRate: toNumber(latestOwnership?.sp_stock_lmp_rate),
    insiderOwnershipChangeRate: toNumber(latestOwnership?.sp_stock_lmp_irds_rate),
    latestOwnershipReportDate: latestOwnership?.rcept_dt,
  };
}
