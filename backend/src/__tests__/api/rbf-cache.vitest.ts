/**
 * Vitest tests for RbfCache timer-based eviction logic.
 *
 * Uses vi.useFakeTimers() / vi.setSystemTime() / vi.advanceTimersByTime() to
 * drive the setInterval-based cleanup() method inside RbfCache without any
 * real waiting, ensuring deterministic, flake-free assertions.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks (vi.mock is hoisted before all imports by Vitest)
// ---------------------------------------------------------------------------

vi.mock('../../config', () => ({
  default: {
    REDIS: { ENABLED: false },
    MEMPOOL: { NETWORK: 'mainnet' },
  },
}));

vi.mock('../../logger', () => ({
  default: {
    debug: vi.fn(),
    err: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../../api/bitcoin/bitcoin-api-factory', () => ({
  default: {},
}));

vi.mock('../../api/redis-cache', () => ({
  default: {
    $setRbfEntry: vi.fn().mockResolvedValue(undefined),
    $removeRbfEntry: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../api/common', () => ({
  Common: {
    stripTransaction: vi.fn((tx: any) => ({
      txid: tx.txid,
      fee: tx.fee ?? 0,
      vsize: tx.weight / 4,
      value: 0,
      rate: tx.effectiveFeePerVsize ?? 0,
    })),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fixed epoch used as the "current time" at the start of every test. */
const T0 = new Date('2024-01-01T00:00:00Z').getTime();

/** Build a minimal fake MempoolTransactionExtended sufficient for RbfCache. */
function makeTx(txid: string, seq = 0xffffffff): any {
  return {
    txid,
    version: 1,
    locktime: 0,
    size: 100,
    weight: 400,
    fee: 1000,
    vsize: 100,
    feePerVsize: 10,
    effectiveFeePerVsize: 10,
    firstSeen: T0 / 1000,
    vin: [
      {
        txid: 'prev0',
        vout: 0,
        is_coinbase: false,
        scriptsig: '',
        scriptsig_asm: '',
        inner_redeemscript_asm: '',
        inner_witnessscript_asm: '',
        sequence: seq,
        witness: [],
      },
    ],
    vout: [
      {
        value: 1000,
        scriptpubkey: '',
        scriptpubkey_type: '',
        scriptpubkey_asm: '',
      },
    ],
    status: { confirmed: false },
    order: 0,
    sigops: 0,
    adjustedVsize: 100,
    adjustedFeePerVsize: 10,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RbfCache – timer-based eviction', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cache: any;

  beforeEach(async () => {
    // Install fake timers BEFORE importing the module so that the setInterval
    // call inside the RbfCache constructor is captured by the fake clock.
    vi.useFakeTimers();
    vi.setSystemTime(T0);

    // Reset the module registry so each test gets a fresh RbfCache singleton.
    vi.resetModules();
    cache = (await import('../../api/rbf-cache')).default;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('retains an evicted tx while its 24-hour TTL has not yet elapsed', () => {
    const old = makeTx('old-1');
    const rep = makeTx('rep-1');
    cache.add([old], rep);

    // Evict the replacing tx (the one not in replacedBy).
    cache.evict('rep-1');

    // Advance 23 h 50 min – several cleanup intervals fire but TTL not reached.
    vi.advanceTimersByTime(23 * 60 * 60 * 1000 + 50 * 60 * 1000);

    expect(cache.has('rep-1')).toBe(true);
  });

  it('removes a tx from the cache after its 24-hour TTL once cleanup fires', () => {
    const old = makeTx('old-2');
    const rep = makeTx('rep-2');
    cache.add([old], rep);
    cache.evict('rep-2');

    // Advance 25 hours – past the 24 h TTL; cleanup fires multiple times.
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);

    expect(cache.has('rep-2')).toBe(false);
    // The predecessor (old-2) is removed recursively by RbfCache.remove().
    expect(cache.has('old-2')).toBe(false);
  });

  it('removes a fast-evicted tx after its 10-minute TTL once cleanup fires', () => {
    const old = makeTx('old-3');
    const rep = makeTx('rep-3');
    cache.add([old], rep);

    // fast=true → expiry = Date.now() + 10 min
    cache.evict('rep-3', true);

    // Advance 20 min: past the 10-min TTL and covers at least one cleanup tick.
    vi.advanceTimersByTime(20 * 60 * 1000);

    expect(cache.has('rep-3')).toBe(false);
    expect(cache.has('old-3')).toBe(false);
  });

  it('vi.setSystemTime() controls the expiry anchor used by evict()', () => {
    // Shift "now" by 2 h so expiry is anchored at T0 + 2h + 24h = T0 + 26h.
    vi.setSystemTime(T0 + 2 * 60 * 60 * 1000);
    const old = makeTx('old-4');
    const rep = makeTx('rep-4');
    cache.add([old], rep);
    cache.evict('rep-4');

    // Advance 25 h 50 min from T0+2h → fake clock reaches T0+27h50min;
    // but the expiry anchor is T0+26h, so the tx should be gone.
    vi.advanceTimersByTime(25 * 60 * 60 * 1000 + 50 * 60 * 1000);

    expect(cache.has('rep-4')).toBe(false);
  });
});
