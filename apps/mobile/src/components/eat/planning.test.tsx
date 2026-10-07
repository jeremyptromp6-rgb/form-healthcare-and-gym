import { libraryRecipe } from '@form/domain';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { GroceryListView as List, MealPlanView as Plan, PlannedMealView, Recipe } from '@/lib/types';
import { GroceryListView } from './GroceryListView';
import { MealPlanView } from './MealPlanView';
import { RecipeView } from './RecipeView';

const TODAY = '2026-10-01';

function meal(over: Partial<PlannedMealView>): PlannedMealView {
  return {
    id: 'm1',
    date: TODAY,
    slot: 'breakfast',
    recipeId: 'overnight_oats_berries',
    title: 'Overnight oats with blueberries',
    totalMinutes: 5,
    servings: 1,
    nutrients: { kcal: 420, proteinG: 26, carbsG: 60, fatG: 8 },
    status: 'planned',
    foodLogId: null,
    canMarkEaten: true,
    ...over,
  };
}

function plan(meals: PlannedMealView[], over: Partial<Plan> = {}): Plan {
  return {
    id: 'p1',
    clientPlanId: 'c1',
    startDate: TODAY,
    days: 7,
    dates: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'],
    status: 'active',
    targets: { kcal: 2400, proteinG: 160, carbsG: 260, fatG: 80, safeFloorKcal: 1700 },
    warnings: [],
    meals,
    totalsByDate: { [TODAY]: { planned: { kcal: 2310, proteinG: 150, carbsG: 250, fatG: 70 }, eaten: { kcal: 420, proteinG: 26, carbsG: 60, fatG: 8 }, meals: meals.length } },
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function handlers() {
  return {
    onSelectDate: jest.fn(),
    onOpenRecipe: jest.fn(),
    onMarkEaten: jest.fn(),
    onUnmark: jest.fn(),
    onSwap: jest.fn(),
    onServings: jest.fn(),
    onRemove: jest.fn(),
    onAddMeal: jest.fn(),
    onRepeatDay: jest.fn(),
  };
}

describe('MealPlanView', () => {
  const meals = [
    meal({}),
    meal({ id: 'm2', slot: 'lunch', recipeId: 'red_lentil_soup', title: 'Red lentil and tomato soup', status: 'eaten', foodLogId: 'l1', canMarkEaten: false }),
    meal({ id: 'm3', date: '2026-10-02', slot: 'dinner', title: 'Tomorrow dinner', canMarkEaten: false }),
  ];

  it('shows the day against targets, planned vs eaten, and only today’s meals', async () => {
    await render(<MealPlanView plan={plan(meals)} today={TODAY} date={TODAY} {...handlers()} />);
    expect(screen.getByText("Today's plan")).toBeTruthy();
    expect(screen.getByText('2,310 / 2,400 kcal')).toBeTruthy();
    expect(screen.getByText(/420 kcal eaten so far/)).toBeTruthy();
    expect(screen.getByText('Planned')).toBeTruthy();
    expect(screen.getByText('Eaten')).toBeTruthy();
    expect(screen.queryByText('Tomorrow dinner')).toBeNull();
    expect(screen.getByText(/aren’t counted as food until you mark them eaten/)).toBeTruthy();
  });

  it('eat, undo, swap, resize, remove, open, add and repeat', async () => {
    const h = handlers();
    await render(<MealPlanView plan={plan(meals)} today={TODAY} date={TODAY} {...h} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Mark eaten' }));
    expect(h.onMarkEaten).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Undo' }));
    expect(h.onUnmark).toHaveBeenCalledWith(expect.objectContaining({ id: 'm2' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Swap Overnight oats with blueberries' }));
    expect(h.onSwap).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }));
    await fireEvent.press(screen.getByRole('button', { name: 'More servings of Overnight oats with blueberries' }));
    expect(h.onServings).toHaveBeenCalledWith(expect.objectContaining({ id: 'm1' }), 1.25);
    await fireEvent.press(screen.getByRole('button', { name: 'Fewer servings of Overnight oats with blueberries' }));
    expect(h.onServings).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'm1' }), 0.75);
    await fireEvent.press(screen.getByRole('button', { name: 'Remove Overnight oats with blueberries' }));
    expect(h.onRemove).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Overnight oats with blueberries. Open recipe' }));
    expect(h.onOpenRecipe).toHaveBeenCalledWith('overnight_oats_berries');
    await fireEvent.press(screen.getByRole('button', { name: 'Add a meal' }));
    expect(h.onAddMeal).toHaveBeenCalledWith(TODAY);
    await fireEvent.press(screen.getByRole('button', { name: 'Repeat this day' }));
    expect(h.onRepeatDay).toHaveBeenCalledWith(TODAY);
    await fireEvent.press(screen.getByRole('tab', { name: 'Today' }));
    expect(h.onSelectDate).toHaveBeenCalledWith(TODAY);
  });

  it('a future meal can’t be marked eaten yet; warnings are shown', async () => {
    await render(<MealPlanView plan={plan(meals, { warnings: ['Only 8 recipes fit your needs, so some meals repeat.'] })} today={TODAY} date="2026-10-02" {...handlers()} />);
    expect(screen.getByText('Tomorrow dinner')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark eaten' })).toBeNull();
    expect(screen.getByText(/some meals repeat/)).toBeTruthy();
  });
});

function recipe(id: string, over: Partial<Recipe> = {}): Recipe {
  const r = libraryRecipe(id)!;
  return {
    id: r.id,
    title: r.title,
    slots: r.slots,
    servings: r.servings,
    prepMinutes: r.prepMinutes,
    cookMinutes: r.cookMinutes,
    totalMinutes: r.totalMinutes,
    perServing: r.perServingDisplay,
    servingGrams: Math.round(r.servingGrams),
    ingredients: r.ingredients.map((i) => ({ foodId: i.foodId, name: i.name, amount: i.amount, unit: i.unit, note: i.note, aisle: i.aisle })),
    pantry: r.pantry,
    steps: r.steps,
    allergens: r.allergens,
    suitableFor: r.suitableFor,
    styles: r.styles,
    costTier: r.costTier,
    source: 'form_library',
    saved: false,
    fit: { verdict: 'ok', matchedAllergens: [], disliked: false, overTime: false, overBudget: false },
    ...over,
  };
}

describe('RecipeView', () => {
  const base = { onServings: jest.fn(), onToggleSave: jest.fn(), onAddToGrocery: jest.fn() };

  it('shows per-serving nutrition, scales ingredients to the servings chosen, and lists steps', async () => {
    const r = recipe('beef_bolognese'); // 4 servings, 400 g beef
    const { rerender } = await render(<RecipeView recipe={r} servings={4} {...base} />);
    expect(screen.getByText('Lean beef bolognese')).toBeTruthy();
    expect(screen.getAllByText('400 g')).toHaveLength(2); // beef and tomatoes
    expect(screen.getByText(/Soften the onion/)).toBeTruthy();
    expect(screen.getByText(/Contains gluten\. Always check labels/)).toBeTruthy();
    await rerender(<RecipeView recipe={r} servings={2} {...base} />);
    expect(screen.getAllByText('200 g')).toHaveLength(2); // both halved for 2 servings
    await fireEvent.press(screen.getByRole('button', { name: 'Add to grocery list (2 servings)' }));
    expect(base.onAddToGrocery).toHaveBeenCalled();
  });

  it('warns clearly when a recipe doesn’t suit the user, and won’t add it to a plan', async () => {
    const onPress = jest.fn();
    await render(
      <RecipeView recipe={recipe('egg_fried_rice', { fit: { verdict: 'excluded', matchedAllergens: ['eggs'], disliked: false, overTime: false, overBudget: false } })} servings={2} {...base} planAction={{ label: 'Add to Today · Lunch', onPress }} />,
    );
    expect(screen.getByText(/Not suitable for you — contains eggs/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Add to Today · Lunch' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('save toggles', async () => {
    const onToggleSave = jest.fn();
    await render(<RecipeView recipe={recipe('red_lentil_soup', { saved: true })} servings={4} {...base} onToggleSave={onToggleSave} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Saved' }));
    expect(onToggleSave).toHaveBeenCalled();
  });
});

describe('GroceryListView', () => {
  const list: List = {
    sections: [
      { aisle: 'protein', label: 'Protein', items: [{ id: 'g1', name: 'Lentils, cooked', source: 'plan', foodId: 'fdb:lentils_cooked', amount: 600, unit: 'g', amountText: '600 g', aisle: 'protein', checked: false }] },
      { aisle: 'other', label: 'Other', items: [{ id: 'g2', name: 'Coffee filters', source: 'custom', foodId: null, amount: null, unit: null, amountText: '1 pack', aisle: 'other', checked: true }] },
    ],
    total: 2,
    remaining: 1,
    note: 'Amounts are the weights the recipes use — cooked weights for rice, pasta and meat.',
  };
  const h = () => ({ onToggle: jest.fn(), onDelete: jest.fn(), onAddCustom: jest.fn(), onClearChecked: jest.fn(), onOpenPlan: jest.fn() });

  it('groups by aisle, ticks items, and only lets you remove your own items', async () => {
    const x = h();
    await render(<GroceryListView list={list} {...x} />);
    expect(screen.getByText('1 of 2 to buy')).toBeTruthy();
    expect(screen.getByText('Protein')).toBeTruthy();
    expect(screen.getByText('600 g')).toBeTruthy();
    expect(screen.getByText('For your plan')).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Lentils, cooked, 600 g' }));
    expect(x.onToggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'g1' }));
    expect(screen.queryByRole('button', { name: 'Remove Lentils, cooked' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove Coffee filters' }));
    expect(x.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: 'g2' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Clear ticked items' }));
    expect(x.onClearChecked).toHaveBeenCalled();
    expect(screen.getByText(/cooked weights/)).toBeTruthy();
  });

  it('adds custom items and shows an empty state that leads to planning', async () => {
    const x = h();
    await render(<GroceryListView list={{ sections: [], total: 0, remaining: 0, note: '' }} {...x} />);
    expect(screen.getByText('Nothing to buy yet')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Add an item'), 'Dish soap');
    await fireEvent.changeText(screen.getByLabelText('Amount (optional)'), '1 bottle');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to list' }));
    expect(x.onAddCustom).toHaveBeenCalledWith('Dish soap', '1 bottle');
    await fireEvent.press(screen.getByRole('button', { name: 'Plan meals' }));
    expect(x.onOpenPlan).toHaveBeenCalled();
  });
});
