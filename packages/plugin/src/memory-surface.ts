import type { DeckSurface } from "./compose";

/** Surface without hardware: remembers the last image per key (headless mode, tests). */
export class MemorySurface implements DeckSurface {
  readonly images = new Map<string, string>();
  readonly urls: string[] = [];
  readonly alerts: string[] = [];
  readonly switches: { keyId: string; device: string; profile: string | undefined }[] = [];

  setImage(keyId: string, image: string): boolean {
    this.images.set(keyId, image);
    return true;
  }

  openUrl(url: string): void {
    this.urls.push(url);
  }

  showAlert(keyId: string): void {
    this.alerts.push(keyId);
  }

  switchProfile(keyId: string, device: string, profile?: string): void {
    this.switches.push({ keyId, device, profile });
  }
}
