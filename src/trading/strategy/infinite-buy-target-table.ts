export interface TargetTableRow {
  maxT: number;
  primary: number;
  bonus: number;
}

export type TargetTable = readonly TargetTableRow[];

export const INFINITE_BUY_TARGET_TABLE: TargetTable = [
  { maxT: 2,  primary: 0.160, bonus: 0.030 },
  { maxT: 4,  primary: 0.150, bonus: 0.030 },
  { maxT: 6,  primary: 0.135, bonus: 0.026 },
  { maxT: 8,  primary: 0.120, bonus: 0.026 },
  { maxT: 10, primary: 0.110, bonus: 0.022 },
  { maxT: 12, primary: 0.100, bonus: 0.022 },
  { maxT: 14, primary: 0.095, bonus: 0.018 },
  { maxT: 16, primary: 0.090, bonus: 0.018 },
  { maxT: 18, primary: 0.085, bonus: 0.018 },
  { maxT: 20, primary: 0.080, bonus: 0.018 },
  { maxT: 24, primary: 0.077, bonus: 0.014 },
  { maxT: 28, primary: 0.074, bonus: 0.014 },
  { maxT: 32, primary: 0.072, bonus: 0.011 },
  { maxT: 36, primary: 0.070, bonus: 0.011 },
  { maxT: 40, primary: 0.068, bonus: 0.011 },
  { maxT: Infinity, primary: 0.050, bonus: 0.011 }, // 완주 후 (T >= 40): +5% 탈출 가속
];

function lookup(T: number, table: TargetTable): TargetTableRow {
  for (const row of table) {
    if (T < row.maxT) return row;
  }
  return table[table.length - 1];
}

export function lookupTargetProfitRate(T: number, override?: TargetTable): number {
  const table = override && override.length > 0 ? override : INFINITE_BUY_TARGET_TABLE;
  return lookup(T, table).primary;
}

export function lookupSecondaryBonusRate(T: number, override?: TargetTable): number {
  const table = override && override.length > 0 ? override : INFINITE_BUY_TARGET_TABLE;
  return lookup(T, table).bonus;
}
