import { fail, type PoseProvider } from '@form/domain';

/**
 * Phones don't use a provider object: the camera feed hosts MediaPipe in a WebView engine and
 * pushes its landmarks straight into the pose session (components/camera/PoseCameraFeed.tsx).
 * This stub keeps the shared provider interface honest if anything ever asks for one on native.
 */
export type WebPoseProvider = PoseProvider<unknown> & Required<Pick<PoseProvider<unknown>, 'load' | 'close'>> & { readonly backend: 'GPU' | 'CPU' | null };

export const NATIVE_POSE_UNAVAILABLE = 'On phones, pose tracking runs inside the camera view rather than through a provider.';

export function createPoseProvider(): WebPoseProvider {
  return {
    kind: 'pose',
    backend: null,
    status: () => ({ state: 'unconfigured', provider: 'Native pose (runs in the camera view)', missing: [] }),
    load: async () => fail('unconfigured', NATIVE_POSE_UNAVAILABLE),
    estimate: async () => fail('unconfigured', NATIVE_POSE_UNAVAILABLE),
    close() {},
  };
}
