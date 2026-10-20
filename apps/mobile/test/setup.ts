// Tests run as if the OS "reduce motion" setting were on: every animation jumps straight to its end
// state (a path the app supports for real users), so no animation updates land outside act().
jest.mock('@/lib/a11y', () => ({ useReducedMotion: () => true }));

// Expo installs `fetch` as a lazy global that loads a native logger the first time it's read. If a
// test's first read lands after Jest has torn the environment down, that logger writes "Cannot log
// after tests are done" and Jest exits 1 even though every test passed. Reading it once here, while
// the environment is alive, settles the getter up front.
void globalThis.fetch;

// Health Connect is a native Android module; tests drive it through these mocks (default: not available).
jest.mock('react-native-health-connect', () => ({
  SdkAvailabilityStatus: { SDK_UNAVAILABLE: 1, SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2, SDK_AVAILABLE: 3 },
  getSdkStatus: jest.fn(() => Promise.resolve(1)),
  initialize: jest.fn(() => Promise.resolve(true)),
  getGrantedPermissions: jest.fn(() => Promise.resolve([])),
  requestPermission: jest.fn(() => Promise.resolve([])),
  aggregateRecord: jest.fn(() => Promise.resolve({ COUNT_TOTAL: 0 })),
  openHealthConnectSettings: jest.fn(),
}));

// Local reminders: tests drive the device's notification system through these mocks (default: permission granted, nothing scheduled).
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, canAskAgain: true, status: 'granted' })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true, canAskAgain: true, status: 'granted' })),
  getAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve([])),
  scheduleNotificationAsync: jest.fn((req: { identifier?: string }) => Promise.resolve(req.identifier ?? 'id')),
  cancelScheduledNotificationAsync: jest.fn(() => Promise.resolve()),
  cancelAllScheduledNotificationsAsync: jest.fn(() => Promise.resolve()),
  useLastNotificationResponse: jest.fn(() => null),
}));
