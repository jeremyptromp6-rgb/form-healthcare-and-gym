import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { ComponentType } from 'react';
import { Platform } from 'react-native';

import type { FormPoseCameraNativeModule, FormPoseCameraViewProps } from './types';

export type {
  FormPoseCameraNativeModule,
  FormPoseCameraViewProps,
  NativeCameraErrorName,
  NativeCameraEvent,
  NativeDiagEvent,
  NativeFrameEvent,
  NativePalette,
  NativePoseEvent,
} from './types';

const MODULE_NAME = 'FormPoseCamera';

// The module only exists in an Android dev or release build that includes it. Everywhere else
// (iOS, web, Jest, Expo Go, an Android build without it) both exports are null and nothing throws:
// requireOptionalNativeModule returns null, and requireNativeViewManager (which throws on web and
// would only warn on a missing view) is never reached.
function loadModule(): FormPoseCameraNativeModule | null {
  if (Platform.OS !== 'android') return null;
  try {
    return requireOptionalNativeModule<FormPoseCameraNativeModule>(MODULE_NAME);
  } catch {
    return null;
  }
}

function loadView(module: FormPoseCameraNativeModule | null): ComponentType<FormPoseCameraViewProps> | null {
  if (!module) return null;
  try {
    return requireNativeViewManager<FormPoseCameraViewProps>(MODULE_NAME);
  } catch {
    return null;
  }
}

/** The native module, or null when this runtime has none. */
export const FormPoseCameraModule: FormPoseCameraNativeModule | null = loadModule();

/** The native camera + pose view, or null when this runtime has none. */
export const FormPoseCameraView: ComponentType<FormPoseCameraViewProps> | null = loadView(FormPoseCameraModule);

/** True when the native view can be rendered. */
export function isFormPoseCameraAvailable(): boolean {
  return FormPoseCameraView !== null;
}
