// Test preload (vitest setupFiles): no test may reach or bind the ports of the real hub, and no test
// may connect to a host other than loopback. It throws before a socket opens; node processes the
// tests spawn load it too, through NODE_OPTIONS.
import net from "node:net";

/** DEFAULT_PORT and FALLBACK_PORTS of the hub: the plugin on the user's machine listens on one. */
export const GUARDED_PORTS = Object.freeze([43710, 37710, 31710, 25710]);

const MARK = Symbol.for("vibetribe.realPortsGuard");
const portOf = (arg) =>
  Array.isArray(arg)
    ? portOf(arg[0])
    : typeof arg === "object" && arg !== null
      ? Number(arg.port)
      : Number(arg);

const LOOPBACK = Object.freeze(["127.0.0.1", "::1", "localhost"]);
/** The host of a TCP connect; null for a pipe or Unix socket. */
const hostOf = (args) => {
  const [first, second] = Array.isArray(args[0]) ? args[0] : args;
  if (typeof first === "object" && first !== null)
    return first.path === undefined ? (first.host ?? "localhost") : null;
  if (typeof first === "string" && Number.isNaN(Number(first))) return null;
  return typeof second === "string" ? second : "localhost";
};

// The OS may hand a port-0 listener one of the guarded ports (WSL's ephemeral range includes 43710).
// The server then closes silently and binds again before its caller sees "listening" or "close".
function avoidGuardedPorts(server, listen, args) {
  const emit = server.emit;
  const rebindArgs = args.filter((arg) => typeof arg !== "function");
  let silentCloses = 0;
  server.emit = function guardedEmit(event, ...rest) {
    if (event === "listening" && GUARDED_PORTS.includes(this.address()?.port)) {
      silentCloses++;
      this.close();
      listen.apply(this, rebindArgs);
      return false;
    }
    if (event === "close" && silentCloses > 0) {
      silentCloses--;
      return false;
    }
    return emit.call(this, event, ...rest);
  };
}

if (!globalThis[MARK]) {
  globalThis[MARK] = true;
  for (const [proto, name] of [
    [net.Socket.prototype, "connect"],
    [net.Server.prototype, "listen"],
  ]) {
    const original = proto[name];
    proto[name] = function guarded(...args) {
      const port = portOf(args[0]);
      if (GUARDED_PORTS.includes(port)) {
        throw new Error(`test guard: port ${port} belongs to the real hub`);
      }
      const host = name === "connect" ? hostOf(args) : null;
      if (host !== null && !LOOPBACK.includes(host))
        throw new Error(`test guard: ${host} is not a loopback host`);
      if (name === "listen" && (port === 0 || args[0] == null))
        avoidGuardedPorts(this, original, args);
      return original.apply(this, args);
    };
  }
  const self = `--import=${import.meta.url}`;
  const options = process.env.NODE_OPTIONS ?? "";
  if (!options.includes(self)) process.env.NODE_OPTIONS = `${options} ${self}`.trim();
}
