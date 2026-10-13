import { act, fireEvent, render, screen } from '@testing-library/react-native';
import Eat from '@/app/(tabs)/eat/index';
import MealPlanScreen from '@/app/(tabs)/eat/plan';
import RecipeScreen from '@/app/(tabs)/eat/recipe/[id]';
import { ApiError } from '@/lib/api';
import type { MealPlanView, PlannedMealView } from '@/lib/types';

/** The Eat routes: plan discard and unsafe meals, a recipe that keeps showing through a failed refresh, and the day rolling over. */

const TODAY = '2026-10-12';
const mockDeletePlan = jest.fn();
const mockPlanAction = jest.fn();
const mockNutritionDay = jest.fn();
let mockPlan: MealPlanView | null = null;
let mockRecipeQuery: Record<string, unknown> = {};

function planned(over: Partial<PlannedMealView> = {}): PlannedMealView {
  return {
    id: 'm1',
    date: TODAY,
    slot: 'dinner',
    recipeId: 'r1',
    title: 'Egg fried rice',
    totalMinutes: 20,
    servings: 1,
    nutrients: { kcal: 500, proteinG: 25, carbsG: 60, fatG: 15 },
    status: 'planned',
    foodLogId: null,
    canMarkEaten: true,
    unsafe: false,
    unsafeReason: null,
    ...over,
  };
}
const makePlan = (meals: PlannedMealView[]): MealPlanView => ({
  id: 'p1',
  clientPlanId: 'c1',
  startDate: TODAY,
  days: 1,
  dates: [TODAY],
  status: 'active',
  targets: { kcal: 2400, proteinG: 160, carbsG: 260, fatG: 80, safeFloorKcal: 1700 },
  warnings: [],
  meals,
  totalsByDate: { [TODAY]: { planned: { kcal: 500, proteinG: 25, carbsG: 60, fatG: 15 }, eaten: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }, meals: meals.length } },
  createdAt: '',
  updatedAt: '',
});

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), navigate: jest.fn(), dismissTo: jest.fn() },
  useLocalSearchParams: () => ({ id: 'r1' }),
  Stack: { Screen: () => null },
}));
jest.mock('@/lib/pro', () => ({
  proFeatureOf: () => null,
  useProAccess: () => ({ has: false }),
  useRestOfToday: () => ({ isPending: false, isError: false, data: undefined, error: null, refetch: jest.fn() }),
}));
jest.mock('@/lib/features', () => ({ useFeature: () => ({ available: true, unknown: false, checking: false, loading: false, recheck: jest.fn(() => Promise.resolve(true)) }) }));
jest.mock('@/components/eat/RecipeView', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return { RecipeView: ({ recipe }: { recipe: { title: string } }) => <MockText>{`recipe: ${recipe.title}`}</MockText> };
});
jest.mock('@/components/eat/EatDayView', () => {
  const { Text: MockText, Pressable } = jest.requireActual('react-native');
  return {
    EatDayView: ({ title, onPrev }: { title: string; onPrev: (() => void) | null }) => (
      <>
        <MockText>{`day: ${title}`}</MockText>
        {onPrev ? <Pressable accessibilityRole="button" accessibilityLabel="Previous day" onPress={onPrev} style={{ minWidth: 44, minHeight: 44 }}><MockText>Prev</MockText></Pressable> : null}
      </>
    ),
  };
});
jest.mock('@/lib/queries', () => ({
  useCurrentPlan: () => ({ isPending: false, isError: false, data: { plan: mockPlan }, error: null, refetch: jest.fn() }),
  useCreatePlan: () => ({ mutate: jest.fn(), isPending: false }),
  useDeletePlan: () => ({ mutate: (...a: unknown[]) => mockDeletePlan(...a), isPending: false }),
  usePlanAction: () => ({ mutate: (...a: unknown[]) => mockPlanAction(...a), isPending: false }),
  useAlternatives: () => ({ isPending: false, isError: false, data: { alternatives: [] }, refetch: jest.fn() }),
  useRefetchOnFocus: () => undefined,
  useRecipe: () => mockRecipeQuery,
  useSaveRecipe: () => ({ mutate: jest.fn(), isPending: false }),
  useGroceryAction: () => ({ mutate: jest.fn(), isPending: false }),
  useNutritionDay: (...a: unknown[]) => {
    mockNutritionDay(...a);
    return { isPending: false, isError: false, isRefetching: false, data: { any: true }, error: null, refetch: jest.fn() };
  },
  useAddWater: () => ({ mutate: jest.fn(), isPending: false }),
}));

const apiError = (code: string, message: string, details?: unknown) => new ApiError('validation', code, message, 422, false, details);

