import KrakenApi from '../../../tasks/price-feeds/kraken-api';

// Mock the axios-query utility so no real network calls are made
jest.mock('../../../utils/axios-query', () => ({
  query: jest.fn(),
}));

// Mock repositories and priceUpdater since they require DB / singleton state
jest.mock('../../../repositories/PricesRepository', () => ({
  default: {
    $getPricesTimes: jest.fn().mockResolvedValue([]),
    $savePrices: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../../tasks/price-updater', () => ({
  __esModule: true,
  default: {
    getEmptyPricesObj: jest.fn().mockReturnValue({
      USD: -1, EUR: -1, GBP: -1, CAD: -1, CHF: -1, AUD: -1, JPY: -1,
    }),
  },
}));

import { query } from '../../../utils/axios-query';
const mockQuery = query as jest.MockedFunction<typeof query>;

describe('KrakenApi', () => {
  let api: KrakenApi;

  beforeEach(() => {
    jest.clearAllMocks();
    api = new KrakenApi();
  });

  describe('$fetchPrice', () => {
    it('returns parsed integer price for a valid response', async () => {
      mockQuery.mockResolvedValueOnce({
        result: {
          XXBTZUSD: { c: ['67500.00', '0.12345678'] },
        },
      });

      const price = await api.$fetchPrice('USD');

      expect(price).toBe(67500);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('https://api.kraken.com/0/public/Ticker?pair=XBTUSD'),
      );
    });

    it('returns -1 when the response is undefined', async () => {
      mockQuery.mockResolvedValueOnce(undefined);

      const price = await api.$fetchPrice('USD');

      expect(price).toBe(-1);
    });

    it('returns -1 when the result key is missing', async () => {
      mockQuery.mockResolvedValueOnce({ result: {} });

      const price = await api.$fetchPrice('USD');

      expect(price).toBe(-1);
    });

    it('uses XBT<CURRENCY> ticker for CHF', async () => {
      mockQuery.mockResolvedValueOnce({
        result: {
          XBTCHF: { c: ['55000.00'] },
        },
      });

      const price = await api.$fetchPrice('CHF');

      expect(price).toBe(55000);
    });

    it('uses XBT<CURRENCY> ticker for AUD', async () => {
      mockQuery.mockResolvedValueOnce({
        result: {
          XBTAUD: { c: ['105000.00'] },
        },
      });

      const price = await api.$fetchPrice('AUD');

      expect(price).toBe(105000);
    });
  });

  describe('$fetchRecentPrice', () => {
    it('aggregates OHLC data into a price history map', async () => {
      const MOCK_TIMESTAMP = 1700000000; // arbitrary fixed Unix timestamp for deterministic test data
      mockQuery.mockResolvedValueOnce({
        result: {
          XXBTZUSD: [
            [MOCK_TIMESTAMP, '66000', '67000', '65000', '66500', '100', 50],
          ],
        },
      });

      const history = await api.$fetchRecentPrice(['USD'], 'hour');

      expect(history[MOCK_TIMESTAMP]).toBeDefined();
      expect(history[MOCK_TIMESTAMP]['USD']).toBe('66500');
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('skips currencies not supported by Kraken', async () => {
      const history = await api.$fetchRecentPrice(['XYZ'], 'hour');

      expect(history).toEqual({});
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('handles an empty OHLC result gracefully', async () => {
      mockQuery.mockResolvedValueOnce({ result: { XXBTZEUR: [] } });

      const history = await api.$fetchRecentPrice(['EUR'], 'hour');

      expect(history).toEqual({});
    });
  });
});
