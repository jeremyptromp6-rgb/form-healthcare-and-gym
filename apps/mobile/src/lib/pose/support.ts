import { NATIVE_POSE_UNAVAILABLE } from './mediapipe';

/** Whether this build can run live pose tracking. Native builds need the development build's pose module. */
export function livePoseSupport(): { available: boolean; message: string } {
  return { available: false, message: NATIVE_POSE_UNAVAILABLE };
}
