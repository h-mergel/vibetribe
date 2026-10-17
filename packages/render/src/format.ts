/** Reset countdown as on the tiles: "42m", "2h 15m", "3d 4h" (rounded up to the minute). */
export function formatDuration(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60_000));
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** Wall-clock time "14:32" for "As of 14:32" (24 h, in the given time zone). */
export function formatClock(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone }).format(
    ms,
  );
}

/** Amount with the currency sign as the tiles show it: "€12.40", "€1,234.56", "$5.00". */
export function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}
