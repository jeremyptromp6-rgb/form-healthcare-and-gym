import type { ImageSourcePropType } from 'react-native';

/**
 * The full-bleed photos behind each screen's header (Wikimedia Commons, free licences; credits in
 * heroPhotoCredits.ts and the Photo credits screen). 1080 x 1350 JPEGs. Metro needs every require to be static.
 */
export type HeroSlot = 'home' | 'workout' | 'camera' | 'nutrition' | 'progress' | 'coach' | 'onboarding' | 'achievements';

const HERO: Record<HeroSlot, ImageSourcePropType> = {
  home: require('../../assets/hero/home.jpg'),
  workout: require('../../assets/hero/workout.jpg'),
  camera: require('../../assets/hero/camera.jpg'),
  nutrition: require('../../assets/hero/nutrition.jpg'),
  progress: require('../../assets/hero/progress.jpg'),
  coach: require('../../assets/hero/coach.jpg'),
  onboarding: require('../../assets/hero/onboarding.jpg'),
  achievements: require('../../assets/hero/achievements.jpg'),
};

export const heroPhoto = (slot: HeroSlot): ImageSourcePropType => HERO[slot];
