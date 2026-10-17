import { join } from "node:path";
import streamDeck from "@elgato/streamdeck";
import {
  createFileLog,
  dataDirOf,
  isProcessAlive,
  readHubToken,
  windowsHubConfig,
} from "@vibetribe/hub";
import { registerActions } from "./actions";
import { parseMaxFrames, parseVariant, type RunningVibeTribe, startVibeTribe } from "./compose";
import { createRundll32Opener } from "./jump/opener";
import { watchParent } from "./parent";
import { createSdkSurface } from "./sdk/surface";
import { followPreferPinned } from "./settings";

// Spec §11.1: our logs live under %APPDATA%\vibetribe\logs, never in the plugin directory.
const log = createFileLog(join(dataDirOf(), "logs"), "plugin");
const describe = (err: unknown): string =>
  err instanceof Error ? (err.stack ?? String(err)) : String(err);

let app: RunningVibeTribe | null = null;
let started = false;

/** The hub listens before the SDK connects: a failed startup must not linger holding the port. */
async function abortStartup(err: unknown): Promise<never> {
  log(`startup failed: ${describe(err)}`);
  await app?.stop().catch((e) => log(`stop failed: ${describe(e)}`));
  process.exit(1);
}

// After startup nothing may end the plugin; before it, the SDK reports a refused connection only
// as an uncaught error, which would otherwise leave a hub without a deck behind it.
process.on("uncaughtException", (err) => {
  log(`uncaught exception: ${describe(err)}`);
  if (!started) void abortStartup(err);
});
process.on("unhandledRejection", (err) => {
  log(`unhandled rejection: ${describe(err)}`);
  if (!started) void abortStartup(err);
});

try {
  const token = readHubToken();
  const { config, summary } = await windowsHubConfig({ log, token });
  const variant = parseVariant(process.env.VIBETRIBE_VARIANT);
  app = await startVibeTribe({
    surface: createSdkSurface(streamDeck, log),
    hub: config,
    // the SDK's openUrl refuses claude:// links: rundll32 opens them
    opener: createRundll32Opener(log),
    log,
    maxFramesPerSecond: parseMaxFrames(process.env.VIBETRIBE_MAX_FRAMES),
    variant,
  });
  registerActions(app);
  await streamDeck.connect();
  started = true;
  followPreferPinned(streamDeck.settings, (on) => app?.setPreferPinned(on), log);
  // Stream Deck does not always stop its plugins: an orphan would hold the hub port
  watchParent(process.ppid, isProcessAlive, () => {
    log("Stream Deck is gone: stopping");
    void (app?.stop() ?? Promise.resolve())
      .catch((e) => log(`stop failed: ${describe(e)}`))
      .finally(() => process.exit(0));
  });
  log(`plugin started: port ${app.port ?? "none"}, ${summary}, tiles ${variant}`);
} catch (err) {
  await abortStartup(err);
}
