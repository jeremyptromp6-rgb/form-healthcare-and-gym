import { Screen } from '@/components/ui';
import { PHOTO_CREDITS } from '@/lib/foodPhotoCredits';
import { HERO_PHOTO_CREDITS } from '@/lib/heroPhotoCredits';
import { PhotoCreditsView } from './PhotoCreditsView';

export function PhotoCreditsScreen() {
  return (
    <Screen title="Photo credits" subtitle="App and food photos, and their licences">
      <PhotoCreditsView credits={PHOTO_CREDITS} appCredits={HERO_PHOTO_CREDITS} />
    </Screen>
  );
}
