import { describe, expect, it } from "vitest";
import { activeDurationMinutes, SESSION_LIMITS, sessionIdleMs } from "../src";

const at = (min: number) => new Date(Date.parse("2026-09-30T08:00:00Z") + min * 60_000);

describe("sessionIdleMs — a workout left open", () => {
  it("counts nothing as idle within the limit, and the whole gap once past it", () => {
    expect(sessionIdleMs({ status: "active", lastActivityAt: at(0), now: at(SESSION_LIMITS.idleMinutes) })).toBe(0);
    expect(sessionIdleMs({ status: "active", lastActivityAt: at(0), now: at(SESSION_LIMITS.idleMinutes + 1) })).toBe((SESSION_LIMITS.idleMinutes + 1) * 60_000);
  });

  it("never applies to a paused or finished session (pauses already don't count)", () => {
    for (const status of ["paused", "completed", "discarded"] as const) expect(sessionIdleMs({ status, lastActivityAt: at(0), now: at(600) })).toBe(0);
  });

  it("as a pause, idle time comes out of the duration", () => {
    const idle = sessionIdleMs({ status: "active", lastActivityAt: at(20), now: at(620) });
    expect(activeDurationMinutes({ startedAt: at(0), end: at(622), pausedMs: idle, pausedAt: null })).toBe(22);
  });
});
