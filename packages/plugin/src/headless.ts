/**
 * The whole plugin without a Stream Deck: hub ingress + deck + mirror on /debug/keys, keys laid out
 * like the MK.2 default profile. Drive it with `pnpm hub:simulate <scenario> --token-file <file>`.
 * No session files and no usage endpoint are read; this is a pure simulator target.
 * Default port 43799, so it never collides with the real hub or plugin (it refuses their ports).
 */
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import {
  FALLBACK_PORTS,
  ingressError,
  parsePort,
  parseRemoteSessions,
  type RemotePorts,
} from "@vibetribe/hub";
import { DEFAULT_PORT } from "@vibetribe/protocol";
import type { Variant } from "@vibetribe/render";
import {
  MemorySurface,
  parseMaxFrames,
  parseVariant,
  type RunningVibeTribe,
  startVibeTribe,
} from "./compose";
import { defaultMk2Layout } from "./deck/keys";
import type { PressKind } from "./deck/press";
import { createLoggingOpener } from "./jump/opener";

export const HEADLESS_PORT = 43799;

export interface HeadlessConfig {
  port: number;
  token: string;
  maxFramesPerSecond: number;
  /** VIBETRIBE_VARIANT like the plugin */
  variant: Variant;
  warning: string | null;
  /** VIBETRIBE_REMOTE_FIXTURE: JSON in the shape of GET /v1/code/sessions; null = no REM source */
  remoteFixture: string | null;
}

/**
 * VIBETRIBE_PORT (invalid -> 43799, a port of the real hub -> error), VIBETRIBE_TOKEN (default:
 * random), VIBETRIBE_MAX_FRAMES and VIBETRIBE_VARIANT like the plugin.
 */
export function headlessConfig(env: NodeJS.ProcessEnv): HeadlessConfig {
  let port = HEADLESS_PORT;
  let warning: string | null = null;
  if (env.VIBETRIBE_PORT !== undefined) {
    const parsed = parsePort(env.VIBETRIBE_PORT);
    if (parsed.warning) warning = `ignoring invalid VIBETRIBE_PORT, using ${HEADLESS_PORT}`;
    else port = parsed.port;
  }
  // the ports of the real hub / plugin: a simulator must never bind them
  if ([DEFAULT_PORT, ...FALLBACK_PORTS].includes(port)) {
    throw new Error(`port ${port} belongs to the real hub; headless refuses it`);
  }
  return {
    port,
    token: env.VIBETRIBE_TOKEN || randomUUID(),
    maxFramesPerSecond: parseMaxFrames(env.VIBETRIBE_MAX_FRAMES),
    variant: parseVariant(env.VIBETRIBE_VARIANT),
    warning,
    remoteFixture: env.VIBETRIBE_REMOTE_FIXTURE || null,
  };
}

/**
 * Remote sessions without the real API: every poll re-reads the file (edit it while headless
 * runs) and passes it through the real parser. The token is a dummy; nothing leaves the machine.
 */
export function remoteFixturePorts(
  path: string,
  read: (p: string) => Promise<string> = (p) => readFile(p, "utf8"),
): RemotePorts {
  return {
    readCredentials: async () => ({
      accessToken: "fixture",
      expiresAt: Number.MAX_SAFE_INTEGER,
    }),
    fetchSessions: async () => {
      let json: unknown;
      try {
        json = JSON.parse(await read(path));
      } catch {
        return { kind: "error", message: "fixture unreadable" };
      }
      const sessions = parseRemoteSessions(json);
      return sessions
        ? { kind: "ok", sessions }
        : { kind: "error", message: "unexpected response" };
    },
  };
}

/** One stdin line of the headless mode: `press <key-id>` (short) or `long <key-id>`. */
export function parsePressLine(line: string): { id: string; kind: PressKind } | null {
  const m = /^\s*(press|long)\s+(\S+)\s*$/.exec(line);
  if (!m?.[2]) return null;
  return { id: m[2], kind: m[1] === "long" ? "long" : "short" };
}

export interface HeadlessIo {
  /** where `out/headless-token-<port>` goes */
  cwd: string;
  log: (line: string) => void;
  print: (text: string) => void;
}

/** Starts the headless app; on a failed listen it stops, prints the reason and returns null. */
export async function startHeadless(
  env: NodeJS.ProcessEnv,
  io: HeadlessIo,
): Promise<RunningVibeTribe | null> {
  const config = headlessConfig(env);
  if (config.warning) io.log(config.warning);
  const fixture = config.remoteFixture ? resolve(io.cwd, config.remoteFixture) : null;
  const app = await startVibeTribe({
    surface: new MemorySurface(),
    hub: {
      port: config.port,
      token: config.token,
      sources: [],
      usage: null,
      remote: fixture ? { ports: remoteFixturePorts(fixture) } : null,
    },
    // jumps are logged, never executed (spec §11.1 simulator)
    opener: createLoggingOpener(io.log),
    log: io.log,
    maxFramesPerSecond: config.maxFramesPerSecond,
    variant: config.variant,
  });
  const failure = ingressError(app.hub, Date.now());
  if (failure) {
    io.log(`headless: ${failure}`);
    await app.stop();
    return null;
  }
  for (const key of defaultMk2Layout()) app.keyAppeared(key);
  // after a successful listen only: a failed start must not clobber another instance's token file
  const out = join(io.cwd, "out");
  mkdirSync(out, { recursive: true });
  const tokenFile = join(out, `headless-token-${app.port}`);
  writeFileSync(tokenFile, config.token, { mode: 0o600 });
  chmodSync(tokenFile, 0o600);
  const url = `http://127.0.0.1:${app.port}`;
  io.print(
    `VibeTribe headless: ${url}/debug/keys\n` +
      `play a scenario: pnpm hub:simulate packages/hub/fixtures/scenarios/three-sessions-one-waiting.jsonl --url ${url} --token-file ${tokenFile}\n` +
      `remote sessions: ${fixture ?? "off (set VIBETRIBE_REMOTE_FIXTURE=packages/hub/fixtures/remote/sessions.json)"}\n` +
      "press keys on stdin: press <key-id> | long <key-id> (ids in /debug/keys.json, e.g. mk2:1:0)\n",
  );
  return app;
}

async function main(): Promise<void> {
  const app = await startHeadless(process.env, {
    cwd: process.cwd(),
    log: (line) => process.stderr.write(`${line}\n`),
    print: (text) => process.stdout.write(text),
  });
  if (!app) {
    process.exitCode = 1;
    return;
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      app.stop().finally(() => process.exit(0));
    });
  }
  createInterface({ input: process.stdin }).on("line", (line) => {
    const press = parsePressLine(line);
    if (press) app.press(press.id, press.kind);
    else if (line.trim()) process.stderr.write(`unknown input: ${line.trim()}\n`);
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exitCode = 1;
  });
}
