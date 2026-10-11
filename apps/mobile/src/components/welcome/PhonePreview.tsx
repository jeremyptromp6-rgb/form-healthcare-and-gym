import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui';
import { StaticArtContext } from '@/components/ui/staticArt';
import { colors, edgeLight, palettes, radius, shadow, space } from '@/theme/tokens';

/** The size the real screen is laid out at before it's shrunk into the frame. */
const SCREEN_W = 390;
const SCREEN_H = 820;

/** The bezel is a physical object: the same near-black in both moods (the dark mood's deepest surface). */
const BEZEL = palettes.dark.surface;

/**
 * A phone with one of FORM's real screens inside, scaled down — so the welcome page shows the app
 * as it actually is, never a mock-up that drifts out of date. Purely a picture: not interactive,
 * hidden from screen readers (the caption says what it shows). Its art stands still (StaticArtContext),
 * so the page's motion budget is spent on the hero alone.
 */
export function PhonePreview({ width = 220, caption, children }: { width?: number; caption: string; children: ReactNode }) {
  const scale = (width - 16) / SCREEN_W;
  const innerW = SCREEN_W * scale;
  const innerH = SCREEN_H * scale;
  return (
    <View style={{ alignItems: 'center', gap: space.md }}>
      <View style={[styles.frame, { width, height: innerH + 16 }]} pointerEvents="none" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden aria-hidden>
        <View style={[styles.screen, { width: innerW, height: innerH }]}>
          <View
            style={{
              position: 'absolute',
              width: SCREEN_W,
              height: SCREEN_H,
              left: (innerW - SCREEN_W) / 2,
              top: (innerH - SCREEN_H) / 2,
              transform: [{ scale }],
              backgroundColor: colors.bg,
            }}>
            <StaticArtContext.Provider value>{children}</StaticArtContext.Provider>
          </View>
        </View>
        <View style={styles.notch} />
      </View>
      <AppText variant="label" color={colors.textMuted} style={{ textAlign: 'center' }}>
        {caption}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { padding: 8, borderRadius: 36, backgroundColor: BEZEL, borderWidth: 1.5, borderColor: colors.borderStrong, ...shadow.lifted, ...edgeLight },
  screen: { borderRadius: 28, overflow: 'hidden', backgroundColor: colors.bg },
  notch: { position: 'absolute', top: 14, alignSelf: 'center', left: '50%', marginLeft: -34, width: 68, height: 18, borderRadius: radius.pill, backgroundColor: BEZEL },
});
