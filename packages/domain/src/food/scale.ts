/**
 * ScaleProvider — a kitchen scale connected to the device. The provider only reports raw events
 * (connected, a weight sample, disconnected, an error); `scaleReducer` turns them into the one
 * state the UI shows, and decides deterministically when a weight is stable.
 *
 * States: not connected → connecting → connected → reading weight → weight stable (or error).
 *
 * Only a stable reading may become a measured portion. Manual entry of a weight read off any
 * scale is always available; a provider that can't reach a scale on this device says so with
 * `supported: false` instead of pretending.
 */

export type ScaleErrorCode = "unsupported" | "permission_denied" | "not_found" | "disconnected" | "out_of_range" | "failed";

export interface ScaleSample {
  grams: number;
  atMs: number;
}

export type ScaleState =
  | { status: "not_connected" }
  | { status: "connecting" }
  | { status: "connected"; device: string }
  | { status: "reading"; device: string; grams: number; samples: ScaleSample[] }
  | { status: "stable"; device: string; grams: number; samples: ScaleSample[] }
  | { status: "error"; code: ScaleErrorCode; message: string };

export type ScaleStatus = ScaleState["status"];

export type ScaleEvent =
  | { type: "connect" }
  | { type: "connected"; device: string }
  | { type: "sample"; grams: number; atMs: number }
  | { type: "disconnected" }
  | { type: "error"; code: ScaleErrorCode; message: string }
  | { type: "reset" };

export const SCALE_STABILITY = {
  /** The weight must hold for this long… */
  windowMs: 1000,
  /** …across at least this many samples (further back for slow scales)… */
  minSamples: 3,
  /** …within ±max(toleranceG, relativeTolerance × weight). */
  toleranceG: 1,
  relativeTolerance: 0.005,
  /** Samples older than this are dropped. */
  historyMs: 3000,
  maxGrams: 5000,
} as const;

export const SCALE_IDLE: ScaleState = { status: "not_connected" };

/**
 * Whether the recent samples have settled, and on what weight (their mean, to 0.1 g). The samples
 * considered must cover the whole window (one at or before its start) and number at least
 * minSamples (reaching further back for slow scales), and all stay within the tolerance. Works the
 * same for a scale reporting 10 times a second or once a second.
 */
export function stableWeight(samples: readonly ScaleSample[]): { stable: boolean; grams: number } {
  const last = samples.at(-1);
  if (!last) return { stable: false, grams: 0 };
  const cutoff = last.atMs - SCALE_STABILITY.windowMs;
  let start = -1;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i]!.atMs <= cutoff) {
      start = i;
      break;
    }
  }
  const covered = start >= 0 && samples.length >= SCALE_STABILITY.minSamples;
  const window = covered ? samples.slice(Math.min(start, samples.length - SCALE_STABILITY.minSamples)) : samples;
  const min = Math.min(...window.map((s) => s.grams));
  const max = Math.max(...window.map((s) => s.grams));
  const mean = window.reduce((a, s) => a + s.grams, 0) / window.length;
  const tolerance = Math.max(SCALE_STABILITY.toleranceG, SCALE_STABILITY.relativeTolerance * Math.abs(mean));
  return { stable: covered && max - min <= 2 * tolerance, grams: Math.round(mean * 10) / 10 };
}

function deviceOf(s: ScaleState): string | null {
  return "device" in s ? s.device : null;
}

export function scaleReducer(state: ScaleState, event: ScaleEvent): ScaleState {
  switch (event.type) {
    case "connect":
      return { status: "connecting" };
    case "connected":
      return { status: "connected", device: event.device };
    case "disconnected":
      return state.status === "not_connected" || state.status === "connecting" ? SCALE_IDLE : { status: "error", code: "disconnected", message: "The scale disconnected." };
    case "error":
      return { status: "error", code: event.code, message: event.message };
    case "reset":
      return SCALE_IDLE;
    case "sample": {
      const device = deviceOf(state);
      if (!device) return state; // samples before a connection are ignored
      if (!Number.isFinite(event.grams) || event.grams > SCALE_STABILITY.maxGrams) {
        return { status: "error", code: "out_of_range", message: "That's more than the scale can weigh accurately." };
      }
      const prev = state.status === "reading" || state.status === "stable" ? state.samples : [];
      const samples = [...prev.filter((s) => s.atMs >= event.atMs - SCALE_STABILITY.historyMs && s.atMs <= event.atMs), { grams: event.grams, atMs: event.atMs }];
      const { stable, grams } = stableWeight(samples);
      return stable ? { status: "stable", device, grams, samples } : { status: "reading", device, grams: Math.round(event.grams * 10) / 10, samples };
    }
  }
}

/** A stable reading as a gram portion, or null when it isn't a usable measurement (unsettled, empty, too heavy). */
export function measuredPortionFromScale(state: ScaleState): { quantity: number; unit: "g" } | null {
  if (state.status !== "stable") return null;
  if (!(state.grams >= 0.1) || state.grams > SCALE_STABILITY.maxGrams) return null;
  return { quantity: state.grams, unit: "g" };
}

export interface ScaleProvider {
  readonly kind: "scale";
  readonly name: string;
  /** A simulated scale for development — never real readings. The UI must say so. */
  readonly development: boolean;
  /** False when this device/build has no way to reach a scale. The UI offers manual entry only. */
  readonly supported: boolean;
  /** Starts connecting; events arrive through `onEvent`. Returns a function that disconnects. */
  connect(onEvent: (e: ScaleEvent) => void): () => void;
  /** Zeroes the scale, when the scale supports it. */
  tare?(): void;
}

/** The provider when no scale integration exists on this device. It never claims a connection. */
export const NO_SCALE_PROVIDER: ScaleProvider = {
  kind: "scale",
  name: "No connected scale",
  development: false,
  supported: false,
  connect(onEvent) {
    onEvent({ type: "error", code: "unsupported", message: "Connecting a smart scale isn't supported yet. Weigh the food and type the weight." });
    return () => {};
  },
};
