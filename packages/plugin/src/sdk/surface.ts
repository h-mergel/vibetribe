import type { DeckSurface } from "../compose";

/** The slice of the Stream Deck SDK the surface uses; the real `streamDeck` satisfies it. */
export interface SdkLike {
  actions: {
    getActionById(id: string): SdkAction | undefined;
  };
  system: { openUrl(url: string): Promise<void> };
  profiles: { switchToProfile(deviceId: string, profile?: string): Promise<void> };
}

export interface SdkAction {
  isKey(): this is SdkKey;
}

export interface SdkKey {
  setImage(image: string): Promise<void>;
  showAlert(): Promise<void>;
}

/** The only place that talks to the Stream Deck app: images, URLs, profiles. Never throws. */
export function createSdkSurface(sd: SdkLike, log: (line: string) => void): DeckSurface {
  const showAlert = (keyId: string): void => {
    try {
      const action = sd.actions.getActionById(keyId);
      if (!action?.isKey()) {
        log(`showAlert ${keyId} dropped: action not visible`);
        return;
      }
      action.showAlert().catch((err) => log(`showAlert ${keyId} rejected: ${String(err)}`));
    } catch (err) {
      log(`showAlert ${keyId} failed: ${String(err)}`);
    }
  };
  return {
    setImage(keyId, image) {
      try {
        const action = sd.actions.getActionById(keyId);
        if (!action?.isKey()) {
          log(`setImage ${keyId} dropped: action not visible`);
          return false;
        }
        action.setImage(image).catch((err) => log(`setImage ${keyId} rejected: ${String(err)}`));
        return true;
      } catch (err) {
        log(`setImage ${keyId} failed: ${String(err)}`);
        return false;
      }
    },
    openUrl(url) {
      try {
        sd.system.openUrl(url).catch((err) => log(`openUrl rejected: ${String(err)}`));
      } catch (err) {
        log(`openUrl failed: ${String(err)}`);
      }
    },
    showAlert,
    switchProfile(keyId, device, profile) {
      const name = profile ?? "previous";
      try {
        sd.profiles.switchToProfile(device, profile).catch((err) => {
          log(`switchProfile ${name} rejected: ${String(err)}`);
          showAlert(keyId);
        });
      } catch (err) {
        log(`switchProfile ${name} failed: ${String(err)}`);
        showAlert(keyId);
      }
    },
  };
}
