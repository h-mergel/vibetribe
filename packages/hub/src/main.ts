import { join } from "node:path";
import { createFileLog, dataDirOf, readHubToken, windowsHubConfig, wslDistro } from "./compose";
import { ingressError, startHub } from "./runtime";

const log = createFileLog(join(dataDirOf(), "logs"), "hub");

// The loops are built to survive; anything that still escapes is logged, not fatal.
process.on("uncaughtException", (err) => log(`uncaught exception: ${String(err)}`));
process.on("unhandledRejection", (err) => log(`unhandled rejection: ${String(err)}`));

// read once: the same value gates the start and becomes the ingress token
const token = readHubToken();
if (!token) {
  process.stderr.write(
    "VibeTribe: no token at %USERPROFILE%\\.vibetribe\\token, run `node reporter.mjs setup` first\n",
  );
  process.exit(1);
}

const { config, summary, wslSource } = await windowsHubConfig({ log, token });
// plugin and hub.mjs never at the same time: on a taken first port this hub exits instead of
// moving to a fallback port
const running = await startHub({ ...config, fallbackPorts: [] });
// A second hub (e.g. the plugin already owns the port) must not run a second poller or refresher.
const failure = ingressError(running, Date.now());
if (failure) {
  process.stderr.write(`VibeTribe: ${failure} - is the plugin already running?\n`);
  log(`exiting: ${failure}`);
  await running.stop();
  process.exit(2);
}
log(`started: ${summary}`);
// wsl.exe can take seconds right after login: WSL joins once its distribution is known
void wslDistro().then((distro) => {
  log(`wsl: ${distro ?? "none"}`);
  if (distro) running.addSource(wslSource(distro));
});
process.stdout.write(`VibeTribe hub on http://127.0.0.1:${running.port}/debug (Ctrl+C to stop)\n`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    log(`${signal}: stopping`);
    running.stop().finally(() => process.exit(0));
  });
}
