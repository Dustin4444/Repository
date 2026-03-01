import { afterEach, vi } from 'vitest';

/**
 * Global Vitest cleanup hooks.
 *
 * After every test we:
 *   1. Flush any pending fake timers (avoids hanging promises / unresolved callbacks).
 *   2. Restore real timers so the next test starts in a clean time environment.
 *   3. Restore all spies and mocked modules to their original implementations.
 *   4. Unstub any globals that were replaced with vi.stubGlobal().
 *
 * See CONTRIBUTING.md §"Vitest Cleanup Pattern" for the rationale.
 */
afterEach(async () => {
  // 1. Drain only the timers that are already queued — but only when fake
  //    timers are active.  Calling runOnlyPendingTimersAsync() while real
  //    timers are in use throws an error and would abort the rest of cleanup.
  if (vi.isFakeTimers()) {
    await vi.runOnlyPendingTimersAsync();

    // 2. Switch back to real timers before the next test runs.
    vi.useRealTimers();
  }

  // 3. Reset call history and restore any spied-on / mocked implementations.
  vi.restoreAllMocks();

  // 4. Undo any vi.stubGlobal() calls made during the test.
  vi.unstubAllGlobals();
});
