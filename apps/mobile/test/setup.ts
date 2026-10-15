// Tests run as if the OS "reduce motion" setting were on: every animation jumps straight to its end
// state (a path the app supports for real users), so no animation updates land outside act().
jest.mock('@/lib/a11y', () => ({ useReducedMotion: () => true }));

// Expo installs `fetch` as a lazy global that loads a native logger the first time it's read. If a
// test's first read lands after Jest has torn the environment down, that logger writes "Cannot log
// after tests are done" and Jest exits 1 even though every test passed. Reading it once here, while
// the environment is alive, settles the getter up front.
void globalThis.fetch;
