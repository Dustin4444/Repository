/**
 * Global per-test teardown to prevent mock/timer/state leaks between tests.
 * Runs after the Jest test framework is installed (allows use of afterEach etc.).
 */
afterEach(() => {
  // Clear any pending fake timers before restoring real timers
  jest.clearAllTimers();
  // Restore real timers if any test used fake timers
  jest.useRealTimers();
});
