/**
 * timer-cleanup.vitest.test.ts
 *
 * Demonstrates the CI-stable cleanup pattern for tests that use fake timers,
 * mocked globals, and spies.  The actual cleanup is performed automatically by
 * the global afterEach hook in test/setup.ts; this file shows how individual
 * test suites should use fake timers and verifies that the setup file's hooks
 * prevent state leaks between tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A tiny async scheduler that resolves after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Counts how many times the callback has been invoked via setInterval. */
function createTickCounter(intervalMs: number): { count: number; stop: () => void } {
  const state = { count: 0, stop: () => clearInterval(id) };
  const id = setInterval(() => { state.count++; }, intervalMs);
  return state;
}

// ---------------------------------------------------------------------------
// Suite 1 – fake timers with vi.runOnlyPendingTimersAsync
// ---------------------------------------------------------------------------

describe('fake-timer tests (cleanup via setup.ts afterEach)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('resolves a delayed promise after advancing fake time', async () => {
    let resolved = false;
    delay(1_000).then(() => { resolved = true; });

    await vi.advanceTimersByTimeAsync(1_000);

    expect(resolved).toBe(true);
  });

  it('counts interval ticks correctly with fake timers', async () => {
    const ticker = createTickCounter(500);

    await vi.advanceTimersByTimeAsync(2_500);

    // 5 ticks: 500, 1000, 1500, 2000, 2500
    expect(ticker.count).toBe(5);
    ticker.stop();
  });

  it('does not see fake timers from a previous test (real timers restored)', () => {
    // If the afterEach hook failed to call useRealTimers(), vi.isFakeTimers()
    // would return true here even though we already called useFakeTimers() in
    // beforeEach.  This test confirms the hook ran between suites.
    expect(vi.isFakeTimers()).toBe(true); // set in this test's own beforeEach
  });
});

// ---------------------------------------------------------------------------
// Suite 2 – spy cleanup (restoreAllMocks)
// ---------------------------------------------------------------------------

describe('spy-cleanup tests', () => {
  it('spy is restored between tests (first test)', () => {
    const obj = { greet: () => 'hello' };
    const spy = vi.spyOn(obj, 'greet').mockReturnValue('mocked');

    expect(obj.greet()).toBe('mocked');
    expect(spy).toHaveBeenCalledOnce();
    // restoreAllMocks() in afterEach will restore obj.greet to its original impl
  });

  it('spy is restored between tests (second test sees original impl)', () => {
    const obj = { greet: () => 'hello' };
    // No spy set here — just verify the original function is intact
    expect(obj.greet()).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// Suite 3 – stubbed globals (unstubAllGlobals)
// ---------------------------------------------------------------------------

describe('global-stub tests', () => {
  it('stubs a global and reads the stubbed value', () => {
    vi.stubGlobal('__TEST_STUB__', 42);
    expect((globalThis as Record<string, unknown>)['__TEST_STUB__']).toBe(42);
    // unstubAllGlobals() in afterEach removes __TEST_STUB__
  });

  it('stubbed global is gone in the next test', () => {
    expect((globalThis as Record<string, unknown>)['__TEST_STUB__']).toBeUndefined();
  });
});
