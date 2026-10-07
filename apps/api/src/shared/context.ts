import type { ProviderRegistry } from "@form/domain";
import type { FastifyBaseLogger } from "fastify";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import type { SingleFlight } from "./singleFlight";

/** Dependencies every module receives. `now` is injectable so time-dependent rules are testable. */
export interface AppContext {
  db: Db;
  providers: ProviderRegistry;
  now: () => Date;
  config: AppConfig;
  /** Structured logger (see shared/observability for what may and may not be logged). */
  log: FastifyBaseLogger;
  /** Collapses concurrent identical provider calls (see shared/singleFlight). */
  flights: SingleFlight;
}
