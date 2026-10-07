import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { NATIVE_POSE_UNAVAILABLE } from '@/lib/pose/mediapipe';
import type { PoseCameraFeedProps } from './feedTypes';

/**
 * Native camera feed (expo-camera). This build has no native pose model, so it reports pose as
 * unsupported and never produces landmarks or a skeleton — the preview and permission flow are
 * real; tracking needs the development build's frame processor.
 */
export function PoseCameraFeed({ active, retryToken, onCamera, onPose }: PoseCameraFeedProps) {
  const [permission, requestPermission] = useCameraPermissions();
  const callbacks = useRef({ onCamera, onPose });
  useEffect(() => {
    callbacks.current = { onCamera, onPose };
  });

  useEffect(() => {
    callbacks.current.onPose({ kind: 'unsupported', message: NATIVE_POSE_UNAVAILABLE });
  }, []);

  const known = permission !== null;
  const granted = permission?.granted ?? false;
  const canAskAgain = permission?.canAskAgain ?? true;
  useEffect(() => {
    if (!active || !known || granted) return;
    if (!canAskAgain) {
      callbacks.current.onCamera({ kind: 'denied', canAskAgain: false });
      return;
    }
    callbacks.current.onCamera({ kind: 'requesting' });
    requestPermission().then((r) => {
      if (!r.granted) callbacks.current.onCamera({ kind: 'denied', canAskAgain: r.canAskAgain });
    });
  }, [active, known, granted, canAskAgain, retryToken, requestPermission]);

  if (!active || !granted) return null;
  return (
    <CameraView
      style={StyleSheet.absoluteFill}
      facing="front"
      active={active}
      onCameraReady={() => callbacks.current.onCamera({ kind: 'live' })}
      onMountError={() => callbacks.current.onCamera({ kind: 'unavailable', reason: 'unsupported' })}
    />
  );
}
