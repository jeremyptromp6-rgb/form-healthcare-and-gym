import { render, screen } from '@testing-library/react-native';
import { Animated } from 'react-native';
import { AppText } from './text';
import { heroInk, PhotoHero } from './PhotoHero';
import { heroPhoto } from '@/lib/heroPhotos';
import { HERO_PHOTO_CREDITS } from '@/lib/heroPhotoCredits';

// @testing-library/react-native v14: render is async.
describe('PhotoHero', () => {
  it('lays its children over the photo, and hides the photo from screen readers', async () => {
    const { toJSON } = await render(
      <PhotoHero source={heroPhoto('home')}>
        <AppText variant="title" header color={heroInk.text}>
          Good morning
        </AppText>
      </PhotoHero>,
    );
    expect(screen.getByText('Good morning')).toBeTruthy();
    const tree = JSON.stringify(toJSON());
    expect(tree).toContain('assets/hero/home.jpg');
    expect(tree).toContain('"accessibilityElementsHidden":true');
    expect(tree).toContain('"importantForAccessibility":"no-hide-descendants"');
  });

  it('does not drift with reduced motion (the test setup asks for it)', async () => {
    const loop = jest.spyOn(Animated, 'loop');
    await render(<PhotoHero source={heroPhoto('coach')} />);
    expect(loop).not.toHaveBeenCalled();
    loop.mockRestore();
  });
});

describe('hero photos', () => {
  it('has a credit for every slot', () => {
    const slots = ['home', 'workout', 'camera', 'nutrition', 'progress', 'coach', 'onboarding', 'achievements'];
    expect(HERO_PHOTO_CREDITS.map((c) => c.slot).sort()).toEqual([...slots].sort());
    for (const c of HERO_PHOTO_CREDITS) {
      expect(c.author).toBeTruthy();
      expect(c.licenseUrl).toMatch(/^https:\/\/creativecommons\.org\//);
      expect(c.source).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
  });
});
