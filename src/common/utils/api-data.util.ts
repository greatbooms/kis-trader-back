export function pickNumeric(source: any, keys: string[]): number | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value === undefined || value === null || value === '') continue;
    const parsed = Number(String(value).replace(/,/g, ''));
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

export function pickString(source: any, keys: string[]): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== '') {
      return String(value);
    }
  }
  return undefined;
}
