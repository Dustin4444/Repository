/**
 * Tests for RbfCache timer-dependent behaviour.
 *
 * RbfCache uses:
 *  - setInterval  (constructor) – periodic cleanup every 10 minutes
 *  - Date.now()   (evict)       – stamp the expiry deadline
 *  - Date.now()   (cleanup)     – compare against expiry deadlines
 *  - Date.now()/1000 (add)      – fall back to current time when `firstSeen` is absent
 *
 * We control all of those with Jest's built-in fake-timer APIs, which are the
 * direct Jest equivalents of Vitest's vi.useFakeTimers / vi.setSystemTime /
 * vi.advanceTimersByTime.
 */

import { MempoolTransactionExtended } from '../../mempool.interfaces';

// ---------------------------------------------------------------------------
// Mock heavy / unrelated dependencies so that rbf-cache.ts can be loaded
// without a database, Redis, or a built Rust GBT binary.
// ---------------------------------------------------------------------------

jest.mock('../../api/bitcoin/bitcoin-api-factory', () => ({}));

jest.mock('../../api/redis-cache', () => ({
  $setRbfEntry: jest.fn().mockResolvedValue(undefined),
  $removeRbfEntry: jest.fn().mockResolvedValue(undefined),
}));

/**
 * Mock Common.stripTransaction with a minimal implementation that satisfies
 * the fields that RbfCache actually accesses on the stripped object.
 */
