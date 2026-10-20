import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useReducedMotion } from '@/lib/a11y';
import { colors, radius, space } from '@/theme/tokens';
import { AppText } from './text';

/** Distance between two ticks (pt) and the height of the ruler strip. */
const TICK_W = 12;
const RULER_H = 44;
/** Ticks drawn either side of what is visible, so a fast flick never shows an empty strip. */
const OVERSCAN = 10;
const EPS = 1e-6;

export interface SwipeRulerProps {
  /** Names the control to screen readers (and is shown above the value unless `hideValue`). */
  label: string;
  value: number;
  onChange: (v: number) => void;
  /** One tick: the size of a swipe step, a button press and a screen-reader increment. */
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  format?: (v: number) => string;
  /** Only the ruler: the owner shows the value (e.g. in a text field). */
  hideValue?: boolean;
  /** No −/+ buttons beside the value. */
  hideButtons?: boolean;
}

const decimalsOf = (step: number) => Math.min(4, String(step).split('.')[1]?.length ?? 0);
const roundTo = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

/** A light tick under the finger; web and devices without a haptic engine simply stay silent. */
function tick() {
  if (Platform.OS === 'web') return;
  try {
    Haptics.selectionAsync().catch(() => {});
  } catch {
    // no haptics available
  }
}

/**
 * A swipe ruler for a number: the value in big type, −/+ buttons, and a strip of ticks that slides under
 * a fixed centre marker. Slow drags move one tick at a time, a flick coasts far and still lands on a tick.
 * Screen readers get a single adjustable control that moves one step per swipe. With reduce-motion on, the
 * ruler jumps instead of animating and a swipe moves at most one tick per touch.
 */
