import { PHOTO_CREDITS } from './foodPhotoCredits';
import { foodPhoto } from './foodPhotos';

describe('foodPhoto', () => {
  it('returns a photo for a verified food', () => {
    expect(foodPhoto('fdb:banana')).toBeDefined();
  });

  it('returns nothing for unknown ids, user foods and object-prototype names', () => {
    expect(foodPhoto('fdb:no-such-food')).toBeUndefined();
    expect(foodPhoto('user:123')).toBeUndefined();
    expect(foodPhoto('constructor')).toBeUndefined();
    expect(foodPhoto('')).toBeUndefined();
  });

  it('credits every photo with a free licence and a source', () => {
    expect(PHOTO_CREDITS.length).toBeGreaterThan(0);
    for (const c of PHOTO_CREDITS) {
      expect(c.author).not.toBe('');
      expect(c.license).toMatch(/^(CC0|Public domain|CC BY)/i);
      expect(c.source).toMatch(/^https:\/\/commons\.wikimedia\.org\//);
    }
  });
});
