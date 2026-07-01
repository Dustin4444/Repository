/**
 * Demonstrates combining multiple mock strategies in a single test suite:
 *   1. jest.mock('axios')               – network mock
 *   2. jest.mock('fs')                  – filesystem mock
 *   3. jest.mock('../api/backend-info') – internal module mock
 *   4. Runtime config mutation          – override specific fields per-test
 *      without replacing the entire module, then restore in afterEach.
 */

import axios from 'axios';
import * as fs from 'fs';
import { EventEmitter } from 'events';
import config from '../config';

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('axios');

jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue(undefined),
  },
  existsSync: jest.fn().mockReturnValue(false),
  readFileSync: jest.fn().mockReturnValue('{}'),
  writeFileSync: jest.fn(),
  renameSync: jest.fn(),
  unlinkSync: jest.fn(),
  createWriteStream: jest.fn(),
}));

jest.mock('../api/backend-info', () => ({
  __esModule: true,
  default: {
    getBackendInfo: jest.fn().mockReturnValue({ version: '0.0.0-test' }),
  },
}));

// ── Import the singleton after mocks are declared ─────────────────────────────

import syncAssets from '../sync-assets';

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockedAxiosGet = axios.get as jest.MockedFunction<typeof axios.get>;
const mockedCreateWriteStream = fs.createWriteStream as jest.MockedFunction<
  typeof fs.createWriteStream
>;

/**
 * Fake readable stream: when pipe() is called it emits 'finish' on the
 * supplied writable on the next tick, making the download Promise resolve.
 */
function makeFakeReadable(writable: EventEmitter): { pipe: jest.Mock } {
  return {
    pipe: jest.fn().mockImplementation(() => {
      process.nextTick(() => writable.emit('finish'));
    }),
  };
}

/** EventEmitter acting as a writable stream with a spy on .on() */
function makeFakeWritable(): EventEmitter & { on: jest.Mock } {
  const ee = new EventEmitter() as EventEmitter & { on: jest.Mock };
  ee.on = jest.fn((...args) => EventEmitter.prototype.on.apply(ee, args) as any);
  return ee;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SyncAssets – axios + fs mocking', () => {
  let originalAssets: string[];

  beforeEach(() => {
    // Snapshot the original EXTERNAL_ASSETS so we can restore it after each test.
    originalAssets = config.MEMPOOL.EXTERNAL_ASSETS.slice();
    jest.clearAllMocks();
  });

  afterEach(() => {
    config.MEMPOOL.EXTERNAL_ASSETS = originalAssets;
  });

  test('syncAssets$() resolves without side-effects when EXTERNAL_ASSETS is empty', async () => {
    // Default config has EXTERNAL_ASSETS = []; nothing should be downloaded.
    config.MEMPOOL.EXTERNAL_ASSETS = [];

    await expect(syncAssets.syncAssets$()).resolves.toBeUndefined();
    expect(mockedAxiosGet).not.toHaveBeenCalled();
    expect(mockedCreateWriteStream).not.toHaveBeenCalled();
  });

  test('syncAssets$() downloads and saves a file for each URL in EXTERNAL_ASSETS', async () => {
    config.MEMPOOL.EXTERNAL_ASSETS = ['https://example.com/assets/data.json'];

    const fakeWritable = makeFakeWritable();
    mockedCreateWriteStream.mockReturnValue(fakeWritable as any);
    const fakeReadable = makeFakeReadable(fakeWritable);
    mockedAxiosGet.mockResolvedValueOnce({ data: fakeReadable } as any);

    await syncAssets.syncAssets$();

    expect(mockedAxiosGet).toHaveBeenCalledTimes(1);
    expect(mockedAxiosGet).toHaveBeenCalledWith(
      'https://example.com/assets/data.json',
      expect.objectContaining({ responseType: 'stream' })
    );
    expect(mockedCreateWriteStream).toHaveBeenCalledWith(
      expect.stringContaining('data.json')
    );
  });

  test('syncAssets$() throws a descriptive error when axios throws synchronously', async () => {
    // downloadFile$() wraps axios.get in a new Promise(). The try/catch inside
    // that executor only propagates *synchronous* errors; a synchronous throw
    // from axios.get is caught and forwarded to reject(), which in turn lets
    // syncAssets$() wrap the message with 'Failed to download external asset.'.
    config.MEMPOOL.EXTERNAL_ASSETS = ['https://example.com/assets/data.json'];

    mockedAxiosGet.mockImplementationOnce(() => {
      throw new Error('DNS lookup failed');
    });

    await expect(syncAssets.syncAssets$()).rejects.toThrow(
      'Failed to download external asset.'
    );
  });
});
