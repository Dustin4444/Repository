import { describe, it, expect, vi, afterEach } from 'vitest';
import { sleep, nowSeconds } from '../utils/timer-utils';

/**
 * Demonstrates Vitest fake-timer capabilities against the timer-utils module
 * that is consumed by both axios-query and rbf-cache.
 */
describe('timer-utils with fake timers', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('vi.setSystemTime() controls Date.now() inside nowSeconds()', () => {
    vi.useFakeTimers();
    const pinned = new Date('2024-01-01T00:00:00.000Z');
    vi.setSystemTime(pinned);

    expect(nowSeconds()).toBe(pinned.getTime() / 1000);
  });

  it('sleep() resolves after the timer is advanced', async () => {
    vi.useFakeTimers();

    let resolved = false;
    const promise = sleep(5_000).then(() => {
      resolved = true;
    });

    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(5_000);
    await promise;

    expect(resolved).toBe(true);
  });

  it('sleep() does not resolve before the delay elapses', async () => {
    vi.useFakeTimers();

    let resolved = false;
    sleep(10_000).then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(9_999);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.resolve(); // flush microtask queue
    expect(resolved).toBe(true);
  });

  it('setInterval callback fires on every tick when timers are advanced', async () => {
    vi.useFakeTimers();

    let ticks = 0;
    const id = setInterval(() => ticks++, 1_000);

    await vi.advanceTimersByTimeAsync(3_500);
    expect(ticks).toBe(3);

    clearInterval(id);
  });

  it('vi.useRealTimers() restores the real Date object', () => {
    vi.useFakeTimers();
    const pinned = new Date('2000-06-15T12:00:00.000Z');
    vi.setSystemTime(pinned);
    expect(nowSeconds()).toBe(pinned.getTime() / 1000);

    vi.useRealTimers();
    // After restoring, nowSeconds() should reflect the actual system clock,
    // which will be greater than the pinned date.
    expect(nowSeconds()).toBeGreaterThan(pinned.getTime() / 1000);
  });
});
