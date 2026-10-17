import { accessSync, constants, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadScenario, type ScenarioStep } from "../src/scenario";

export interface PostResult {
  status: number;
  body: string;
}

const USAGE = "usage: hub:simulate <scenario.jsonl> [--url <hub>] [--token-file <path>]";
const DEFAULT_URL = "http://127.0.0.1:43710";
const MAX_BODY_CHARS = 200;
const TOKEN_HINT = "token not found – pass --token-file /mnt/c/Users/<you>/.vibetribe/token";

export async function runScenario(
  steps: ScenarioStep[],
  post: (envelope: unknown) => Promise<PostResult>,
): Promise<void> {
  for (const step of steps) {
    if (step.delayMs > 0) await new Promise((r) => setTimeout(r, step.delayMs));
    const { status, body } = await post(step.envelope);
    if (status !== 202) {
      const text = body.slice(0, MAX_BODY_CHARS).trim();
      throw new Error(`hub answered ${status}${text ? `: ${text}` : ""}`);
    }
  }
}

/** POSTs one envelope to /v1/event. The token is only sent as a header and never appears in an error message. */
export async function postEnvelope(
  url: string,
  token: string,
  envelope: unknown,
): Promise<PostResult> {
  let res: Response;
  try {
    res = await fetch(`${url}/v1/event`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(envelope),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: unknown } }).cause;
    const code = typeof cause?.code === "string" ? ` (${cause.code})` : "";
    throw new Error(`hub unreachable at ${url}${code}: ${(err as Error).message}`);
  }
  return { status: res.status, body: await res.text() };
}

export interface SimulateArgs {
  file: string;
  url: string;
  tokenFile: string | undefined;
}

export function parseArgs(argv: string[]): SimulateArgs {
  const file = argv[0];
  if (!file || file.startsWith("--")) throw new Error(USAGE);
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i < 0) return undefined;
    const v = argv[i + 1];
    if (!v || v.startsWith("--")) throw new Error(`${name} needs a value`);
    return v;
  };
  const url = (value("--url") ?? DEFAULT_URL).replace(/\/+$/, "");
  return { file, url, tokenFile: value("--token-file") };
}

export interface TokenLookup {
  home: string;
  wsl: boolean;
  listUsers(): string[];
  exists(path: string): boolean;
}

/** The hub's token lives in the Linux home first; from WSL it may only exist in a Windows user profile. */
export function findTokenFile(lookup: TokenLookup): string {
  const own = join(lookup.home, ".vibetribe", "token");
  if (lookup.exists(own)) return own;
  if (lookup.wsl) {
    for (const user of lookup.listUsers()) {
      const candidate = `/mnt/c/Users/${user}/.vibetribe/token`;
      if (lookup.exists(candidate)) return candidate;
    }
  }
  throw new Error(TOKEN_HINT);
}

const isReadable = (path: string): boolean => {
  try {
    accessSync(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
};

const listWindowsUsers = (): string[] => {
  try {
    return readdirSync("/mnt/c/Users");
  } catch {
    return [];
  }
};

async function main(argv: string[]): Promise<void> {
  const args = parseArgs(argv);
  const tokenPath =
    args.tokenFile ??
    findTokenFile({
      home: homedir(),
      wsl: Boolean(process.env.WSL_DISTRO_NAME),
      listUsers: listWindowsUsers,
      exists: isReadable,
    });
  const token = readFileSync(tokenPath, "utf8").trim();
  await runScenario(loadScenario(readFileSync(args.file, "utf8")), (envelope) =>
    postEnvelope(args.url, token, envelope),
  );
  process.stdout.write(`played ${args.file}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write(`${String(err)}\n`);
    process.exitCode = 1;
  });
}
