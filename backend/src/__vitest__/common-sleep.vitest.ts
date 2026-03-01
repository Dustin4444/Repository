/**
 * Vitest fake-timer tests for Common.sleep$
 *
 * Verifies that:
 *  - Common.sleep$ resolves after the requested delay using a fake setTimeout
 *  - The promise does NOT resolve before the delay elapses
 *  - vi.setSystemTime() lets tests anchor wall-clock references deterministically
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../config', () => ({
  default: {
    MEMPOOL: {
      NETWORK: 'mainnet',
      BACKEND: 'none',
      POLL_RATE_MS: 2000,
    },
    REDIS: { ENABLED: false },
    LIGHTNING: { ENABLED: false },
  },
}));

vi.mock('../../logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    err: vi.fn(),
  },
}));

vi.mock('../api/transaction-utils', () => ({ default: {} }));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Common.sleep$ – fake-timer behaviour', () => {
  const FIXED_NOW = new Date('2024-01-15T08:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after the specified delay', async () => {
    const { Common } = await import('../api/common');
    const resolved = vi.fn();
    const p = Common.sleep$(3000).then(resolved);

    // Not yet resolved
    expect(resolved).not.toHaveBeenCalled();

    // Advance time to exactly the delay
    vi.advanceTimersByTime(3000);
    await p;

    expect(resolved).toHaveBeenCalledOnce();
  });

  it('does not resolve before the delay has elapsed', async () => {
    const { Common } = await import('../api/common');
    const resolved = vi.fn();
    const p = Common.sleep$(5000).then(resolved);

    vi.advanceTimersByTime(4999);
    // Flush any microtasks but NOT the timer itself
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();

    // Now fully advance and await completion
    vi.advanceTimersByTime(1);
    await p;
    expect(resolved).toHaveBeenCalledOnce();
  });

  it('handles zero-millisecond delay', async () => {
    const { Common } = await import('../api/common');
    const resolved = vi.fn();
    const p = Common.sleep$(0).then(resolved);

    vi.advanceTimersByTime(0);
    await p;
    expect(resolved).toHaveBeenCalledOnce();
  });

  it('system time is frozen at the value set by vi.setSystemTime()', async () => {
    // Verifies that Date.now() inside the tested code reflects the pinned time.
    const before = Date.now();
    vi.advanceTimersByTime(1000);
    const after = Date.now();

    // With fake timers, Date.now() should advance by exactly what we advanced.
    expect(after - before).toBe(1000);
    expect(before).toBe(FIXED_NOW.getTime());
  });
});
