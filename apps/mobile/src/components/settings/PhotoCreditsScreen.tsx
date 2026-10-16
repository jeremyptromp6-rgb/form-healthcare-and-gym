import { Screen } from '@/components/ui';
import { PHOTO_CREDITS } from '@/lib/foodPhotoCredits';
import { PhotoCreditsView } from './PhotoCreditsView';

export function PhotoCreditsScreen() {
  return (
    <Screen title="Photo credits" subtitle="Food photos and their licences">
      <PhotoCreditsView credits={PHOTO_CREDITS} />
    </Screen>
  );
}
