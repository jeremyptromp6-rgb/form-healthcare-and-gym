import { Linking, Pressable, View } from 'react-native';
import { AppText, Card } from '@/components/ui';
import type { PhotoCredit } from '@/lib/foodPhotoCredits';
import { colors, radius, space } from '@/theme/tokens';

function Link({ label, url, food }: { label: string; url: string; food: string }) {
  if (!url) return null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`${label} for ${food}`}
      hitSlop={8}
      onPress={() => Linking.openURL(url)}
      style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', borderRadius: radius.sm, opacity: pressed ? 0.7 : 1 })}>
      <AppText variant="caption" color={colors.primary}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Who took each food photo, under which licence, with links to the licence and the original file. */
export function PhotoCreditsView({ credits }: { credits: readonly PhotoCredit[] }) {
  return (
    <View style={{ gap: space.md }}>
      <AppText variant="body" color={colors.textMuted}>
        Food photos come from Wikimedia Commons and are used under their free licences. Thank you to the photographers.
      </AppText>
      <Card style={{ gap: space.md }}>
        {credits.map((c) => (
          <View key={c.food} style={{ gap: 2 }}>
            <AppText variant="body">{c.food}</AppText>
            <AppText variant="caption" color={colors.textMuted}>
              {c.author} · {c.license}
            </AppText>
            <View style={{ flexDirection: 'row', gap: space.lg }}>
              <Link label="License" url={c.licenseUrl} food={c.food} />
              <Link label="Source" url={c.source} food={c.food} />
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}
