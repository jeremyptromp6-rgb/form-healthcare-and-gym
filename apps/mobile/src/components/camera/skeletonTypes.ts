/**
 * Shared types for the camera skeleton: the tracker (skeletonCore), the renderer
 * (skeletonRender), the page that composes them (skeletonPage) and the app-side judge
 * (skeletonState). The first three run as source text inside the camera page, so these types
 * are the contract between the text modules and the TypeScript around them.
 */

export type SkeletonTone = 'good' | 'fix' | 'warn' | 'untrackable';

export interface SkeletonPalette {
  good: string;
  fix: string;
  warn: string;
  untrackable: string;
  other: string;
  halo: string;
  highlight: string;
}

export interface SkeletonState {
  v: 1;
  tone: SkeletonTone;
  side: 'left' | 'right' | null;
  chain: number[];
  palette: SkeletonPalette;
  reduceMotion: boolean;
}

/** One tracked person in normalised video coordinates (33 MediaPipe indices). Objects are reused. */
export interface ScenePerson {
  x: Float32Array;
  y: Float32Array;
  a: Float32Array;
  pa: number;
  primary: boolean;
}

export interface Scene {
  n: number;
  people: ScenePerson[];
}

/** One person in SCREEN CSS px; the context is already scaled by dpr. a = 0 means not drawn. */
export interface RenderPerson {
  x: Float32Array;
  y: Float32Array;
  a: Float32Array;
  pa: number;
  primary: boolean;
}

export interface RenderFrame {
  w: number;
  h: number;
  n: number;
  people: RenderPerson[];
}

export interface SkeletonEnv {
  canvas: { width: number; height: number; getContext(t: '2d'): CanvasRenderingContext2D | null };
  size(): { cw: number; ch: number; dpr: number };
  video(): { w: number; h: number };
  raf(cb: () => void): void;
  now(): number;
  createCanvas(w: number, h: number): { width: number; height: number; getContext(t: '2d'): CanvasRenderingContext2D | null };
  mirror: boolean;
}

export interface SkeletonPage {
  push(people: [number, number, number][][], captureMs: number, arriveMs: number, vw: number, vh: number): void;
  /** Ignores malformed input (v !== 1 or no palette) and keeps the previous state. */
  setState(s: SkeletonState): void;
  /** CPU caps quality at 1. */
  setBackend(b: 'GPU' | 'CPU'): void;
  /** Caps quality at 1. */
  setInline(): void;
  start(): void;
  stop(): void;
  frame(): void;
  stats(): { draws: number; quality: 0 | 1 | 2; latencyMs: number };
}