export function SwipeRuler({ label, value, onChange, step = 1, min = 0, max = 200, unit, format = (v) => String(v), hideValue, hideButtons }: SwipeRulerProps) {
  const reduce = useReducedMotion();
  const dp = decimalsOf(step);
  const count = Math.max(1, Math.floor((max - min) / step + EPS) + 1);
  const clampIdx = (i: number) => Math.min(count - 1, Math.max(0, i));
  const idxOf = (v: number) => clampIdx(Math.round((v - min) / step));
  const valueAt = (i: number) => roundTo(min + i * step, dp);
  const clampValue = (v: number) => Math.min(max, Math.max(min, roundTo(v, Math.max(2, dp))));

  const scroller = useRef<ScrollView>(null);
  const [width, setWidth] = useState(0);
  /** The tick under the marker while the user's finger (or a flick) is moving the ruler; null otherwise. */
  const [live, setLive] = useState<number | null>(null);
  const moving = useRef(false);
  const at = useRef(idxOf(value));

  const shownIdx = live ?? idxOf(value);
  const shown = live === null ? value : valueAt(live);

  /** Where the ruler starts: the first value, so a later change from outside scrolls instead of resetting. */
  const [startX] = useState(() => idxOf(value) * TICK_W);
  // The value changed from outside (a button, a screen reader, a new exercise): move the ruler to it.
  const targetIdx = idxOf(value);
  useEffect(() => {
    if (moving.current || at.current === targetIdx) return;
    at.current = targetIdx;
    scroller.current?.scrollTo({ x: targetIdx * TICK_W, animated: !reduce });
  }, [targetIdx, reduce]);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.round(e.nativeEvent.layout.width);
    if (w === width) return;
    setWidth(w);
    // Android ignores a content offset until the padded content exists; place the ruler once it does.
    setTimeout(() => scroller.current?.scrollTo({ x: at.current * TICK_W, animated: false }), 0);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = clampIdx(Math.round(e.nativeEvent.contentOffset.x / TICK_W));
    if (!moving.current || i === at.current) return;
    at.current = i;
    setLive(i);
    tick();
  };
  const settle = (x: number) => {
    moving.current = false;
    const i = clampIdx(Math.round(x / TICK_W));
    at.current = i;
    setLive(null);
    // A touch that ended where it started leaves the value as it was (it may sit between ticks).
    if (i !== targetIdx) onChange(valueAt(i));
  };

  const stepBy = (dir: 1 | -1) => onChange(clampValue(value + dir * step));
  const text = `${format(shown)}${unit ? ` ${unit}` : ''}`;

  const half = Math.ceil(width / 2 / TICK_W) + OVERSCAN;
  const from = Math.max(0, shownIdx - half);
  const to = Math.min(count - 1, shownIdx + half);
  const ticks = [];
  for (let i = from; i <= to; i++) {
    const major = i % 5 === 0;
    ticks.push(<View key={i} style={[styles.tick, major && styles.tickMajor, { left: i * TICK_W + TICK_W / 2 - 1 }]} />);
  }

  const ruler = (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'increment') stepBy(1);
        else if (e.nativeEvent.actionName === 'decrement') stepBy(-1);
      }}
      onLayout={onLayout}
      style={styles.ruler}>
      <ScrollView
        ref={scroller}
        testID="swipe-ruler-scroll"
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={TICK_W}
        decelerationRate={reduce ? 'fast' : 'normal'}
        disableIntervalMomentum={reduce}
        scrollEventThrottle={16}
        contentOffset={{ x: startX, y: 0 }}
        onScrollBeginDrag={() => {
          moving.current = true;
        }}
        onScroll={onScroll}
        onScrollEndDrag={(e) => {
          // A drag released at rest (no coasting follows) settles here; a flick settles when momentum ends.
          const v = e.nativeEvent.velocity?.x ?? 0;
          if (Math.abs(v) < 0.05) settle(e.nativeEvent.contentOffset.x);
        }}
        onMomentumScrollEnd={(e) => settle(e.nativeEvent.contentOffset.x)}
        contentContainerStyle={{ paddingHorizontal: Math.max(0, (width - TICK_W) / 2), height: RULER_H }}>
        <View style={{ width: count * TICK_W, height: RULER_H }}>{ticks}</View>
      </ScrollView>
      <View pointerEvents="none" style={styles.marker} />
    </View>
  );

  if (hideValue && hideButtons) return ruler;
  return (
    <View style={styles.wrap}>
      {hideValue ? null : (
        <AppText variant="overline" color={colors.textMuted}>
          {label}
        </AppText>
      )}
      <View style={styles.row}>
        {hideButtons ? null : (
          <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${label}`} disabled={value <= min} onPress={() => stepBy(-1)} style={[styles.btn, value <= min && styles.disabled]}>
            <Ionicons name="remove" size={28} color={colors.text} />
          </Pressable>
        )}
        {hideValue ? null : (
          <View style={styles.valueBox}>
            <AppText variant="display" style={{ fontSize: 52, lineHeight: 58, fontVariant: ['tabular-nums'] }}>
              {format(shown)}
            </AppText>
            {unit ? (
              <AppText variant="caption" color={colors.textMuted}>
                {unit}
              </AppText>
            ) : null}
          </View>
        )}
        {hideButtons ? null : (
          <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${label}`} disabled={value >= max} onPress={() => stepBy(1)} style={[styles.btn, styles.btnPlus, value >= max && styles.disabled]}>
            <Ionicons name="add" size={28} color={colors.onPrimary} />
          </Pressable>
        )}
      </View>
      {ruler}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: space.sm, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  btn: { width: 58, height: 58, borderRadius: radius.pill, backgroundColor: colors.cardRaised, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  btnPlus: { backgroundColor: colors.primary, borderColor: colors.primary },
  disabled: { opacity: 0.35 },
  valueBox: { minWidth: 76, alignItems: 'center' },
  ruler: { alignSelf: 'stretch', height: RULER_H, borderRadius: radius.sm, backgroundColor: colors.wash, overflow: 'hidden', justifyContent: 'center' },
  tick: { position: 'absolute', bottom: 8, width: 2, height: 12, borderRadius: 1, backgroundColor: colors.borderStrong },
  tickMajor: { height: 22, backgroundColor: colors.textFaint },
  marker: { position: 'absolute', left: '50%', marginLeft: -1.5, top: 4, bottom: 4, width: 3, borderRadius: 2, backgroundColor: colors.primary },
});
