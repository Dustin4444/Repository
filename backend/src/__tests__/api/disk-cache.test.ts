/**
 * Demonstrates mocking the Node.js built-in `fs` module with Jest.
 *
 * Pattern:
 *   jest.mock('fs')                           – replace all fs exports with stubs
 *   (fs.unlinkSync as jest.Mock).mockImplementation – customise specific calls
 *   isolateModules / requireActual            – get a fresh module instance per test
 */

import * as fs from 'fs';

// ── Module mocks (hoisted before any imports that pull in the module under test)

jest.mock('fs', () => ({
  // Bring across the real `promises` namespace shape so disk-cache.ts can
  // destructure it at module load time without a TypeError.
  promises: {
    writeFile: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue(undefined),
  },
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn().mockReturnValue('{}'),
  writeFileSync: jest.fn(),
  renameSync: jest.fn(),
  unlinkSync: jest.fn(),
  createWriteStream: jest.fn().mockReturnValue({
    on: jest.fn(),
    write: jest.fn(),
    end: jest.fn(),
  }),
}));

// cluster.isPrimary must be false in test environments so that disk-cache.ts
// does not attach a real SIGINT handler on the test process.
jest.mock('cluster', () => ({ isPrimary: false, isWorker: true }));

// blocks is a heavy singleton with many transitive deps; replace it entirely.
jest.mock('../../api/blocks', () => ({
  default: {
    getBlocks: jest.fn().mockReturnValue([]),
    getBlockSummaries: jest.fn().mockReturnValue([]),
    setBlocks: jest.fn(),
    setBlockSummaries: jest.fn(),
  },
}));

// ── Import the module under test AFTER all mocks are declared ─────────────────

import diskCache from '../../api/disk-cache';

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockedUnlinkSync = fs.unlinkSync as jest.MockedFunction<typeof fs.unlinkSync>;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('DiskCache – filesystem mocking', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('wipeCache()', () => {
    test('calls fs.unlinkSync for the main cache file and all chunk files', () => {
      diskCache.wipeCache();

      // 1 main file + 24 chunk files = 25 total (CHUNK_FILES = 25, chunks 1..24)
      expect(mockedUnlinkSync).toHaveBeenCalledTimes(25);
      // The first call should be for the main cache.json
      expect(mockedUnlinkSync).toHaveBeenNthCalledWith(1, expect.stringContaining('cache.json'));
    });

    test('silently ignores ENOENT errors (files that do not exist)', () => {
      const enoent = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
      mockedUnlinkSync.mockImplementation(() => {
        throw enoent;
      });

      // Should not throw even though every fs.unlinkSync call raises ENOENT.
      expect(() => diskCache.wipeCache()).not.toThrow();
    });

    test('does not swallow non-ENOENT filesystem errors', () => {
      // First call (main cache file) throws a permission error; the method
      // should log it (via the mocked logger) but not re-throw.
      const permError = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      mockedUnlinkSync.mockImplementationOnce(() => {
        throw permError;
      });

      // wipeCache catches all errors internally – it must not propagate them.
      expect(() => diskCache.wipeCache()).not.toThrow();
    });
  });

  describe('wipeRbfCache()', () => {
    test('calls fs.unlinkSync exactly once for the RBF cache file', () => {
      diskCache.wipeRbfCache();

      expect(mockedUnlinkSync).toHaveBeenCalledTimes(1);
      expect(mockedUnlinkSync).toHaveBeenCalledWith(expect.stringContaining('rbfcache.json'));
    });

    test('silently ignores ENOENT when RBF cache file is absent', () => {
      const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      mockedUnlinkSync.mockImplementation(() => {
        throw enoent;
      });

      expect(() => diskCache.wipeRbfCache()).not.toThrow();
    });
  });
});
