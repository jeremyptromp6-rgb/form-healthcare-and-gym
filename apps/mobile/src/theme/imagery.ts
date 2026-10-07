import type { ImageSourcePropType } from 'react-native';

/**
 * Editorial imagery slots. FORM is designed around real fitness, food and lifestyle photography,
 * but ships none yet: every slot is null and `HeroMedia` shows a calm gradient instead.
 *
 * To add a photo: put a licensed image in `assets/images/imagery/` and point its slot at it, e.g.
 *   train: require('../../assets/images/imagery/train.jpg'),
 * Use photography you have rights to. Never generated images presented as real people or as the
 * user's own data (their meals, their body, their progress).
 */
export type ImagerySlot = 'home' | 'train' | 'nutrition' | 'progress' | 'onboarding' | 'record';

export const imagery: Record<ImagerySlot, ImageSourcePropType | null> = {
  home: null,
  train: null,
  nutrition: null,
  progress: null,
  onboarding: null,
  record: null,
};
