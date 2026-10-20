import { Linking, Platform } from 'react-native';
import { aggregateRecord, getGrantedPermissions, getSdkStatus, initialize, requestPermission } from 'react-native-health-connect';
import { createStepsSyncer, hasStepsPermission, HEALTH_CONNECT_PLAY_URL, openStepsInstall, readRecentSteps, requestStepsPermission, stepsAvailability } from './steps';

const mockStatus = getSdkStatus as jest.Mock;
const mockGranted = getGrantedPermissions as jest.Mock;
const mockRequest = requestPermission as jest.Mock;
const mockAggregate = aggregateRecord as jest.Mock;
const mockInit = initialize as jest.Mock;

const READ_STEPS = { accessType: 'read', recordType: 'Steps' };

function platform(os: 'android' | 'ios' | 'web') {
  jest.replaceProperty(Platform, 'OS', os);
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
  mockStatus.mockResolvedValue(1);
  mockInit.mockResolvedValue(true);
  mockGranted.mockResolvedValue([]);
  mockRequest.mockResolvedValue([]);
  mockAggregate.mockResolvedValue({ COUNT_TOTAL: 0 });
});

describe('availability', () => {
  it.each(['ios', 'web'] as const)('is unavailable on %s without touching the native module', async (os) => {
    platform(os);
    expect(await stepsAvailability()).toBe('unavailable');
    expect(await hasStepsPermission()).toBe(false);
    expect(await requestStepsPermission()).toBe(false);
    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('maps the Health Connect status on Android', async () => {
    platform('android');
    mockStatus.mockResolvedValueOnce(3);
    expect(await stepsAvailability()).toBe('available');
    mockStatus.mockResolvedValueOnce(2);
    expect(await stepsAvailability()).toBe('needs_install');
    mockStatus.mockResolvedValueOnce(1);
    expect(await stepsAvailability()).toBe('unavailable');
    mockStatus.mockRejectedValueOnce(new Error('boom'));
    expect(await stepsAvailability()).toBe('unavailable');
  });

  it('links to Health Connect in Google Play', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    openStepsInstall();
    expect(open).toHaveBeenCalledWith(HEALTH_CONNECT_PLAY_URL);
  });
});

describe('permission', () => {
  beforeEach(() => platform('android'));

  it('checks the grant without prompting', async () => {
    mockGranted.mockResolvedValue([READ_STEPS]);
    expect(await hasStepsPermission()).toBe(true);
    expect(mockRequest).not.toHaveBeenCalled();
    mockGranted.mockResolvedValue([{ accessType: 'read', recordType: 'HeartRate' }]);
    expect(await hasStepsPermission()).toBe(false);
  });

  it('asks for read access to steps only, and reports the answer', async () => {
    mockRequest.mockResolvedValueOnce([READ_STEPS]);
    expect(await requestStepsPermission()).toBe(true);
    expect(mockRequest).toHaveBeenCalledWith([READ_STEPS]);
    mockRequest.mockResolvedValueOnce([]);
    expect(await requestStepsPermission()).toBe(false);
    mockRequest.mockRejectedValueOnce(new Error('no activity'));
    expect(await requestStepsPermission()).toBe(false);
  });
});

describe('reading', () => {
  beforeEach(() => platform('android'));

  it("sums the user's local day: midnight to now for today, midnight to midnight for yesterday", async () => {
    const now = new Date(2026, 9, 20, 15, 30);
    mockAggregate.mockImplementation(({ timeRangeFilter }: { timeRangeFilter: { startTime: string } }) =>
      Promise.resolve({ COUNT_TOTAL: timeRangeFilter.startTime === new Date(2026, 9, 20).toISOString() ? 6500 : 9100 }),
    );
    const res = await readRecentSteps(now);
    expect(res.today).toEqual({ localDate: '2026-10-20', steps: 6500 });
    expect(res.yesterday).toEqual({ localDate: '2026-10-19', steps: 9100 });
    expect(mockAggregate).toHaveBeenCalledWith({ recordType: 'Steps', timeRangeFilter: { operator: 'between', startTime: new Date(2026, 9, 20).toISOString(), endTime: now.toISOString() } });
    expect(mockAggregate).toHaveBeenCalledWith({ recordType: 'Steps', timeRangeFilter: { operator: 'between', startTime: new Date(2026, 9, 19).toISOString(), endTime: new Date(2026, 9, 20).toISOString() } });
  });

  it('leaves out a day that cannot be read', async () => {
    mockAggregate.mockRejectedValue(new Error('denied'));
    expect(await readRecentSteps(new Date(2026, 9, 20, 12))).toEqual({ today: null, yesterday: null });
  });
});

describe('createStepsSyncer', () => {
  it('waits for the last change, sends each day once, and only when the total went up', async () => {
    jest.useFakeTimers();
    const send = jest.fn().mockResolvedValue({});
    const syncer = createStepsSyncer(send, 1000);
    syncer.schedule([{ localDate: '2026-10-20', steps: 1000 }]);
    syncer.schedule([{ localDate: '2026-10-20', steps: 2500 }, { localDate: '2026-10-19', steps: 8000 }]);
    jest.advanceTimersByTime(999);
    expect(send).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith({ localDate: '2026-10-20', steps: 2500 });
    expect(send).toHaveBeenCalledWith({ localDate: '2026-10-19', steps: 8000 });

    syncer.schedule([{ localDate: '2026-10-20', steps: 2500 }, { localDate: '2026-10-19', steps: 7000 }]); // nothing new
    jest.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(2);
    syncer.schedule([{ localDate: '2026-10-20', steps: 4000 }]);
    jest.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('tries a failed day again at the next sync', async () => {
    jest.useFakeTimers();
    const send = jest.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({});
    const syncer = createStepsSyncer(send, 100);
    syncer.schedule([{ localDate: '2026-10-20', steps: 3000 }]);
    jest.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    syncer.schedule([{ localDate: '2026-10-20', steps: 3000 }]);
    jest.advanceTimersByTime(100);
    expect(send).toHaveBeenCalledTimes(2);
  });
});
