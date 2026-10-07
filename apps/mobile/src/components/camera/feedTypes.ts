import type { LivePoseSession } from '@form/domain';
import type { CameraStatus, LiveReadout, PoseStatus } from '@/lib/pose/status';

export interface PoseCameraFeedProps {
  /** Camera should run: the user turned it on and tracking isn't paused. Off = stream stopped. */
  active: boolean;
  session: LivePoseSession;
  /** Bump to retry after a failure (re-requests the camera, reloads the model). */
  retryToken: number;
  onCamera: (status: CameraStatus) => void;
  onPose: (status: PoseStatus) => void;
  /** Throttled (~5 Hz) — the overlay itself is drawn outside React at camera frame rate. */
  onReadout: (readout: LiveReadout | null) => void;
}
