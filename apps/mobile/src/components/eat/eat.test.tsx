import { NO_SCALE_PROVIDER, SCALE_IDLE, summarizeNutritionDay, verifiedFood, type DayEntry, type ScaleEvent, type ScaleProvider } from '@form/domain';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { allowedMethods, dayHeadline, dayNavigation, defaultMethod, entryBadge, formatLiters, mealTotals, parseAmount, portionLabel, previewPortion, proteinNudge, readAmount, unitOptions } from '@/lib/eat';
import type { FoodLog, NutritionDay } from '@/lib/types';
import { EatDayView, type EatDayViewProps } from './EatDayView';
import { ManualFoodForm } from './ManualFoodForm';
import { PortionEditor } from './PortionEditor';
import { Provenance } from './Provenance';
import { ScaleBody } from './ScalePanel';
import { accuracyLine } from '@/lib/homeFormat';

const chicken = verifiedFood('fdb:chicken_breast_cooked')!;
const milk = verifiedFood('fdb:milk_whole')!;

describe('eat helpers', () => {
  it('unit options fit the food: weights for solids, volumes for drinks, densities unlock the other', () => {
    expect(unitOptions(chicken).map((o) => o.key)).toEqual(['g', 'kg', 'oz', 'lb', 'serving:s1']); // no density: no cups
    expect(unitOptions(chicken).find((o) => o.key === 'serving:s1')!.unit).toBe('piece'); // "1 breast"
    expect(unitOptions(milk).map((o) => o.key)).toEqual(['ml', 'l', 'fl_oz', 'cup', 'tbsp', 'tsp', 'serving:s1', 'serving:s2', 'g', 'kg', 'oz', 'lb']);
    const rice = unitOptions(verifiedFood('fdb:rice_white_cooked')!);
    expect(rice.filter((o) => o.converted).map((o) => o.key)).toEqual(['cup', 'tbsp', 'tsp']);
  });

  it('previews portions with the domain math, and explains bad amounts', () => {
    const g = unitOptions(chicken).find((o) => o.key === 'g')!;
    expect(previewPortion(chicken, 150, g)).toMatchObject({ ok: true, amount: 150, amountUnit: 'g', macros: { kcal: 248, proteinG: 46.5, carbsG: 0, fatG: 5.4 } });
    expect(previewPortion(chicken, 0, g)).toMatchObject({ ok: false });
    expect(previewPortion(chicken, 9000, g)).toMatchObject({ ok: false, error: expect.stringMatching(/kg/) });
  });

  it('measured is only possible for weights and volumes read directly; counts and converted cups default to label', () => {
    expect(allowedMethods('serving')).toEqual(['label', 'estimated']);
    expect(allowedMethods('piece')).toEqual(['label', 'estimated']);
    expect(allowedMethods('cup', true)).toEqual(['label', 'estimated']);
    expect(allowedMethods('lb')).toContain('measured');
    expect(defaultMethod('serving')).toBe('label');
    expect(defaultMethod('g')).toBe('estimated');
  });

  it('says how the day is going in words, and nudges protein only when clearly short', () => {
    const d = (over: Partial<{ isToday: boolean; logs: unknown[]; kcalOver: number; proteinLeft: number; targets: boolean }>) => ({
      isToday: over.isToday ?? true,
      logs: over.logs ?? [1],
      progress: over.targets === false ? null : { kcal: { over: over.kcalOver ?? 0 }, proteinG: { remaining: over.proteinLeft ?? 0 } },
    });
    expect(dayHeadline(d({ logs: [] }))).toBe('Nothing logged yet');
    expect(dayHeadline(d({}))).toBe('You’re on track today');
    expect(dayHeadline(d({ kcalOver: 120 }))).toBe('A little over today');
    expect(dayHeadline(d({ isToday: false }))).toBe('On track that day');
    expect(dayHeadline(d({ isToday: false, kcalOver: 5 }))).toBe('A little over that day');
    expect(proteinNudge(d({ proteinLeft: 42.4 }))).toBe('You’re 42 g short on protein today.');
    expect(proteinNudge(d({ proteinLeft: 6 }))).toBeNull();
    expect(proteinNudge(d({ logs: [], proteinLeft: 80 }))).toBeNull();
    expect(proteinNudge(d({ targets: false }))).toBeNull();
  });

  it('reads typed amounts: decimals with . or , — and says what is wrong', () => {
    expect(readAmount('1,5')).toEqual({ ok: true, value: 1.5 });
    expect(readAmount(' 182.25 ')).toEqual({ ok: true, value: 182.25 });
    expect(readAmount('')).toEqual({ ok: false, error: null });
    expect(readAmount('1.234')).toMatchObject({ ok: false, error: expect.stringMatching(/2 decimal/) });
    expect(readAmount('12a')).toMatchObject({ ok: false, error: expect.stringMatching(/Numbers only/) });
    expect(readAmount('0')).toMatchObject({ ok: false, error: expect.stringMatching(/above zero/) });
    expect(readAmount('-3')).toMatchObject({ ok: false });
  });

  it('meal totals are the rounded sum of exact ingredient values', () => {
    const coffee = verifiedFood('fdb:coffee_black')!;
    const item = { food: coffee, choice: { quantity: 130, unit: 'ml' as const, servingId: null } };
    expect(previewPortion(coffee, 130, { unit: 'ml', servingId: null })).toMatchObject({ macros: { kcal: 1 } });
    expect(mealTotals([item, item, item]).kcal).toBe(4); // 3 × 1.3 = 3.9, not 1 + 1 + 1
  });

  it('badges never hide a scan estimate', () => {
    expect(entryBadge({ source: 'scan_estimate', amountMethod: 'estimated' }).label).toBe('Scan estimate');
    expect(entryBadge({ source: 'verified_database', amountMethod: 'measured' }).label).toBe('Measured');
    expect(entryBadge({ source: 'user_food', amountMethod: 'label' }).label).toBe('Label');
    expect(entryBadge({ source: 'manual', amountMethod: 'estimated' }).label).toBe('Estimate');
  });

  it('formats portions, litres, amounts and day navigation bounds', () => {
    expect(portionLabel({ quantity: 1.5, unit: 'serving', servingLabel: '1 cup (158 g)' })).toBe('1.5 × 1 cup (158 g)');
    expect(portionLabel({ quantity: 8, unit: 'fl_oz', servingLabel: null })).toBe('8 fl oz');
    expect(portionLabel({ quantity: 1.5, unit: 'cup', servingLabel: null })).toBe('1.5 cups');
    expect(portionLabel({ quantity: 2, unit: 'piece', servingLabel: '1 medium (118 g)' })).toBe('2 × 1 medium (118 g)');
    expect(portionLabel({ quantity: null, unit: null, servingLabel: null })).toBeNull();
    expect(formatLiters(1800)).toBe('1.8 L');
    expect(parseAmount('1,5')).toBe(1.5);
    expect(Number.isNaN(parseAmount(''))).toBe(true);
    expect(dayNavigation('2026-09-29', '2026-09-29')).toEqual({ prev: '2026-09-28', next: null, isToday: true });
    expect(dayNavigation('2026-09-22', '2026-09-29').prev).toBeNull();
  });
});

