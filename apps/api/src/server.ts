import { existsSync } from "node:fs";
import { buildApp } from "./app";
import { loadConfig } from "./config";

// Local development convenience: read apps/api/.env if present (never committed).
if (existsSync(".env")) process.loadEnvFile(".env");

const config = loadConfig();
const { app } = await buildApp({ config, logger: true });

// Close the HTTP server and the database cleanly so restarts never find the DB locked.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    app.close().finally(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: "0.0.0.0" });
