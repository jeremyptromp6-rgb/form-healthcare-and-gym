import type { HeroSlot } from './heroPhotos';

/** Who took each screen photo, and under which licence. */
export interface HeroPhotoCredit {
  slot: HeroSlot;
  /** The photo's name on Wikimedia Commons. */
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  /** The photo's page on Wikimedia Commons. */
  source: string;
}

const CC0 = 'https://creativecommons.org/publicdomain/zero/1.0/';
const PUBLIC_DOMAIN = 'https://creativecommons.org/publicdomain/mark/1.0/';

export const HERO_PHOTO_CREDITS: readonly HeroPhotoCredit[] = [
  { slot: 'home', title: 'Yoga sunrise', author: 'Dave Contreras (basixfilms)', license: 'CC0', licenseUrl: CC0, source: 'https://commons.wikimedia.org/wiki/File:Yoga_sunrise._(Unsplash).jpg' },
  { slot: 'workout', title: 'A close-up view of a set of heavy dumbbells', author: 'Shixart1985', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0', source: 'https://commons.wikimedia.org/wiki/File:A_close-up_view_of_a_set_of_heavy_dumbbells.jpg' },
  { slot: 'camera', title: 'Yoga wellness practice at sunset', author: 'Dominic Deusdedith', license: 'CC BY-SA 4.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0', source: 'https://commons.wikimedia.org/wiki/File:Yoga_wellness_practice_at_sunset.jpg' },
  { slot: 'nutrition', title: 'Healthy Trendy Brunch', author: 'Jannis Brandt (_jannis)', license: 'CC0', licenseUrl: CC0, source: 'https://commons.wikimedia.org/wiki/File:Healthy_Trendy_Brunch_(Unsplash).jpg' },
  { slot: 'progress', title: 'Chalked Hands', author: 'Abbottportraits', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0', source: 'https://commons.wikimedia.org/wiki/File:Chalked_Hands.jpg' },
  { slot: 'coach', title: 'Yoga Fog', author: 'Patrick Hendry (worldsbetweenlines)', license: 'CC0', licenseUrl: CC0, source: 'https://commons.wikimedia.org/wiki/File:Patrick_Hendry_-_Yoga_Fog_(Unsplash).jpg' },
  { slot: 'onboarding', title: 'Tongass silhouette', author: 'Forest Service Alaska Region, USDA', license: 'Public domain', licenseUrl: PUBLIC_DOMAIN, source: 'https://commons.wikimedia.org/wiki/File:20230803-FS-BA-Tongass-silhouette-0012_(53323485799).jpg' },
  { slot: 'achievements', title: 'Misty morning sunlight in the forest near Viana do Castelo', author: 'Sergei Gussev', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0', source: 'https://commons.wikimedia.org/wiki/File:Misty_morning_sunlight_shining_through_the_trees_in_the_forest_near_Viana_do_Castelo,_Portugal,_January_2024_(53524128465).jpg' },
];
