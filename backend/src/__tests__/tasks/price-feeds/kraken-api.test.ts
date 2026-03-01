/**
 * Full-mocking unit tests for KrakenApi
 *
 * This suite demonstrates idiomatic Jest mocking patterns for a class that
 * depends on:
 *  - External network calls  (mocked via jest.mock on the axios-query wrapper)
 *  - A database repository   (mocked via jest.mock on PricesRepository)
 *  - A shared singleton      (mocked via jest.mock on price-updater)
 *
 * No real network traffic or database connections are made in any test.
 */

import KrakenApi from '../../../tasks/price-feeds/kraken-api';

// ---------------------------------------------------------------------------
// Mock: network layer
// ---------------------------------------------------------------------------
// Replace the thin axios wrapper so HTTP calls never leave the process.
jest.mock('../../../utils/axios-query');
import { query } from '../../../utils/axios-query';
const mockQuery = query as jest.MockedFunction<typeof query>;

// ---------------------------------------------------------------------------
// Mock: database repository
// ---------------------------------------------------------------------------
jest.mock('../../../repositories/PricesRepository');
import PricesRepository from '../../../repositories/PricesRepository';
const mockPricesRepository = PricesRepository as jest.Mocked<typeof PricesRepository>;

// ---------------------------------------------------------------------------
// Mock: price-updater singleton (only getEmptyPricesObj is needed here)
// ---------------------------------------------------------------------------
jest.mock('../../../tasks/price-updater', () => ({
  __esModule: true,
  default: {
    getEmptyPricesObj: jest.fn(() => ({
      time: 0,
      USD: -1, EUR: -1, GBP: -1, CAD: -1, CHF: -1, AUD: -1, JPY: -1,
      BGN: -1, BRL: -1, CNY: -1, CZK: -1, DKK: -1, HKD: -1, HRK: -1,
      HUF: -1, IDR: -1, ILS: -1, INR: -1, ISK: -1, KRW: -1, MXN: -1,
      MYR: -1, NOK: -1, NZD: -1, PHP: -1, PLN: -1, RON: -1, RUB: -1,
      SEK: -1, SGD: -1, THB: -1, TRY: -1, ZAR: -1,
    })),
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a currency to the Kraken ticker symbol the API embeds in *responses*.
 *
 * Note: the request URL always appends the bare currency code to
 * `…?pair=XBT` (e.g. `pair=XBTUSD`), but the *response* JSON uses a longer
 * ticker symbol as the key.  For most currencies that is `XXBTZ<CURRENCY>`,
 * but CHF and AUD use a shorter `XBT<CURRENCY>` variant – a Kraken API quirk.
 */
function krakenTicker(currency: string): string {
  return ['CHF', 'AUD'].includes(currency)
    ? `XBT${currency}`
    : `XXBTZ${currency}`;
}

/**
 * Build a minimal Kraken ticker response.
 * The URL is `…/Ticker?pair=XBT<CURRENCY>` – the result key is the ticker.
 */
function buildTickerResponse(currency: string, price: number) {
  return {
    result: {
      [krakenTicker(currency)]: {
        c: [price.toString(), '1'],
      },
    },
  };
}

/**
 * Build a minimal Kraken OHLC response.
 * Kraken OHLC candle format: [time, open, high, low, close, vwap, volume, count]
 * The close price (index 4) is always returned as a string by the real API.
 */
function buildOhlcResponse(currency: string, timestamp: number, closePrice: number) {
  return {
    result: {
      [krakenTicker(currency)]: [
        [timestamp, '0', '0', '0', String(closePrice), '0', '0', 0],
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KrakenApi', () => {
  let krakenApi: KrakenApi;

  beforeEach(() => {
    // Create a fresh instance before every test so internal state is clean.
    krakenApi = new KrakenApi();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // $fetchPrice
  // -------------------------------------------------------------------------

  describe('$fetchPrice', () => {
    it('returns the integer closing price for USD', async () => {
      // The Kraken request URL is `…/Ticker?pair=XBT` + currency (e.g. XBTUSD).
      // The *response* JSON uses a different, longer ticker symbol (e.g. XXBTZUSD) –
      // see krakenTicker() above.  The URL and the response key are independent.
      mockQuery.mockResolvedValueOnce(buildTickerResponse('USD', 65432));

      const price = await krakenApi.$fetchPrice('USD');

      expect(price).toBe(65432);
      // Verify exactly one network call was made (no real HTTP traffic).
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('pair=XBTUSD')
      );
    });

    it('returns the integer closing price for CHF (uses XBT prefix ticker)', async () => {
      mockQuery.mockResolvedValueOnce(buildTickerResponse('CHF', 58000));

      const price = await krakenApi.$fetchPrice('CHF');

      expect(price).toBe(58000);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('pair=XBTCHF'));
    });

    it('returns -1 when the API response is undefined (network timeout)', async () => {
      mockQuery.mockResolvedValueOnce(undefined);

      const price = await krakenApi.$fetchPrice('USD');

      expect(price).toBe(-1);
    });

    it('returns -1 when the ticker is missing from the response', async () => {
      mockQuery.mockResolvedValueOnce({ result: {} });

      const price = await krakenApi.$fetchPrice('USD');

      expect(price).toBe(-1);
    });

    it('returns -1 when the closing price array is empty', async () => {
      mockQuery.mockResolvedValueOnce({
        result: { XXBTZUSD: { c: [] } },
      });

      const price = await krakenApi.$fetchPrice('USD');

      expect(price).toBe(-1);
    });

    it('propagates a network error thrown by query()', async () => {
      mockQuery.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      await expect(krakenApi.$fetchPrice('USD')).rejects.toThrow('ECONNREFUSED');
    });
  });

  // -------------------------------------------------------------------------
  // $fetchRecentPrice
  // -------------------------------------------------------------------------

  describe('$fetchRecentPrice', () => {
    it('aggregates hourly prices for multiple supported currencies', async () => {
      const timestamp = 1_700_000_000;
      const prices: Record<string, number> = {
        USD: 62000, EUR: 56000, GBP: 48000,
        CAD: 84000, CHF: 55000, AUD: 95000, JPY: 9_500_000,
      };

      // Respond with the correct ticker per currency so the response lookup
      // always resolves (keys in the result object must match krakenTicker()).
      mockQuery.mockImplementation(async (url) => {
        for (const [currency, price] of Object.entries(prices)) {
          if ((url as string).endsWith(currency)) {
            return buildOhlcResponse(currency, timestamp, price);
          }
        }
        return undefined;
      });

      const history = await krakenApi.$fetchRecentPrice(
        ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'],
        'hour'
      );

      expect(history[timestamp]).toBeDefined();
      // Kraken returns prices as strings; the code stores them verbatim.
      expect(history[timestamp].USD).toBe(String(prices.USD));
      expect(history[timestamp].EUR).toBe(String(prices.EUR));
      expect(history[timestamp].GBP).toBe(String(prices.GBP));
      // One OHLC request per currency (7 total).
      expect(mockQuery).toHaveBeenCalledTimes(7);
    });

    it('skips currencies not supported by Kraken', async () => {
      // Kraken only covers USD, EUR, GBP, CAD, CHF, AUD, JPY.
      // Providing an unsupported currency should result in zero query calls.
      const history = await krakenApi.$fetchRecentPrice(['XYZ'], 'hour');

      expect(mockQuery).not.toHaveBeenCalled();
      expect(history).toEqual({});
    });

    it('returns an empty history when query() returns undefined', async () => {
      mockQuery.mockResolvedValue(undefined);

      const history = await krakenApi.$fetchRecentPrice(['USD'], 'hour');

      expect(history).toEqual({});
    });

    it('uses a 60-minute granularity parameter in the URL for "hour" type', async () => {
      mockQuery.mockImplementation(async (url) => {
        if ((url as string).endsWith('USD')) {
          return buildOhlcResponse('USD', 1_700_000_000, 60000);
        }
        return undefined;
      });

      await krakenApi.$fetchRecentPrice(['USD'], 'hour');

      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('interval=60'));
    });
  });

  // -------------------------------------------------------------------------
  // $insertHistoricalPrice
  // -------------------------------------------------------------------------

  describe('$insertHistoricalPrice', () => {
    const allCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'CHF', 'AUD', 'JPY'];
    const testTimestamp = 1_400_000_000; // arbitrary timestamp not in DB

    /** Provide an OHLC response matching the currency suffix of the URL. */
    function currencyAwareOhlcMock(timestamp: number, price: number) {
      return jest.fn(async (url: unknown) => {
        for (const currency of allCurrencies) {
          if ((url as string).endsWith(currency)) {
            return buildOhlcResponse(currency, timestamp, price);
          }
        }
        return undefined;
      });
    }

    it('does not persist prices that already exist in the database', async () => {
      // DB already contains this timestamp.
      mockPricesRepository.$getPricesTimes.mockResolvedValueOnce([testTimestamp]);
      mockQuery.mockImplementation(currencyAwareOhlcMock(testTimestamp, 50000));

      await krakenApi.$insertHistoricalPrice();

      // The price is already known; $savePrices must not be called.
      expect(mockPricesRepository.$savePrices).not.toHaveBeenCalled();
    });

    it('saves new USD prices that are not yet in the database', async () => {
      // DB is empty.
      mockPricesRepository.$getPricesTimes.mockResolvedValueOnce([]);
      mockPricesRepository.$savePrices.mockResolvedValue(undefined);
      mockQuery.mockImplementation(currencyAwareOhlcMock(testTimestamp, 11000));

      await krakenApi.$insertHistoricalPrice();

      // At least one price should have been persisted.
      expect(mockPricesRepository.$savePrices).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Time-independent determinism check
  // -------------------------------------------------------------------------

  describe('determinism', () => {
    it('produces identical results for identical mock inputs on multiple calls', async () => {
      mockQuery.mockResolvedValue(buildTickerResponse('USD', 70000));

      const [price1, price2] = await Promise.all([
        krakenApi.$fetchPrice('USD'),
        krakenApi.$fetchPrice('USD'),
      ]);

      expect(price1).toBe(price2);
    });
  });
});
