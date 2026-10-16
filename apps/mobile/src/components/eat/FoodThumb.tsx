import { foodCategory } from '@form/domain';
import { Image, View } from 'react-native';
import { FoodArt } from '@/components/art/FoodArt';
import { foodPhoto } from '@/lib/foodPhotos';
import type { FoodItem } from '@/lib/types';

/**
 * A food's picture: its real photo when we have one, otherwise the category sketch. Same rounded square at
 * the same size either way. Decorative: hidden from screen readers, the food's name carries the meaning.
 */
export function FoodThumb({ food, size }: { food: Pick<FoodItem, 'id' | 'name'>; size: number }) {
  const photo = foodPhoto(food.id);
  if (!photo) return <FoodArt category={foodCategory(food)} size={size} />;
  return (
    <View style={{ width: size, height: size, borderRadius: Math.round(size * 0.25), overflow: 'hidden' }} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
      <Image source={photo} style={{ width: size, height: size }} resizeMode="cover" accessibilityIgnoresInvertColors />
    </View>
  );
}
