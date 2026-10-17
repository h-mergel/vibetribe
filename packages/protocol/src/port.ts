/** The hub's first-choice port on 127.0.0.1 (spec §8.2); reporters use it while no port file exists. */
export const DEFAULT_PORT = 43710;

/** The file next to the hub token (`%USERPROFILE%\.vibetribe\`) naming the port the hub listens on. */
export const PORT_FILE = "port";

/** A TCP port in 1..65535 written as decimal digits only; null for anything else. */
export function parsePortNumber(raw: string): number | null {
  const n = /^[0-9]+$/.test(raw) ? Number(raw) : Number.NaN;
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : null;
}
