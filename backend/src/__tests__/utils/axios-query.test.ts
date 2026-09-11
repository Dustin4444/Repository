/**
 * Demonstrates mocking an external HTTP library (axios) with Jest.
 *
 * Pattern:
 *   jest.mock('axios')        – replace the entire module with auto-mock stubs
 *   jest.Mocked<typeof axios> – TypeScript cast so .mockResolvedValue etc. are available
 *   mockClear() in beforeEach – keep each test independent
 */

import axios from 'axios';
import { query } from '../../utils/axios-query';

// ── Module mocks ──────────────────────────────────────────────────────────────

jest.mock('axios');

// backend-info reads a version.json file that may not exist in CI; mock it out.
// The `__esModule: true` flag is required so that TypeScript's compiled
// `import backendInfo from '...'` resolves to the `default` key correctly.
jest.mock('../../api/backend-info', () => ({
  __esModule: true,
  default: {
    getBackendInfo: jest.fn().mockReturnValue({ version: '0.0.0-test' }),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

const mockedAxiosGet = axios.get as jest.MockedFunction<typeof axios.get>;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('axios-query / query()', () => {
  beforeEach(() => {
    mockedAxiosGet.mockClear();
  });

  test('returns response data on a successful HTTP GET', async () => {
    const payload = { result: { XXBTZUSD: { c: ['65000.00'] } } };
    mockedAxiosGet.mockResolvedValueOnce({
      data: payload,
      status: 200,
      statusText: 'OK',
    } as any);

    const result = await query('https://api.example.com/ticker');

    expect(mockedAxiosGet).toHaveBeenCalledTimes(1);
    expect(mockedAxiosGet).toHaveBeenCalledWith(
      'https://api.example.com/ticker',
      expect.objectContaining({
        headers: expect.objectContaining({ 'User-Agent': expect.any(String) }),
        timeout: expect.any(Number),
      })
    );
    expect(result).toEqual(payload);
  });

  test('returns undefined after all retries are exhausted (network error)', async () => {
    // Config default: EXTERNAL_MAX_RETRY = 1, so exactly one attempt is made.
    mockedAxiosGet.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await query('https://api.example.com/ticker');

    expect(mockedAxiosGet).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });

  test('throws the last error when throwOnFail is true', async () => {
    const networkError = new Error('Connection refused');
    mockedAxiosGet.mockRejectedValue(networkError);

    await expect(query('https://api.example.com/ticker', true)).rejects.toThrow(
      'Connection refused'
    );
  });

  test('returns undefined when the response contains no data', async () => {
    // A response whose .data is null triggers the internal "no data" error path,
    // which is caught, exhausts the retry budget, and returns undefined.
    mockedAxiosGet.mockResolvedValueOnce({
      data: null,
      status: 200,
      statusText: 'OK',
    } as any);

    const result = await query('https://api.example.com/ticker');

    expect(result).toBeUndefined();
  });

  test('returns undefined when statusText is "error"', async () => {
    mockedAxiosGet.mockResolvedValueOnce({
      data: { something: true },
      status: 500,
      statusText: 'error',
    } as any);

    const result = await query('https://api.example.com/ticker');

    expect(result).toBeUndefined();
  });
});
