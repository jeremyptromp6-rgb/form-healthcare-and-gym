import type { EngineMessage } from '@/components/camera/poseFeedCore';
import { config } from '@/lib/config';
import {
  FormPoseCameraView,
  isFormPoseCameraAvailable,
  type NativeCameraEvent,
  type NativeDiagEvent,
  type NativeFrameEvent,
  type NativePoseEvent,
} from '../../../modules/form-pose-camera';
import type { PoseDiag } from './status';

/** True when the native Android pose camera can run: this build has the module and it isn't switched off. */
export function nativePoseAvailable(): boolean {
  return config.nativePose && isFormPoseCameraAvailable();
}

/** The native camera + pose view, or null when this runtime has none. */
export const NativePoseView = FormPoseCameraView;

/** The flat landmark list of a frame event (99 numbers, [x, y, visibility] x 33) as the engines' per-person triples. */
export function peopleFromLm(lm: readonly number[] | null | undefined): [number, number, number][][] {
  if (!lm || lm.length !== 99) return [];
  const person: [number, number, number][] = [];
  for (let i = 0; i < 99; i += 3) person.push([lm[i]!, lm[i + 1]!, lm[i + 2]!]);
  return [person];
}

/**
 * A native event as the WebView engine's message, so the shared handler treats both engines alike.
 * Fields the native side has nothing to say for arrive as null and become undefined; a brightness of
 * -1 means "unknown".
 */
export function toEngineMessage(src: 'camera', e: NativeCameraEvent): EngineMessage;
export function toEngineMessage(src: 'pose', e: NativePoseEvent): EngineMessage;
export function toEngineMessage(src: 'frame', e: NativeFrameEvent): EngineMessage;
export function toEngineMessage(src: 'camera' | 'pose' | 'frame', e: NativeCameraEvent | NativePoseEvent | NativeFrameEvent): EngineMessage {
  if (src === 'camera') {
    const c = e as NativeCameraEvent;
    return { t: 'camera', kind: c.kind, name: c.name ?? undefined };
  }
  if (src === 'pose') {
    const p = e as NativePoseEvent;
    return {
      t: 'pose',
      kind: p.kind,
      stage: p.stage ?? undefined,
      pct: p.pct ?? undefined,
      backend: p.backend ?? undefined,
      variant: p.variant ?? undefined,
      offline: p.offline ?? undefined,
      fatal: p.fatal ?? undefined,
    };
  }
  const f = e as NativeFrameEvent;
  return { t: 'frame', ts: f.ts, w: f.w, h: f.h, ms: f.ms, b: f.b === -1 ? undefined : f.b, people: peopleFromLm(f.lm) };
}

/** The native view's 1 Hz numbers as the diagnostics chip's shape. */
export function toPoseDiag(d: NativeDiagEvent, leadMs?: number): PoseDiag {
  return {
    fps: d.fps,
    inferMs: d.inferMs,
    ageP50: d.ageP50,
    ageP95: d.ageP95,
    backend: d.backend,
    variant: d.variant,
    rung: d.rung,
    engine: 'native',
    region: d.region,
    view: d.view,
    mirrorX: d.mirrorX,
    leadMs,
  };
}
