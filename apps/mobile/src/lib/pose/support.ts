/**
 * Whether this build can run live pose tracking. Phones run MediaPipe inside the camera feed's
 * WebView engine (see components/camera/poseEngineHtml.ts), so it's available on every build.
 */
export function livePoseSupport(): { available: boolean; message: string } {
  return { available: true, message: '' };
}
