import { win32 } from "node:path";

/** The Windows directory: SystemRoot only when it is a plain drive path without "..", else C:\Windows. */
export function systemRoot(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.SystemRoot;
  const safe =
    root !== undefined && /^[A-Za-z]:\\[A-Za-z0-9 ._\\-]*$/.test(root) && !root.includes("..");
  return safe ? root : "C:\\Windows";
}

/** A program in System32 by absolute path: neither PATH nor a planted copy in the cwd is ever used. */
export const system32Exe = (name: string, env: NodeJS.ProcessEnv = process.env): string =>
  win32.join(systemRoot(env), "System32", name);