function log(over: Partial<FoodLog>): FoodLog {
  return {
    id: over.id ?? 'l1',
    clientLogId: 'c1',
    localDate: '2026-09-29',
    mealType: 'lunch',
    loggedAt: '2026-09-29T12:00:00Z',
    name: 'Chicken breast, skinless, cooked',
    brand: null,
    foodId: 'fdb:chicken_breast_cooked',
    source: 'verified_database',
    amountMethod: 'measured',
    isEstimate: false,
    quantity: 150,
    unit: 'g',
    servingId: null,
    servingLabel: null,
    amount: 150,
    amountUnit: 'g',
    kcal: 248,
    proteinG: 46.5,
    carbsG: 0,
    fatG: 5.4,
    measurement: { via: 'mass', grams: 150, densityGPerMl: null, weightSource: 'typed' },
    basis: { per100: { kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 }, unit: 'g', calcVersion: 1 },
    scanId: null,
    mealId: null,
    mealName: null,
    replacedLogId: null,
    replacedEstimate: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

function dayWith(logs: FoodLog[], opts: { targets?: boolean; waterMl?: number } = {}): NutritionDay {
  const targets = opts.targets === false ? null : { targetKcal: 2400, proteinG: 180, carbsG: 260, fatG: 75, safeFloorKcal: 1700 };
  const s = summarizeNutritionDay(logs as DayEntry[], targets, { totalMl: opts.waterMl ?? 1800, targetMl: 3000 });
  return {
    date: '2026-09-29',
    isToday: true,
    logs,
    totals: s.totals,
    byMeal: s.byMeal,
    progress: s.progress,
    targets: targets ? { ...targets, effectiveFrom: '2026-09-01', bmrKcal: 1700, tdeeKcal: 2600, appliedGoal: 'maintain', dietStyles: [] } : null,
    water: { totalMl: opts.waterMl ?? 1800, targetMl: 3000, targetBasis: 'body_weight', progress: s.water, lastEntryId: null },
    xp: null,
  };
}

const LOGS = [
  log({ id: 'b', mealType: 'breakfast', name: 'Oats, rolled, dry', foodId: 'fdb:oats_dry', kcal: 1592, proteinG: 85.5, carbsG: 175, fatG: 48.6, quantity: 420, amount: 420 }),
  log({ id: 'l', mealType: 'lunch', kcal: 248 }),
  log({ id: 's', mealType: 'snack', name: 'Pasta (guess)', foodId: null, source: 'manual', amountMethod: 'estimated', isEstimate: true, quantity: null, unit: null, kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }),
];

function props(over: Partial<EatDayViewProps> = {}): EatDayViewProps {
  return {
    day: dayWith(LOGS),
    title: 'Today',
    onPrev: jest.fn(),
    onNext: null,
    onAdd: jest.fn(),
    onOpenLog: jest.fn(),
    onAddWater: jest.fn(),
    onScan: jest.fn(),
    scanAvailable: false,
    onWeighMeal: jest.fn(),
    showScanInfo: false,
    onSetUpProfile: jest.fn(),
    ...over,
  };
}

describe('EatDayView', () => {
  it('shows real totals against targets: calories, macros, water and what’s left', async () => {
    await render(<EatDayView {...props()} />);
    expect(screen.getByText('1,840')).toBeTruthy();
    expect(screen.getByText('/ 2,400 kcal')).toBeTruthy();
    expect(screen.getByText('560 left')).toBeTruthy();
    expect(screen.getByLabelText('Protein: 132 of 180 grams')).toBeTruthy();
    expect(screen.getByLabelText('Water: 1.8 L of 3.0 L')).toBeTruthy();
  });

  it('lists entries by meal with honest badges, and empty meals invite adding', async () => {
    const p = props();
    await render(<EatDayView {...p} />);
    expect(screen.getAllByText('Measured')).toHaveLength(2); // breakfast + lunch
    expect(screen.getByText('Estimate')).toBeTruthy();
    expect(screen.getByLabelText(/Pasta \(guess\), 0 calories, estimate/)).toBeTruthy();
    expect(screen.getAllByText('Nothing logged')).toHaveLength(1); // dinner
    await fireEvent.press(screen.getByRole('button', { name: 'Add to Dinner' }));
    expect(p.onAdd).toHaveBeenCalledWith('dinner');
    await fireEvent.press(screen.getByLabelText(/^Oats, rolled, dry/));
    expect(p.onOpenLog).toHaveBeenCalledWith(expect.objectContaining({ id: 'b' }));
  });

  it('flags estimated calories and over-target days without shaming', async () => {
    const over = dayWith([log({ kcal: 2600 }), log({ id: 'e', source: 'manual', amountMethod: 'estimated', isEstimate: true, kcal: 300, foodId: null })]);
    await render(<EatDayView {...props({ day: over })} />);
    expect(screen.getByText('500 over')).toBeTruthy();
    expect(screen.getByText(/About 10% of these calories are estimates/)).toBeTruthy();
  });

  it('without a body profile there are no targets — it asks for profile details instead', async () => {
    const p = props({ day: dayWith(LOGS, { targets: false }) });
    await render(<EatDayView {...p} />);
    expect(screen.queryByText(/left$/)).toBeNull();
    await fireEvent.press(screen.getByRole('link'));
    expect(p.onSetUpProfile).toHaveBeenCalled();
  });

  it('water quick-add only for today; day navigation; scanning is honestly unavailable', async () => {
    const p = props({ showScanInfo: true });
    const { rerender } = await render(<EatDayView {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: '+250 ml' }));
    expect(p.onAddWater).toHaveBeenCalledWith(250);
    await fireEvent.press(screen.getByRole('button', { name: 'Previous day' }));
    expect(p.onPrev).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Next day' })).toBeNull();
    expect(screen.getByText("Food scanning isn't available yet")).toBeTruthy();
    await rerender(<EatDayView {...p} onAddWater={undefined} title="Yesterday" />);
    expect(screen.queryByRole('button', { name: '+250 ml' })).toBeNull();
  });
});

/** A scale driven by the test: every event is pushed by hand. */
function manualScale() {
  let emit: ((e: ScaleEvent) => void) | null = null;
  const provider: ScaleProvider = {
    kind: 'scale',
    name: 'Test scale',
    development: false,
    supported: true,
    connect(on) {
      emit = on;
      on({ type: 'connect' });
      return () => {
        emit = null;
      };
    },
  };
  return { provider, send: async (...events: ScaleEvent[]) => act(async () => events.forEach((e) => emit!(e))) };
}

const rice = verifiedFood('fdb:rice_white_cooked')!;

describe('PortionEditor', () => {
  it('weighs in grams by default; a typed weight is MEASURED only when the user says so; logs the exact choice', async () => {
    const onSubmit = jest.fn();
    await render(<PortionEditor food={chicken} initial={{ mealType: 'dinner' }} submitLabel="Log food" onSubmit={onSubmit} scale={NO_SCALE_PROVIDER} />);
    expect(screen.getByLabelText('About 165 calories, Estimate')).toBeTruthy();
    expect(screen.getByText('ESTIMATED')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Measured' }));
    await fireEvent.changeText(screen.getByLabelText('Amount (g)'), '150');
    expect(screen.getByLabelText('248 calories, Measured')).toBeTruthy();
    expect(screen.getByText('MEASURED')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
    expect(onSubmit).toHaveBeenCalledWith({ quantity: 150, unit: 'g', servingId: null, amountMethod: 'measured', mealType: 'dinner', weightSource: 'typed' });
  });

  it('a piece is counted, never measured', async () => {
    const onSubmit = jest.fn();
    await render(<PortionEditor food={chicken} initial={{ unit: 'g', quantity: 150, amountMethod: 'measured' }} submitLabel="Log food" onSubmit={onSubmit} scale={NO_SCALE_PROVIDER} />);
    await fireEvent.press(screen.getByRole('radio', { name: '1 breast (172 g)' }));
    expect(screen.queryByRole('radio', { name: 'Measured' })).toBeNull();
    expect(screen.getByLabelText('284 calories, Label')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ quantity: 1, unit: 'piece', servingId: 's1', amountMethod: 'label' }));
    expect(onSubmit.mock.calls[0][0].weightSource).toBeUndefined();
  });

  it('switching units keeps the same amount of food', async () => {
    await render(<PortionEditor food={chicken} initial={{ unit: 'g', quantity: 150 }} submitLabel="Log food" onSubmit={jest.fn()} scale={NO_SCALE_PROVIDER} />);
    await fireEvent.press(screen.getByRole('radio', { name: 'oz' }));
    expect(screen.getByDisplayValue('5.29')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'kg' }));
    expect(screen.getByDisplayValue('0.15')).toBeTruthy();
    expect(screen.getByLabelText(/^About 248 calories/)).toBeTruthy();
  });

  it('accepts decimals with a comma, explains invalid input and never logs it', async () => {
    const onSubmit = jest.fn();
    await render(<PortionEditor food={chicken} initial={{ unit: 'kg', quantity: 1 }} submitLabel="Log food" onSubmit={onSubmit} scale={NO_SCALE_PROVIDER} />);
    await fireEvent.changeText(screen.getByLabelText('Amount (kg)'), '0,2');
    expect(screen.getByLabelText(/^About 330 calories/)).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Amount (kg)'), '0.125');
    expect(screen.getByText('Use at most 2 decimal places.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
    await fireEvent.changeText(screen.getByLabelText('Amount (kg)'), '9');
    expect(screen.getByText(/more than 5 kg/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('cups of a solid convert through its density and are never MEASURED', async () => {
    await render(<PortionEditor food={rice} initial={{ unit: 'g', quantity: 158, amountMethod: 'measured' }} submitLabel="Log food" onSubmit={jest.fn()} scale={NO_SCALE_PROVIDER} />);
    await fireEvent.press(screen.getByRole('radio', { name: 'cup' }));
    expect(screen.getByDisplayValue('1')).toBeTruthy();
    expect(screen.getByText(/not a measurement/)).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Measured' })).toBeNull();
    expect(screen.getByLabelText('205 calories, Label')).toBeTruthy();
  });

  it('replacing a scan estimate offers only better-than-estimate amounts; scan edits stay estimates', async () => {
    const { unmount } = await render(<PortionEditor food={chicken} replacing initial={{ unit: 'g', quantity: 140, amountMethod: 'measured' }} submitLabel="Replace" onSubmit={jest.fn()} scale={NO_SCALE_PROVIDER} />);
    expect(screen.getByRole('radio', { name: 'Measured' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Label' })).toBeTruthy();
    expect(screen.queryByRole('radio', { name: 'Estimate' })).toBeNull();
    await unmount();
    await render(<PortionEditor food={chicken} lockEstimated initial={{ unit: 'g', quantity: 140, amountMethod: 'estimated' }} submitLabel="Save" onSubmit={jest.fn()} scale={NO_SCALE_PROVIDER} />);
    expect(screen.queryByRole('radio', { name: 'Measured' })).toBeNull();
    expect(screen.getByText('ESTIMATED')).toBeTruthy();
    expect(screen.queryByText(/smart scale/)).toBeNull(); // no weighing offered for an estimate edit
  });

  it('without scale support it says so; typing the weight is always available', async () => {
    await render(<PortionEditor food={chicken} submitLabel="Log food" onSubmit={jest.fn()} scale={NO_SCALE_PROVIDER} />);
    expect(screen.getByText(/No smart scale connected/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Connect scale' })).toBeNull();
    expect(screen.getByLabelText('Amount (g)')).toBeTruthy();
  });

  it('scale states: connecting → connected → reading → stable; only a stable weight can be used, and it is MEASURED from the scale', async () => {
    const scale = manualScale();
    const onSubmit = jest.fn();
    await render(<PortionEditor food={chicken} initial={{ mealType: 'lunch' }} submitLabel="Log food" onSubmit={onSubmit} scale={scale.provider} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Connect scale' }));
    expect(screen.getByText('Connecting…')).toBeTruthy();
    await scale.send({ type: 'connected', device: 'Kitchen scale' });
    expect(screen.getByText(/Place the food on the scale/)).toBeTruthy();
    await scale.send({ type: 'sample', grams: 60, atMs: 0 }, { type: 'sample', grams: 140, atMs: 250 });
    expect(screen.getByText('Reading… hold still')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Use / })).toBeNull();
    await scale.send(...[182.1, 182.3, 182.2, 182.2, 182.3].map((grams, i) => ({ type: 'sample' as const, grams, atMs: 1000 + i * 250 })));
    expect(screen.getByText('STABLE')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Use 182.2 g' }));
    expect(screen.getByDisplayValue('182.2')).toBeTruthy();
    expect(screen.getByText(/Read from the scale/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ quantity: 182.2, unit: 'g', amountMethod: 'measured', weightSource: 'scale' }));
    // Typing over it makes it a typed weight again.
    await fireEvent.changeText(screen.getByLabelText('Amount (g)'), '180');
    await fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
    expect(onSubmit).toHaveBeenLastCalledWith(expect.objectContaining({ quantity: 180, weightSource: 'typed' }));
  });

  it('scale errors say what happened and offer a retry', async () => {
    const onConnect = jest.fn();
    await render(<ScaleBody state={{ status: 'error', code: 'disconnected', message: 'The scale disconnected.' }} onConnect={onConnect} onDisconnect={jest.fn()} onUse={jest.fn()} />);
    expect(screen.getByText('The scale disconnected.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(onConnect).toHaveBeenCalled();
    await render(<ScaleBody state={SCALE_IDLE} onConnect={onConnect} onDisconnect={jest.fn()} onUse={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Connect scale' })).toBeTruthy();
  });
});

describe('Provenance', () => {
  it('says how a number was obtained and what estimate it replaced', async () => {
    await render(<Provenance log={log({ measurement: { via: 'mass', grams: 142, densityGPerMl: null, weightSource: 'scale' }, replacedEstimate: { id: 'x', name: 'Chicken breast', amount: 150, amountUnit: 'g', kcal: 247.5, scanId: 's1', loggedAt: '' } })} />);
    expect(screen.getByText(/MEASURED — weighed, read from a connected scale/)).toBeTruthy();
    expect(screen.getByText(/Replaced a scan estimate: Chicken breast, 150 g, ≈ 248 kcal/)).toBeTruthy();
    expect(screen.getByText(/Calculated from 165 kcal per 100 g/)).toBeTruthy();
  });

  it('a converted cup is described as converted, not measured', async () => {
    await render(<Provenance log={log({ amountMethod: 'label', unit: 'cup', measurement: { via: 'density', grams: 158, densityGPerMl: 0.668, weightSource: null } })} />);
    expect(screen.getByText(/About 158 g, converted from a household measure/)).toBeTruthy();
    expect(screen.queryByText(/MEASURED/)).toBeNull();
  });
});

describe('Home accuracy line', () => {
  it('reports measured and estimated shares honestly', () => {
    expect(accuracyLine(0.6, 0.4)).toBe('60% measured · 40% estimated');
    expect(accuracyLine(0, 0.3)).toMatch(/30% estimated — weigh/);
    expect(accuracyLine(1, 0)).toBe('100% measured');
    expect(accuracyLine(0, 0)).toBe('From labels and servings');
  });
});

describe('ManualFoodForm', () => {
  it('won’t call it weighed without a weight', async () => {
    const onSubmit = jest.fn();
    await render(<ManualFoodForm submitLabel="Log food" onSubmit={onSubmit} />);
    await fireEvent.changeText(screen.getByLabelText('Food'), 'Curry');
    await fireEvent.changeText(screen.getByLabelText('Calories'), '850');
    await fireEvent.press(screen.getByRole('radio', { name: 'Measured' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Enter the weight from your scale/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Estimate' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ name: 'Curry', kcal: 850, grams: null, amountMethod: 'estimated' }));
  });
});
