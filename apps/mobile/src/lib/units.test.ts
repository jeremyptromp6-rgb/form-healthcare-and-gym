import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';
import { createElement, type ReactNode } from 'react';
import { formatLoad, formatVolume, loadFromDisplay, loadStep, loadToDisplay, loadUnit, snapLoadKg, useUnits } from './units';

describe('lifting loads', () => {
  it('names the unit', () => {
    expect(loadUnit('metric')).toBe('kg');
    expect(loadUnit('imperial')).toBe('lb');
  });

  it('converts a typed 135 lb to about 61.2 kg and shows it as 135 again', () => {
    const kg = loadFromDisplay(135, 'imperial');
    expect(kg).toBe(61.23);
    expect(loadToDisplay(kg, 'imperial')).toBe(135);
  });

  it('leaves metric loads exactly as stored', () => {
    expect(loadFromDisplay(60, 'metric')).toBe(60);
    expect(loadToDisplay(60, 'metric')).toBe(60);
    expect(loadToDisplay(22.5, 'metric')).toBe(22.5);
    expect(loadToDisplay(22.25, 'metric')).toBe(22.25);
  });

  it('round-trips every pound value to 0.1 and every kilogram value to 0.01 without drift', () => {
    for (let tenths = 1; tenths <= 12000; tenths += 1) {
      const lb = tenths / 10;
      expect(loadToDisplay(loadFromDisplay(lb, 'imperial'), 'imperial')).toBe(lb);
    }
    for (let hundredths = 0; hundredths <= 10000; hundredths += 7) {
      const kg = hundredths / 100;
      expect(loadToDisplay(kg, 'metric')).toBe(kg);
      expect(loadFromDisplay(kg, 'metric')).toBe(kg);
    }
  });

  it('does not drift when a load is converted back and forth many times', () => {
    let kg = 60;
    for (let i = 0; i < 50; i += 1) kg = loadFromDisplay(loadToDisplay(kg, 'imperial'), 'imperial');
    // 60 kg is 132.3 lb; going through pounds settles within 0.01 kg and then stays put.
    expect(Math.abs(kg - 60)).toBeLessThan(0.05);
    const settled = loadFromDisplay(loadToDisplay(kg, 'imperial'), 'imperial');
    expect(settled).toBe(kg);
  });

  it('rounds a suggested load to the nearest half pound for imperial users only', () => {
    expect(loadToDisplay(snapLoadKg(20, 'imperial'), 'imperial')).toBe(44); // not 44.1
    expect(loadToDisplay(snapLoadKg(12, 'imperial'), 'imperial')).toBe(26.5);
    expect(loadToDisplay(snapLoadKg(10, 'imperial'), 'imperial')).toBe(22);
    expect(snapLoadKg(12, 'metric')).toBe(12);
    expect(snapLoadKg(22.37, 'metric')).toBe(22.37);
  });

  it('steps by 2.5 kg, or by a plate-sized number of pounds', () => {
    expect(loadStep(2.5, 'metric')).toBe(2.5);
    expect(loadStep(1, 'metric')).toBe(1);
    expect(loadStep(2.5, 'imperial')).toBe(5);
    expect(loadStep(5, 'imperial')).toBe(10);
    expect(loadStep(1, 'imperial')).toBe(2.5);
    expect(loadStep(1.25, 'imperial')).toBe(2.5);
    expect(loadStep(0.5, 'imperial')).toBe(1);
  });

  it('formats loads and volume in the user units', () => {
    expect(formatLoad(61.23, 'imperial')).toBe('135 lb');
    expect(formatLoad(22.5, 'metric')).toBe('22.5 kg');
    expect(formatLoad(20, 'imperial', true)).toBe('44 lb');
    expect(formatLoad(20, 'metric', true)).toBe('20 kg');
    expect(formatVolume(1230, 'metric')).toEqual({ value: (1230).toLocaleString(), unit: 'kg' });
    expect(formatVolume(1000, 'imperial')).toEqual({ value: (2205).toLocaleString(), unit: 'lb' });
  });
});

describe('useUnits', () => {
  const wrap = (client: QueryClient) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client }, children);
    };

  it('is metric without a profile or a provider', async () => {
    expect((await renderHook(() => useUnits())).result.current).toBe('metric');
    expect((await renderHook(() => useUnits(), { wrapper: wrap(new QueryClient()) })).result.current).toBe('metric');
  });

  it("reads the user's setting from the cached profile and follows a change", async () => {
    const client = new QueryClient();
    client.setQueryData(['me'], { settings: { units: 'imperial' } });
    const { result } = await renderHook(() => useUnits(), { wrapper: wrap(client) });
    expect(result.current).toBe('imperial');
    await act(async () => {
      client.setQueryData(['me'], { settings: { units: 'metric' } });
    });
    expect(result.current).toBe('metric');
  });

  it('lets an explicit value win', async () => {
    const client = new QueryClient();
    client.setQueryData(['me'], { settings: { units: 'metric' } });
    const { result } = await renderHook(() => useUnits('imperial'), { wrapper: wrap(client) });
    expect(result.current).toBe('imperial');
  });
});