beforeEach(() => {
  jest.clearAllMocks();
  mockPlan = makePlan([planned()]);
});

describe('Meal plan screen', () => {
  it('asks before discarding the plan, and only discards on the second tap', async () => {
    await render(<MealPlanScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Discard plan' }));
    expect(mockDeletePlan).not.toHaveBeenCalled();
    expect(screen.getByText('Discard this plan?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, discard plan' }));
    expect(mockDeletePlan).toHaveBeenCalledWith('p1', expect.objectContaining({ onError: expect.any(Function) }));
  });

  it('can keep the plan instead', async () => {
    await render(<MealPlanScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Discard plan' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Keep this plan' }));
    expect(screen.queryByText('Discard this plan?')).toBeNull();
    expect(mockDeletePlan).not.toHaveBeenCalled();
  });

  it('shows a discard failure next to the question', async () => {
    mockDeletePlan.mockImplementation((_id: string, opts: { onError: (e: ApiError) => void }) => opts.onError(new ApiError('network', 'network', 'x', null, true)));
    await render(<MealPlanScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Discard plan' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, discard plan' }));
    expect(await screen.findByText(/Not saved — check your connection/)).toBeTruthy();
    expect(screen.getByText('Discard this plan?')).toBeTruthy();
  });

  it('shows the real reason when the server refuses to mark an unsafe meal eaten', async () => {
    // The plan on screen is stale: it still offers Mark eaten.
    mockPlanAction.mockImplementation((_a: unknown, opts: { onError: (e: ApiError) => void; onSettled?: () => void }) => {
      opts.onError(apiError('meal_unsuitable', 'This meal cannot be logged.', { mealId: 'm1', reason: 'Contains eggs — on your allergy list' }));
      opts.onSettled?.();
    });
    await render(<MealPlanScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Mark eaten' }));
    expect(await screen.findByText('Contains eggs — on your allergy list')).toBeTruthy();
    expect(screen.queryByText('This meal cannot be logged.')).toBeNull();
  });

  it('falls back to a plain sentence when meal_unsuitable carries no reason', async () => {
    mockPlanAction.mockImplementation((_a: unknown, opts: { onError: (e: ApiError) => void }) => opts.onError(apiError('meal_unsuitable', 'raw server text')));
    await render(<MealPlanScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Mark eaten' }));
    expect(await screen.findByText(/no longer fits your allergies or diet/)).toBeTruthy();
  });

  it('shows an unsafe meal with its warning and a way to swap it', async () => {
    mockPlan = makePlan([planned({ unsafe: true, unsafeReason: 'Contains eggs — on your allergy list', canMarkEaten: false })]);
    await render(<MealPlanScreen />);
    expect(screen.getByText('Contains eggs — on your allergy list')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Swap this meal' })).toBeTruthy();
  });
});

describe('Recipe screen', () => {
  it('keeps showing the recipe when a background refresh fails', async () => {
    mockRecipeQuery = {
      isPending: false,
      isError: true,
      data: { recipe: { id: 'r1', title: 'Lentil soup', slots: ['dinner'], servings: 2, saved: false } },
      error: new ApiError('network', 'network', 'x', null, true),
      refetch: jest.fn(),
    };
    await render(<RecipeScreen />);
    expect(screen.getByText('recipe: Lentil soup')).toBeTruthy();
  });

  it('shows the error only when there is nothing to show', async () => {
    mockRecipeQuery = { isPending: false, isError: true, data: undefined, error: new ApiError('network', 'network', "Can't reach FORM.", null, true), refetch: jest.fn() };
    await render(<RecipeScreen />);
    expect(screen.queryByText(/recipe:/)).toBeNull();
    expect(screen.getByRole('button', { name: /try again|retry/i })).toBeTruthy();
  });
});

describe('Eat screen across midnight', () => {
  afterEach(() => jest.useRealTimers());
  const lastDate = () => mockNutritionDay.mock.calls.at(-1)![0] as string;

  it('moves to the new today when it was showing today', async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 12, 23, 59, 40) });
    await render(<Eat />);
    expect(lastDate()).toBe('2026-10-12');
    expect(screen.getByText('day: Today')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(31_000); // past midnight, and past one 30 s check
    });
    expect(lastDate()).toBe('2026-10-13');
    expect(screen.getByText('day: Today')).toBeTruthy();
  });

  it('leaves a day the user paged back to alone', async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 12, 23, 59, 40) });
    await render(<Eat />);
    await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
    expect(lastDate()).toBe('2026-10-11');
    await act(async () => {
      jest.advanceTimersByTime(31_000);
    });
    expect(lastDate()).toBe('2026-10-11');
    expect(screen.queryByText('day: Today')).toBeNull(); // still the day they chose (now two days back)
  });
});
