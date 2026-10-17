/**
 * The claude.ai page with the usage limits and the Extra Usage switch (Extra key). The
 * plugin only opens it; it never changes account or billing settings itself.
 */
export const USAGE_SETTINGS_URL = "https://claude.ai/settings/usage";

/** Web pages the plugin may open besides its own /debug page: exactly these, nothing derived. */
const ALLOWED_WEB_URLS: ReadonlySet<string> = new Set([USAGE_SETTINGS_URL]);

/** Strict check right before a web page goes to the Stream Deck app. */
export const isAllowedWebUrl = (url: string): boolean => ALLOWED_WEB_URLS.has(url);

/**
 * Opens an allow-listed page through the surface (the Stream Deck app's `openUrl`, the same path
 * as /debug: no process of ours, no shell); anything else is refused and logged. True when handed over.
 */
export function openWebPage(
  surface: { openUrl(url: string): void },
  url: string,
  log: (line: string) => void,
): boolean {
  if (!isAllowedWebUrl(url)) {
    log(`open refused: ${JSON.stringify(url.slice(0, 80))} is not an allowed page`);
    return false;
  }
  surface.openUrl(url);
  return true;
}
