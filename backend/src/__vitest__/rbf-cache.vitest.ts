/**
 * Vitest fake-timer tests for RbfCache
 *
 * Verifies that:
 *  - Date.now()-based expiry timestamps are deterministic via vi.setSystemTime()
 *  - The setInterval cleanup is triggered deterministically via vi.advanceTimersByTime()
 *  - Evicted transactions are removed from the cache after the expiry window elapses
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module-level mocks – resolved before any module under test is loaded
// ---------------------------------------------------------------------------

vi.mock('../../config', () => ({
  default: {
    REDIS: { ENABLED: false },
    MEMPOOL: {
      NETWORK: 'mainnet',
      BACKEND: 'none',
      POLL_RATE_MS: 2000,
    },
    LIGHTNING: { ENABLED: false },
  },
}));

vi.mock('../../logger', () => ({
  default: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    err: vi.fn(),
    notice: vi.fn(),
  },
}));

vi.mock('../api/redis-cache', () => ({
  default: {
    $setRbfEntry: vi.fn(),
    $removeRbfEntry: vi.fn(),
  },
}));

vi.mock('../api/bitcoin/bitcoin-api-factory', () => ({
  default: {},
}));

// ---------------------------------------------------------------------------
// Minimal transaction factory
// ---------------------------------------------------------------------------

function makeTx(txid: string, sequence = 0xffffffff) {
  return {
    txid,
    version: 1,
    locktime: 0,
    size: 250,
    weight: 1000,
    fee: 500,
    sigops: 0,
    vin: [{ txid: 'prev', vout: 0, sequence, scriptsig: '', scriptsig_asm: '', witness: [], is_coinbase: false, prevout: null }],
    vout: [{ scriptpubkey: '', scriptpubkey_asm: '', scriptpubkey_type: '', scriptpubkey_address: '', value: 10000 }],
    status: { confirmed: false },
    vsize: 250,
    feePerVsize: 2,
    effectiveFeePerVsize: 2,
    firstSeen: undefined as number | undefined,
    order: 0,
    adjustedVsize: 250,
    adjustedFeePerVsize: 2,
    replacement: false,
  } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RbfCache – fake-timer eviction and cleanup', () => {
  const FIXED_NOW = new Date('2024-06-01T12:00:00.000Z');
  const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
  const FAST_EXPIRY_MS = 10 * 60 * 1000;      // fast eviction: 10 minutes
  const SLOW_EXPIRY_MS = 86400 * 1000;         // normal eviction: 24 hours

  let rbfCache: (typeof import('../api/rbf-cache'))['default'];

  beforeEach(async () => {
    // Enable fake timers BEFORE importing the module so that the setInterval
    // in the RbfCache constructor is captured and controllable.
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);

    // Re-import the module fresh for each test to get a clean singleton.
    vi.resetModules();
    const mod = await import('../api/rbf-cache');
    rbfCache = mod.default;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not remove a transaction before its 24-hour expiry elapses', () => {
    const tx = makeTx('tx-a');
    const replaced = makeTx('tx-a-replaced');

    // Build a replacement chain; evict the tip transaction.
    rbfCache.add([replaced], tx);
    rbfCache.evict('tx-a');

    // Advance to just under 24 hours then fire the cleanup interval.
    vi.advanceTimersByTime(SLOW_EXPIRY_MS - 1);
    vi.advanceTimersByTime(CLEANUP_INTERVAL_MS);

    expect(rbfCache.has('tx-a')).toBe(true);
  });

  it('removes a transaction and its predecessors after the 24-hour expiry window', () => {
    const tx = makeTx('tx-b');
    const replaced = makeTx('tx-b-replaced');

    rbfCache.add([replaced], tx);
    // Evict the tip (tx-b); RbfCache.remove() recurses and removes tx-b-replaced too.
    rbfCache.evict('tx-b');

    // Advance past 24-hour expiry, then trigger the cleanup interval.
    vi.advanceTimersByTime(SLOW_EXPIRY_MS + 1);
    vi.advanceTimersByTime(CLEANUP_INTERVAL_MS);

    expect(rbfCache.has('tx-b')).toBe(false);
    expect(rbfCache.has('tx-b-replaced')).toBe(false);
  });

  it('uses a 10-minute expiry for fast evictions and removes after that window', () => {
    const tx = makeTx('tx-c');
    const replaced = makeTx('tx-c-replaced');

    rbfCache.add([replaced], tx);
    rbfCache.evict('tx-c', /* fast */ true);

    // Should still be present just before the fast expiry.
    vi.advanceTimersByTime(FAST_EXPIRY_MS - 1);
    vi.advanceTimersByTime(CLEANUP_INTERVAL_MS);
    expect(rbfCache.has('tx-c')).toBe(true);

    // One extra millisecond pushes past the expiry; next cleanup removes it.
    vi.advanceTimersByTime(2);
    vi.advanceTimersByTime(CLEANUP_INTERVAL_MS);
    expect(rbfCache.has('tx-c')).toBe(false);
  });

  it('expiry timestamp is anchored to the system time set by vi.setSystemTime()', () => {
    // Pin the clock to a specific later time before evicting.
    const EVICTION_TIME = new Date(FIXED_NOW.getTime() + 3600_000); // 1 h after FIXED_NOW
    vi.setSystemTime(EVICTION_TIME);

    const tx = makeTx('tx-d');
    const replaced = makeTx('tx-d-replaced');

    rbfCache.add([replaced], tx);
    // Expiry = EVICTION_TIME + 24 h
    rbfCache.evict('tx-d');

    // Advance to 1 ms before the 24-h expiry – tx-d should still be present.
    vi.advanceTimersByTime(SLOW_EXPIRY_MS - 1);
    vi.advanceTimersByTime(CLEANUP_INTERVAL_MS);
    expect(rbfCache.has('tx-d')).toBe(true);

    // Advance past the expiry and trigger another cleanup – tx-d must now be gone.
    vi.advanceTimersByTime(2);
    vi.advanceTimersByTime(CLEANUP_INTERVAL_MS);
    expect(rbfCache.has('tx-d')).toBe(false);
  });
});
