export function kstTodayStr(): string {
  return toKstDateStr(new Date());
}

export function kstDateNDaysAgo(days: number): string {
  const date = toKstDate(new Date());
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function toKstDate(date: Date): Date {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000);
}

function toKstDateStr(date: Date): string {
  return toKstDate(date).toISOString().slice(0, 10).replace(/-/g, '');
}
