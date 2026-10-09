import { existsSync } from "node:fs";
import { providerStatuses } from "@form/domain";
import { buildApp } from "./app";
import { loadConfig } from "./config";

// Local development convenience: read apps/api/.env if present (never committed).
if (existsSync(".env")) process.loadEnvFile(".env");

const config = loadConfig();
const { app, ctx } = await buildApp({ config, logger: true });

// Close the HTTP server and the database cleanly so restarts never find the DB locked.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.close().finally(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: "0.0.0.0" });

// One line per provider at boot, so a deploy's logs say plainly what is and isn't switched on
// (secret names only — never values).
for (const p of providerStatuses(ctx.providers)) {
  app.log.info({ provider: p.kind, state: p.state, name: p.provider, ...(p.state === "unconfigured" ? { missing: p.missing } : {}) }, "provider status");
}
