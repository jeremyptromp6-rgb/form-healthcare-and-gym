import { fail, type PoseProvider } from '@form/domain';

/**
 * Native builds have no pose model yet: real on-device tracking on iOS/Android needs a native
 * frame-processor module in a development build. Until then this provider says so honestly —
 * the camera feed can show, but no landmarks are ever produced.
 */
export type WebPoseProvider = PoseProvider<unknown> & Required<Pick<PoseProvider<unknown>, 'load' | 'close'>> & { readonly backend: 'GPU' | 'CPU' | null };

export const NATIVE_POSE_UNAVAILABLE = "Camera coaching isn't available in this version of FORM on phones yet.";

export function createPoseProvider(): WebPoseProvider {
  return {
    kind: 'pose',
    backend: null,
    status: () => ({ state: 'unconfigured', provider: 'Native pose', missing: ['native pose frame processor (development build)'] }),
    load: async () => fail('unconfigured', NATIVE_POSE_UNAVAILABLE),
    estimate: async () => fail('unconfigured', NATIVE_POSE_UNAVAILABLE),
    close() {},
  };
}
