/** Helpers of the server-rendered debug pages. */

export const esc = (s: unknown): string =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

/** HH:MM:SS; "–" for no time or a non-finite one (Intl throws on NaN). */
export const clock = (ms: number | null, timeZone?: string): string =>
  ms === null || !Number.isFinite(ms)
    ? "–"
    : new Intl.DateTimeFormat("de-DE", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone,
      }).format(ms);
