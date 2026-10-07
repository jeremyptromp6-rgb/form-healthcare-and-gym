/** Web: tracking runs in the browser when it can open a camera and run WebAssembly. */
export function livePoseSupport(): { available: boolean; message: string } {
  const camera = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  const wasm = typeof WebAssembly !== 'undefined';
  if (camera && wasm) return { available: true, message: 'Camera coaching runs on this device.' };
  return { available: false, message: "This browser can't run camera coaching. Try a current Chrome, Edge, Safari or Firefox." };
}
