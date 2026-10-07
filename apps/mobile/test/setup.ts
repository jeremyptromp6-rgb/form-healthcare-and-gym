// Tests run as if the OS "reduce motion" setting were on: every animation jumps straight to its end
// state (a path the app supports for real users), so no animation updates land outside act().
jest.mock('@/lib/a11y', () => ({ useReducedMotion: () => true }));