jest.mock('../../api/common', () => ({
  Common: {
    stripTransaction: jest.fn((tx: any) => ({
      txid: tx.txid,
      fee: tx.fee ?? 0,
      vsize: (tx.weight ?? 400) / 4,
      value: (tx.vout ?? []).reduce(
        (acc: number, o: any) => acc + (o.value ?? 0),
        0,
      ),
      rate: tx.effectiveFeePerVsize,
      time: tx.firstSeen ?? undefined,
    })),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fixed epoch used as the synthetic "current time" throughout the suite. */
const BASE_MS = 1_700_000_000_000;

/** 10-minute cleanup interval, mirrored from rbf-cache.ts. */
const CLEANUP_INTERVAL_MS = 1_000 * 60 * 10; // 600 000 ms

/** 24-hour and 10-minute expiry constants, mirrored from rbf-cache.ts. */
const EXPIRY_NORMAL_MS = 1_000 * 86_400; // 24 h
const EXPIRY_FAST_MS   = 1_000 * 60 * 10; // 10 min

/** Build the smallest MempoolTransactionExtended that RbfCache needs. */
function makeTx(
  txid: string,
  opts: { firstSeen?: number; sequence?: number } = {},
): MempoolTransactionExtended {
  return {
    txid,
    fee: 1_000,
    weight: 400,
    vsize: 100,
    feePerVsize: 10,
    effectiveFeePerVsize: 10,
    adjustedVsize: 100,
    adjustedFeePerVsize: 10,
    sigops: 0,
    order: 0,
    firstSeen: opts.firstSeen,
    // sequence >= 0xfffffffe  →  not RBF signalling
    vin: [{ txid: 'prev', vout: 0, sequence: opts.sequence ?? 0xfffffffe } as any],
    vout: [{ value: 100_000 } as any],
  } as unknown as MempoolTransactionExtended;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('RbfCache – timer-dependent behaviour', () => {
  /**
   * Fresh cache instance per test.
   *
   * jest.isolateModules() gives us a brand-new module registry so each test
   * gets its own singleton.  Because jest.useFakeTimers() is called before
   * the module is required, the setInterval() inside the RbfCache constructor
   * registers against the fake timer queue instead of the real one, so
   * jest.advanceTimersByTime() can fire the cleanup callback.
   */
  let cache: any;

  beforeEach(() => {
    // Start fake timers anchored to BASE_MS.
    jest.useFakeTimers({ now: BASE_MS });

    jest.isolateModules(() => {
      // jest.requireActual bypasses the global mock added by testSetup.ts.
      cache = jest.requireActual('../../api/rbf-cache').default;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // add() – timestamp stamping
  // -------------------------------------------------------------------------

  describe('add() – timestamp stamping', () => {
    test('uses the supplied firstSeen value when present', () => {
      const replacedTime = BASE_MS / 1_000 - 5; // 5 s before BASE_MS
      const newTime      = BASE_MS / 1_000;

      cache.add([makeTx('a1', { firstSeen: replacedTime })],
                 makeTx('a2', { firstSeen: newTime }));

      const tree = cache.getRbfTree('a2');
      expect(tree).toBeDefined();
      // tree.time is stored in seconds
      expect(tree.time).toBe(newTime);
    });

    test('falls back to Date.now()/1000 when firstSeen is absent', () => {
      // No firstSeen → rbf-cache will call Date.now() / 1000
      cache.add([makeTx('b1')], makeTx('b2'));

      const tree = cache.getRbfTree('b2');
      expect(tree).toBeDefined();
      // Jest fake Date.now() returns BASE_MS, so tree.time should be BASE_MS / 1000
      expect(tree.time).toBe(BASE_MS / 1_000);
    });
  });

  // -------------------------------------------------------------------------
  // evict() – expiry calculation
  // -------------------------------------------------------------------------

  describe('evict() – expiry deadline calculation', () => {
    test('sets a 24-hour expiry (normal eviction)', () => {
      cache.add([makeTx('c1')], makeTx('c2'));
      cache.evict('c2'); // fast = false (default)

      const { expiring } = cache.dump();
      const expiryMap = new Map<string, number>(expiring);

      // Deadline must be exactly 24 h from the faked Date.now()
      expect(expiryMap.get('c2')).toBe(BASE_MS + EXPIRY_NORMAL_MS);
    });

    test('sets a 10-minute expiry (fast eviction)', () => {
      cache.add([makeTx('d1')], makeTx('d2'));
      cache.evict('d2', true); // fast = true

      const { expiring } = cache.dump();
      const expiryMap = new Map<string, number>(expiring);

      // Deadline must be exactly 10 min from the faked Date.now()
      expect(expiryMap.get('d2')).toBe(BASE_MS + EXPIRY_FAST_MS);
    });

    test('tx is still reachable immediately after eviction', () => {
      cache.add([makeTx('e1')], makeTx('e2'));
      cache.evict('e2');

      // has() must return true – eviction only schedules removal
      expect(cache.has('e2')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // cleanup interval – expiry enforcement
  // -------------------------------------------------------------------------

  describe('setInterval cleanup – expiry enforcement', () => {
    /**
     * The cleanup fires every CLEANUP_INTERVAL_MS.
     *
     * With a fast-eviction expiry of BASE_MS + CLEANUP_INTERVAL_MS:
     *   • 1st fire at BASE_MS + CLEANUP_INTERVAL_MS:
     *       Date.now() == expiry  → strict-less check fails → not removed
     *   • 2nd fire at BASE_MS + 2 * CLEANUP_INTERVAL_MS:
     *       Date.now() >  expiry  → removed ✓
     */
    test('removes an entry after its expiry time has passed', () => {
      cache.add([makeTx('f1')], makeTx('f2'));
      cache.evict('f2', /* fast */ true); // expiry = BASE_MS + CLEANUP_INTERVAL_MS
      expect(cache.has('f2')).toBe(true);

      // Advance past two full cleanup cycles.
      jest.advanceTimersByTime(2 * CLEANUP_INTERVAL_MS + 1);

      expect(cache.has('f2')).toBe(false);
    });

    test('does NOT remove an entry whose expiry is still in the future', () => {
      cache.add([makeTx('g1')], makeTx('g2'));
      cache.evict('g2'); // normal expiry = BASE_MS + 24 h

      // Fire cleanup once – still well within the 24-hour window
      jest.advanceTimersByTime(CLEANUP_INTERVAL_MS + 1);

      expect(cache.has('g2')).toBe(true);
    });

    test('mined() schedules a 24-hour expiry; cleanup removes it after that', () => {
      cache.add([makeTx('h1')], makeTx('h2'));

      // Simulate the replacement being mined – internally calls evict() with
      // fast=false, so the deadline is Date.now() + 24 h.
      cache.mined('h2');

      const { expiring } = cache.dump();
      const expiryMap = new Map<string, number>(expiring);
      expect(expiryMap.get('h2')).toBe(BASE_MS + EXPIRY_NORMAL_MS);

      // The tx must still be visible immediately after mined()
      expect(cache.has('h2')).toBe(true);

      // Advance the fake clock past the 24-hour expiry so the next cleanup
      // round removes the entry.  2 × 24 h guarantees at least two interval
      // fires after the expiry boundary.
      jest.advanceTimersByTime(2 * EXPIRY_NORMAL_MS + CLEANUP_INTERVAL_MS);

      expect(cache.has('h2')).toBe(false);
    });
  });
});
