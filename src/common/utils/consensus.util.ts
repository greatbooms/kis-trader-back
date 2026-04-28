import { pickNumeric, pickString } from './api-data.util';

export function summarizeInvestOpinion(investOpinion: any[] | undefined) {
  const rows = investOpinion ?? [];
  const latest = rows[0];
  const analystNames = new Set(
    rows
      .map((item) => pickString(item, ['mbcr_name', 'broker_name']))
      .filter((value): value is string => Boolean(value)),
  );

  return {
    targetPrice: pickNumeric(latest, ['hts_goal_prc', 'goal_pric', 'target_price', '목표가']),
    rating: pickString(latest, ['invt_opnn', 'opinion', 'rating', '투자의견']),
    analystCount: analystNames.size || undefined,
  };
}

function readDataColumn(row: any, index: number): number | undefined {
  if (!row || index < 0) return undefined;
  return pickNumeric(row, [`data${index + 1}`]);
}

export function summarizeEstimatePerform(estimatePerform: any) {
  if (!estimatePerform) {
    return {};
  }

  const output1 = estimatePerform.output1;
  const output3 = Array.isArray(estimatePerform.output3) ? estimatePerform.output3 : [];
  const output4 = Array.isArray(estimatePerform.output4) ? estimatePerform.output4 : [];

  let forecastIndex = output4.findIndex((item) => String(item?.dt ?? '').includes('E'));
  if (forecastIndex < 0) {
    forecastIndex = output4.length - 1;
  }

  return {
    rating: pickString(output1, ['rcmd_name', 'rating', 'opinion']),
    estimatedEps: readDataColumn(output3[1], forecastIndex),
    estimatedPer: readDataColumn(output3[3], forecastIndex),
    earningsSurprise: undefined as number | undefined,
  };
}
