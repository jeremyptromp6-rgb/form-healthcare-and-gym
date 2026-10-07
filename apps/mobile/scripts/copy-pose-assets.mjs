// Copies MediaPipe's browser runtime (ES module + WebAssembly) from node_modules into public/ so the
// web build serves it from FORM's own origin — no third-party CDN at runtime. MediaPipe is loaded
// as a native ES module only when the camera starts; Metro can't bundle it (its worker fallback
// uses a computed import()), and keeping it out of the app bundle saves ~1 MB on every page load.
// Runs on install and before web dev/builds.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(root, 'node_modules', '@mediapipe', 'tasks-vision');
const dest = join(root, 'public', 'mediapipe');

if (!existsSync(pkg)) {
  console.warn('[pose] @mediapipe/tasks-vision not installed; web pose detection will report unavailable.');
  process.exit(0);
}
mkdirSync(join(dest, 'wasm'), { recursive: true });
for (const f of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']) {
  cpSync(join(pkg, 'wasm', f), join(dest, 'wasm', f));
}
cpSync(join(pkg, 'vision_bundle.mjs'), join(dest, 'vision_bundle.mjs'));
// Tiny loader: exposes the module to the app and signals readiness (no inline script needed).
writeFileSync(
  join(dest, 'loader.mjs'),
  "import * as vision from './vision_bundle.mjs';\nwindow.__formVision = vision;\nwindow.dispatchEvent(new Event('form-vision-ready'));\n",
);
console.log('[pose] MediaPipe runtime copied to public/mediapipe');
