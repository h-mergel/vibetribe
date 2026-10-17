#!/usr/bin/env node
// PROBE ONLY. Listens on the given address and logs request lines; answers 202. Usage: node listen.mjs <tailscale-ip> [port]
import { createServer } from "node:http";

const host = process.argv[2];
const port = Number(process.argv[3] ?? 43711);
if (!host) {
  console.error("usage: node listen.mjs <tailscale-ip> [port]");
  process.exit(2);
}
createServer((req, res) => {
  console.log(`${new Date().toISOString()} ${req.socket.remoteAddress} ${req.method} ${req.url} auth=${req.headers.authorization ? "yes" : "no"}`);
  res.writeHead(202).end();
})
  .on("error", (e) => console.error(`listen error: ${e.code}`))
  .listen(port, host, () => console.log(`listening on ${host}:${port}`));
