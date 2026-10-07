import type { ReactNode } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { a11y, colors, type } from '@/theme/tokens';

export type TextVariant = keyof typeof type;

const NUMERIC: TextVariant[] = ['display', 'number'];

export function AppText({
  variant = 'body',
  color = colors.text,
  style,
  children,
  numberOfLines,
  header,
  accessibilityLabel,
}: {
  variant?: TextVariant;
  color?: string;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  numberOfLines?: number;
  /** Marks the text as a heading for screen readers. */
  header?: boolean;
  /** Spoken instead of the visible text (e.g. "90 seconds of rest left" for "1:30"). */
  accessibilityLabel?: string;
}) {
  return (
    <Text
      accessibilityRole={header ? 'header' : undefined}
      accessibilityLabel={accessibilityLabel}
      numberOfLines={numberOfLines}
      maxFontSizeMultiplier={NUMERIC.includes(variant) ? a11y.maxNumberScale : undefined}
      style={[type[variant] as TextStyle, { color }, style]}>
      {children}
    </Text>
  );
}
