import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_PORT, isObj, PORT_FILE, parsePortNumber } from "@vibetribe/protocol";

export const DEFAULT_HUB_URL = `http://127.0.0.1:${DEFAULT_PORT}`;

export interface PreviousStatusline {
  command: string;
  padding?: number;
  refreshInterval?: number;
  /** Windows: shell Claude Code uses for statuslines (Git Bash); null/absent = platform default */
  shell?: string;
}

export interface ReporterConfig {
  /** an explicitly configured hub; null = the hub's port file decides (hubUrlOf) */
  hubUrl: string | null;
  tokenPath: string;
  previousStatusline: PreviousStatusline | null;
}

type ReadText = (path: string) => string;
const readUtf8: ReadText = (path) => readFileSync(path, "utf8");

export const vibetribeDir = (home: string): string => join(home, ".vibetribe");

/** The statusLine fields Claude Code knows (command, padding, refreshInterval); null without a string command. */
export function statuslineFields(v: unknown): PreviousStatusline | null {
  if (!isObj(v) || typeof v.command !== "string") return null;
  const prev: PreviousStatusline = { command: v.command };
  if (typeof v.padding === "number") prev.padding = v.padding;
  if (typeof v.refreshInterval === "number") prev.refreshInterval = v.refreshInterval;
  return prev;
}

function previousOf(v: unknown): PreviousStatusline | null {
  const prev = statuslineFields(v);
  if (prev && isObj(v) && typeof v.shell === "string" && v.shell.length > 0) prev.shell = v.shell;
  return prev;
}

/** Never throws: missing or broken config falls back to defaults (fail-open). */
export function loadConfig(home: string, readText: ReadText = readUtf8): ReporterConfig {
  const defaults: ReporterConfig = {
    hubUrl: null,
    tokenPath: join(vibetribeDir(home), "token"),
    previousStatusline: null,
  };
  let raw: unknown;
  try {
    raw = JSON.parse(readText(join(vibetribeDir(home), "config.json")));
  } catch {
    return defaults;
  }
  if (!isObj(raw)) return defaults;
  return {
    // earlier setups wrote DEFAULT_HUB_URL into every config: that is no explicit choice
    hubUrl:
      typeof raw.hubUrl === "string" && raw.hubUrl.length > 0 && raw.hubUrl !== DEFAULT_HUB_URL
        ? raw.hubUrl
        : null,
    tokenPath:
      typeof raw.tokenPath === "string" && raw.tokenPath.length > 0
        ? raw.tokenPath
        : defaults.tokenPath,
    previousStatusline: previousOf(raw.previousStatusline),
  };
}

/**
 * Where hooks and the statusline post: an explicit hubUrl; else 127.0.0.1 on the port the hub
 * wrote next to the token (`%USERPROFILE%\.vibetribe\port`, in WSL through /mnt/c); else
 * DEFAULT_PORT. Never throws.
 */
export function hubUrlOf(config: ReporterConfig, readText: ReadText = readUtf8): string {
  if (config.hubUrl) return config.hubUrl;
  let port: number | null = null;
  try {
    port = parsePortNumber(readText(join(dirname(config.tokenPath), PORT_FILE)).trim());
  } catch {
    // missing or unreadable: DEFAULT_PORT below
  }
  return `http://127.0.0.1:${port ?? DEFAULT_PORT}`;
}

export function readToken(path: string, readText: ReadText = readUtf8): string | null {
  try {
    const token = readText(path).trim();
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}
