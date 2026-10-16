import type { FoodItem } from '@form/domain';
import { render, screen } from '@testing-library/react-native';
import { countSvg } from '@/test-utils/svgNodes';
import { FoodRow } from './FoodPicker';

type Json = { type: string; children?: (Json | string)[] | null };
const countImages = (node: Json | Json[] | null): number => {
  if (!node) return 0;
  if (Array.isArray(node)) return node.reduce((n, c) => n + countImages(c), 0);
  return (node.type === 'Image' ? 1 : 0) + (node.children ?? []).reduce<number>((n, c) => n + (typeof c === 'string' ? 0 : countImages(c)), 0);
};

const food = (id: string, name: string): FoodItem => ({
  id,
  name,
  brand: null,
  basis: 'g',
  per100: { kcal: 89, proteinG: 1.1, carbsG: 22.8, fatG: 0.3 },
  servings: [],
  origin: id.startsWith('fdb:') ? 'verified_database' : 'user_food',
});

describe('FoodRow picture', () => {
  it('shows the real photo for a food that has one', async () => {
    await render(<FoodRow food={food('fdb:banana', 'Banana, raw')} onPress={jest.fn()} />);
    expect(countImages(screen.toJSON() as Json | Json[] | null)).toBe(1);
    expect(countSvg().total).toBe(0);
  });

  it('falls back to the sketch when there is no photo', async () => {
    await render(<FoodRow food={food('user:1', 'Grandma soup')} onPress={jest.fn()} />);
    expect(countImages(screen.toJSON() as Json | Json[] | null)).toBe(0);
    expect(countSvg().total).toBeGreaterThan(0);
  });
});
