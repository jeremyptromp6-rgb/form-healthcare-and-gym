import type { LivePoseSession } from '@form/domain';
import type { CameraStatus, LiveReadout, PoseDiag, PoseStatus } from '@/lib/pose/status';

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
  /** Preview builds only (~1 Hz): feed performance for the diagnostics chip. Absent in main builds. */
  onDiag?: (diag: PoseDiag) => void;
  /** Preview builds only: overlay lead in ms for the preview pipeline latency (native engine). */
  leadMs?: number;
  /** Which engine is running: reported on mount and again if the native camera falls back to the WebView. */
  onEngine?: (engine: 'native' | 'webview') => void;
}
